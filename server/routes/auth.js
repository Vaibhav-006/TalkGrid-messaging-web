const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { MongoUser } = require('../mongo');
const { signToken } = require('../auth');

const router = express.Router();

// Register
router.post('/register', (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare(
      'INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)'
    ).run(username.trim().toLowerCase(), hash, (displayName || username).trim());
    const user = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(result.lastInsertRowid);
    const safe = {
      id: user.id ?? user.ID,
      username: user.username ?? user.USERNAME,
      display_name: user.display_name ?? user.DISPLAY_NAME ?? null,
      avatar_color: user.avatar_color ?? user.AVATAR_COLOR ?? null,
    };
    if (MongoUser) {
      MongoUser.findOneAndUpdate(
        { sqlId: safe.id },
        {
          sqlId: safe.id,
          username: safe.username,
          displayName: safe.display_name,
          avatarColor: safe.avatar_color,
        },
        { upsert: true, setDefaultsOnInsert: true }
      ).catch((err) => {
        console.error('MongoUser upsert failed:', err.message);
      });
    }
    const token = signToken({ id: safe.id, username: safe.username });
    res.status(201).json({ user: safe, token });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    throw e;
  }
});

// Login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = db.prepare('SELECT id, username, password, display_name, avatar_color FROM users WHERE username = ?').get(username.trim().toLowerCase());
    const pw = user?.password ?? user?.PASSWORD;
    if (!user || !pw || !bcrypt.compareSync(password, pw)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const safe = {
      id: user.id ?? user.ID,
      username: user.username ?? user.USERNAME,
      display_name: user.display_name ?? user.DISPLAY_NAME ?? null,
      avatar_color: user.avatar_color ?? user.AVATAR_COLOR ?? null,
    };
    const token = signToken({ id: safe.id, username: safe.username });
    res.json({ user: safe, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user (protected)
router.get('/me', require('../auth').authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user.id ?? user.ID,
      username: user.username ?? user.USERNAME,
      display_name: user.display_name ?? user.DISPLAY_NAME ?? null,
      avatar_color: user.avatar_color ?? user.AVATAR_COLOR ?? null,
    });
  } catch (err) {
    console.error('GET /me error:', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

module.exports = router;
