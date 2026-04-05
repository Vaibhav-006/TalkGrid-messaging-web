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
      onRegister(user, token);
    } catch (err) {
      setError(err.message || 'Registration failed');
    }
  };

  return (
    <div className="auth-card">
      <h1>Create account</h1>
      <p className="sub">Username must be unique. Sign up to start chatting.</p>
      {error && <div className="auth-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <label htmlFor="username">Username</label>96
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
        <button type="submit">Sign up</button>
      </form>
      <p className="toggle">
        Already have an account? <button type="button" onClick={onSwitch}>Sign in</button>
      </p>
    </div>
  );
}
