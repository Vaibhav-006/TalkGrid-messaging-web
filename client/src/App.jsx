import { useState, useEffect, useRef } from 'react';
import { connectSocket, disconnectSocket } from './socket';
import * as api from './api';
import Login from './Login';
import Register from './Register';
import Chat from './Chat';
import { initializeUserKeys } from './utils/authKeyHandler';

const TOKEN_KEY = 'chat_token';
const USER_KEY = 'chat_user';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [authMode, setAuthMode] = useState('login');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pendingPasswordRef = useRef(null);

  const setupEncryption = async (userId, password = null) => {
    try {
      await initializeUserKeys(userId, { password });
      window.dispatchEvent(new Event('e2ee-keys-ready'));
    } catch (err) {
      console.error('[E2EE] Setup failed:', err);
      window.dispatchEvent(new Event('e2ee-keys-ready'));
    }
  };

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    connectSocket(token);
    api.getMe()
      .then(async (u) => {
        setUser(u);
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        await setupEncryption(u.id, pendingPasswordRef.current);
        pendingPasswordRef.current = null;
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
    setError('');
    disconnectSocket();
    pendingPasswordRef.current = null;
  };

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="auth-loading">
          <div className="loading-spinner" aria-hidden />
          <p>Connecting to TalkGrid…</p>
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

  return <Chat user={user} onLogout={handleLogout} />;
}

export default App;
