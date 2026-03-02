import { useState, useEffect } from 'react';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import * as api from './api';
import Login from './Login';
import Register from './Register';
import Chat from './Chat';

const TOKEN_KEY = 'chat_token';
const USER_KEY = 'chat_user';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [authMode, setAuthMode] = useState('login');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
        disconnectSocket();
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
  };

  const handleRegister = (u, t) => {
    handleLogin(u, t);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setError('');
    disconnectSocket();
  };

  if (loading) {
    return (
      <div className="auth-screen">
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
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
