import { useState, useEffect, useRef } from 'react';
import { connectSocket, disconnectSocket } from './socket';
import * as api from './api';
import Login from './Login';
import Register from './Register';
import Chat from './Chat';
import { initializeUserKeys, recoverKeysFromBackup, generateFreshKeysAfterSkip } from './utils/authKeyHandler';

const TOKEN_KEY = 'chat_token';
const USER_KEY = 'chat_user';

function KeyRecoveryModal({ userId, onRecover, onSkip, onError }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRecover = async () => {
    setLoading(true);
    setError('');
    try {
      await recoverKeysFromBackup(userId, password);
      onRecover();
    } catch (err) {
      setError(err?.message || 'Recovery failed');
      onError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Recover Encryption Keys</h2>
        <p>
          Your encryption keys were not found on this device. 
          Enter your password to recover them from your encrypted backup.
        </p>
        {error && <div className="auth-error">{error}</div>}
        <input
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          onKeyPress={(e) => e.key === 'Enter' && handleRecover()}
        />
        <div className="modal-actions">
          <button onClick={handleRecover} disabled={loading || !password}>
            {loading ? 'Recovering...' : 'Recover Keys'}
          </button>
          <button onClick={onSkip} disabled={loading} style={{ opacity: 0.6 }}>
            Skip (Can't read old messages)
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [authMode, setAuthMode] = useState('login');
  const [loading, setLoading] = useState(true);
  const [e2eeReady, setE2eeReady] = useState(false);
  const [error, setError] = useState('');
  const [keyRecoveryModal, setKeyRecoveryModal] = useState(null);
  const pendingPasswordRef = useRef(null);

  const initializeKeys = async (userId, password = null) => {
    setE2eeReady(false);
    const timeoutMs = 12000;
    try {
      const result = await Promise.race([
        initializeUserKeys(userId, { password }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Encryption setup timed out')), timeoutMs);
        }),
      ]);

      if (result.status === 'NEEDS_BACKUP_RESTORE') {
        if (result.hasBackup) {
          setKeyRecoveryModal(userId);
        } else {
          await generateFreshKeysAfterSkip(userId);
          setE2eeReady(true);
          window.dispatchEvent(new Event('e2ee-keys-restored'));
        }
        return;
      }

      setE2eeReady(true);
      console.log('[E2EE] Key initialization successful:', result);
    } catch (err) {
      console.error('[E2EE] Key initialization failed:', err);
      setError('Encryption setup failed: ' + err.message);
      setE2eeReady(true);
    }
  };

  const handleKeyRecoveryComplete = () => {
    setKeyRecoveryModal(null);
    setE2eeReady(true);
    window.dispatchEvent(new Event('e2ee-keys-restored'));
  };

  const handleKeyRecoverySkip = async () => {
    if (keyRecoveryModal) {
      try {
        await generateFreshKeysAfterSkip(keyRecoveryModal);
        setE2eeReady(true);
        window.dispatchEvent(new Event('e2ee-keys-restored'));
      } catch (err) {
        console.error('[E2EE] Failed to create new keys after skip:', err);
        setE2eeReady(true);
      }
    }
    setKeyRecoveryModal(null);
  };

  useEffect(() => {
    if (!token) {
      setUser(null);
      setE2eeReady(false);
      setLoading(false);
      return;
    }
    connectSocket(token);
    api.getMe()
      .then(async (u) => {
        setUser(u);
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        await initializeKeys(u.id, pendingPasswordRef.current);
        pendingPasswordRef.current = null;
      })
      .catch((err) => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
        setE2eeReady(false);
        disconnectSocket();
        setError(err?.message || 'Session expired — please sign in again');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleLogin = (u, t, password) => {
    pendingPasswordRef.current = password || null;
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    setError('');
    connectSocket(t);
  };

  const handleRegister = (u, t, password) => {
    pendingPasswordRef.current = password || null;
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    setError('');
    connectSocket(t);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setE2eeReady(false);
    setError('');
    disconnectSocket();
    setKeyRecoveryModal(null);
    pendingPasswordRef.current = null;
  };

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="auth-loading">
          <div className="loading-spinner" aria-hidden />
          <p>Connecting to TalkGrid…</p>
          <p className="auth-loading-hint">Make sure <code>npm run dev</code> is running</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-screen">
        {authMode === 'login' ? (
          <Login
            onLogin={handleLogin}
            onSwitch={() => { setAuthMode('register'); setError(''); }}
            error={error}
            setError={setError}
          />
        ) : (
          <Register
            onRegister={handleRegister}
            onSwitch={() => { setAuthMode('login'); setError(''); }}
            error={error}
            setError={setError}
          />
        )}
      </div>
    );
  }

  if (keyRecoveryModal) {
    return (
      <KeyRecoveryModal
        userId={keyRecoveryModal}
        onRecover={handleKeyRecoveryComplete}
        onSkip={handleKeyRecoverySkip}
        onError={(err) => {
          console.error('[E2EE] Key recovery error:', err);
        }}
      />
    );
  }

  if (user && !keyRecoveryModal && !e2eeReady) {
    return (
      <div className="auth-screen">
        <div className="auth-loading">
          <div className="loading-spinner" aria-hidden />
          <p>Loading encryption keys…</p>
        </div>
      </div>
    );
  }

  return <Chat user={user} onLogout={handleLogout} />;
}

export default App;
