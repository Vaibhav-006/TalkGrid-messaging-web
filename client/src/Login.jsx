import { useState } from 'react';
import * as api from './api';

export default function Login({ onLogin, onSwitch, error, setError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { user, token } = await api.login(username, password);
      onLogin(user, token);
    } catch (err) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div className="auth-card">
      <h1>Chat</h1>
      <p className="sub">Sign in to continue</p>
      {error && <div className="auth-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter username"
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          required
        />
        <button type="submit">Sign in</button>
      </form>
      <p className="toggle">
        Don't have an account? <button type="button" onClick={onSwitch}>Sign up</button>
      </p>
    </div>
  );
}
