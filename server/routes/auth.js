const express = require('express');
const bcrypt = require('bcryptjs');
const {
  User,
  formatUser,
  nextUserId,
  findUserByUsername,
  findUserBySqlId,
  ensureMongoConnected,
} = require('../mongo');
const { signToken } = require('../auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    await ensureMongoConnected();
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

    const existing = await findUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const sqlId = await nextUserId();
    const hash = bcrypt.hashSync(password, 10);
    const user = await User.create({
      sqlId,
      username: username.trim().toLowerCase(),
      password: hash,
      displayName: (displayName || username).trim(),
    });

    const safe = formatUser(user);
    const token = signToken({ id: safe.id, username: safe.username });
    res.status(201).json({ user: safe, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    await ensureMongoConnected();
    const { username, password } = req.body;
    if (!username?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await findUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const safe = formatUser(user);
    const token = signToken({ id: safe.id, username: safe.username });
    res.json({ user: safe, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', require('../auth').authMiddleware, async (req, res) => {
  try {
    await ensureMongoConnected();
    const user = await findUserBySqlId(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(formatUser(user));
  } catch (err) {
    console.error('GET /me error:', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

module.exports = router;
