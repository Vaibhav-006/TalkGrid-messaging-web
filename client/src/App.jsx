import { useState, useEffect } from 'react';
import { connectSocket, disconnectSocket } from './socket';
import * as api from './api';
import Login from './Login';
import Register from './Register';
import Chat from './Chat';
import { initializeUserKeys, recoverKeysFromBackup } from './utils/authKeyHandler';

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
  const [error, setError] = useState('');
  const [keyRecoveryModal, setKeyRecoveryModal] = useState(null);

  const initializeKeys = async (userId, password = null) => {
    try {
      const result = await initializeUserKeys(userId, { password });
      
      if (result.status === 'NEEDS_BACKUP_RESTORE') {
        // Show recovery modal
        setKeyRecoveryModal(userId);
        return;
      }

      console.log('[E2EE] Key initialization successful:', result);
    } catch (err) {
      console.error('[E2EE] Key initialization failed:', err);
      setError('Encryption setup failed: ' + err.message);
    }
  };

  const handleKeyRecoveryComplete = () => {
    setKeyRecoveryModal(null);
  };

  const handleKeyRecoverySkip = () => {
    setKeyRecoveryModal(null);
  };

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    connectSocket(token);
    api.getMe()
      .then((u) => {
        setUser(u);
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        initializeKeys(u.id);
      })
      .catch((err) => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
        disconnectSocket();
        setError(err?.message || 'Session expired — please sign in again');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleLogin = (u, t) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    setError('');
    connectSocket(t);
    initializeKeys(u.id);
  };

  const handleRegister = (u, t, password) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    setError('');
    connectSocket(t);
    // Pass password for encrypted backup creation during registration
    initializeKeys(u.id, password);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setError('');
    disconnectSocket();
    setKeyRecoveryModal(null);
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

  return <Chat user={user} onLogout={handleLogout} />;
}

export default App;
