const express = require('express');
const db = require('../db');
const { MongoUser, isMongoConnected } = require('../mongo');
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

/**
 * Upload / update the authenticated user's ECDH public key (SPKI Base64).
 * Private keys are never accepted — only the public half for peer key exchange.
 */
router.put('/me/public-key', async (req, res) => {
  const publicKey = typeof req.body?.publicKey === 'string' ? req.body.publicKey.trim() : '';
  if (!publicKey || publicKey.length < 32) {
    return res.status(400).json({ error: 'Valid publicKey (Base64 SPKI) required' });
  }

  try {
    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, req.user.id);
  } catch (err) {
    try {
      db.prepare('ALTER TABLE users ADD COLUMN public_key TEXT').run();
      db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, req.user.id);
    } catch (migrateErr) {
      console.error('public_key column migration failed:', migrateErr.message);
      return res.status(500).json({ error: 'Failed to store public key' });
    }
  }

  if (isMongoConnected() && MongoUser) {
    MongoUser.findOneAndUpdate(
      { sqlId: req.user.id },
      { publicKey },
      { upsert: false }
    ).catch((err) => {
      console.error('Mongo User publicKey update failed:', err.message);
    });
  }

  return res.json({ ok: true, publicKey });
});

/**
 * Fetch a user's public key for ECDH key agreement before encrypting a 1-on-1 message.
 */
router.get('/:userId/public-key', async (req, res) => {
  const targetId = parseInt(req.params.userId, 10);
  if (!targetId || Number.isNaN(targetId)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  let publicKey = null;

  const row = db.prepare('SELECT id, public_key FROM users WHERE id = ?').get(targetId);
  if (row) {
    publicKey = row.public_key ?? row.PUBLIC_KEY ?? null;
  }

  if (!publicKey && isMongoConnected() && MongoUser) {
    const mongoUser = await MongoUser.findOne({ sqlId: targetId }).select('publicKey').lean();
    publicKey = mongoUser?.publicKey ?? null;
  }

  if (!publicKey) {
    return res.status(404).json({ error: 'User has no public key yet' });
  }

  return res.json({ userId: targetId, publicKey });
});

module.exports = router;
