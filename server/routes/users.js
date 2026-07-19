const express = require('express');
const { User, findUserBySqlId, ensureMongoConnected } = require('../mongo');
const { authMiddleware } = require('../auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    await ensureMongoConnected();
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q) return res.json([]);

    const user = await User.findOne({
      sqlId: { $ne: Number(req.user.id) },
      username: q,
    }).lean();

    if (!user) return res.json([]);
    res.json([{
      id: user.sqlId,
      username: user.username,
      display_name: user.displayName ?? null,
      avatar_color: user.avatarColor ?? '#25D366',
    }]);
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.put('/me/public-key', async (req, res) => {
  try {
    await ensureMongoConnected();
    const publicKey = typeof req.body?.publicKey === 'string' ? req.body.publicKey.trim() : '';
    if (!publicKey || publicKey.length < 32) {
      return res.status(400).json({ error: 'Valid publicKey (Base64 SPKI) required' });
    }

    await User.findOneAndUpdate(
      { sqlId: Number(req.user.id) },
      { publicKey },
      { new: true }
    );

    return res.json({ ok: true, publicKey });
  } catch (err) {
    console.error('public-key upload error:', err);
    return res.status(500).json({ error: 'Failed to store public key' });
  }
});

router.get('/:userId/public-key', async (req, res) => {
  try {
    await ensureMongoConnected();
    const targetId = parseInt(req.params.userId, 10);
    if (!targetId || Number.isNaN(targetId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findOne({ sqlId: targetId }).select('publicKey sqlId').lean();
    if (!user?.publicKey) {
      return res.status(404).json({ error: 'User has no public key yet' });
    }

    return res.json({ userId: targetId, publicKey: user.publicKey });
  } catch (err) {
    console.error('public-key fetch error:', err);
    return res.status(500).json({ error: 'Failed to load public key' });
  }
});

router.get('/me/profile', async (req, res) => {
  try {
    await ensureMongoConnected();
    const user = await findUserBySqlId(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      userId: user.sqlId,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      publicKey: user.publicKey || null,
      encryptedPrivateKeyBackup: user.encryptedPrivateKeyBackup || null,
      encryptedPrivateKeyIV: user.encryptedPrivateKeyIV || null,
      encryptedPrivateKeySalt: user.encryptedPrivateKeySalt || null,
      encryptedBackupUpdatedAt: user.encryptedBackupUpdatedAt || null,
    });
  } catch (err) {
    console.error('profile fetch error:', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.put('/me/encrypted-key-backup', async (req, res) => {
  try {
    await ensureMongoConnected();
    const encryptedPrivateKey = typeof req.body?.encryptedPrivateKey === 'string'
      ? req.body.encryptedPrivateKey.trim()
      : '';
    const iv = typeof req.body?.iv === 'string' ? req.body.iv.trim() : '';
    const salt = typeof req.body?.salt === 'string' ? req.body.salt.trim() : '';

    if (!encryptedPrivateKey || !iv || !salt) {
      return res.status(400).json({
        error: 'encryptedPrivateKey, iv, and salt (all Base64) required',
      });
    }

    await User.findOneAndUpdate(
      { sqlId: Number(req.user.id) },
      {
        encryptedPrivateKeyBackup: encryptedPrivateKey,
        encryptedPrivateKeyIV: iv,
        encryptedPrivateKeySalt: salt,
        encryptedBackupUpdatedAt: new Date(),
      }
    );

    return res.json({ ok: true, message: 'Encrypted key backup stored successfully' });
  } catch (err) {
    console.error('backup upload error:', err);
    return res.status(500).json({ error: 'Failed to store encrypted backup' });
  }
});

module.exports = router;
