import { useState } from 'react';
import * as api from './api';

export default function Register({ onRegister, onSwitch, error, setError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { user, token } = await api.register(username, password, displayName || username);
      // Pass password to onRegister so it can be used for encrypted key backup creation
      onRegister(user, token, password);
    } catch (err) {
      setError(err.message || 'Registration failed');
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
      <h1>Create account</h1>
      <p className="sub">Username must be unique. Sign up to start chatting.</p>
      {error && <div className="auth-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Choose username (min 3 characters)"
          required
        />
        <label htmlFor="displayName">Display name (optional)</label>
        <input
          id="displayName"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="How others see you"
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min 4 characters"
          required
        />
        <p className="password-hint" style={{ fontSize: '0.85rem', color: '#999', marginTop: '8px' }}>
          💡 Your password is used to securely backup encryption keys for multi-device access.
        </p>
        <button type="submit">Sign up</button>
      </form>
      <p className="toggle">
        Already have an account? <button type="button" onClick={onSwitch}>Sign in</button>
      </p>
    </div>
  );
}
