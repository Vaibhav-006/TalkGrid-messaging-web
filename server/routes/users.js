const express = require('express');
const db = require('../db');
const { MongoUser } = require('../mongo');
const { authMiddleware } = require('../auth');

const router = express.Router();
router.use(authMiddleware);

// Search user by username (unique) - exclude current user.
// If no ?q is provided, returns an empty list.
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) {
    return res.json([]);
  }
  const user = db.prepare(`
    SELECT id, username, display_name, avatar_color
    FROM users
    WHERE id != ? AND username = ?
  `).get(req.user.id, q);

  if (!user) {
    return res.json([]);
  }
  res.json([user]);
});

module.exports = router;
