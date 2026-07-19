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
      onLogin(user, token, password);
    } catch (err) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-brand" aria-hidden>
        <div className="brand-logo brand-logo--lg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </div>
      </div>
      <h1>Welcome back</h1>
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
