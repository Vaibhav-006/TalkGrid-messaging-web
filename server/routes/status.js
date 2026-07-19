const express = require('express');
const multer = require('multer');
const {
  Status,
  User,
  nextStatusId,
  ensureMongoConnected,
} = require('../mongo');
const { authMiddleware } = require('../auth');

const router = express.Router();
router.use(authMiddleware);

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'status_uploads', resource_type: 'auto' },
});

const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

function formatStatus(doc, user) {
  if (!doc) return null;
  return {
    id: doc.sqlId,
    user_id: doc.userSqlId,
    media_url: doc.mediaUrl,
    type: doc.type,
    created_at: doc.createdAt,
    username: user?.username,
    display_name: user?.displayName ?? null,
    avatar_color: user?.avatarColor ?? '#25D366',
  };
}

router.post('/', upload.single('media'), async (req, res) => {
  try {
    await ensureMongoConnected();
    if (!req.file) return res.status(400).json({ error: 'File required' });
    const type = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    const sqlId = await nextStatusId();
    const status = await Status.create({
      sqlId,
      userSqlId: Number(req.user.id),
      mediaUrl: req.file.path,
      type,
    });
    const user = await User.findOne({ sqlId: Number(req.user.id) }).lean();
    res.status(201).json(formatStatus(status, user));
  } catch (err) {
    console.error('Status upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.get('/', async (req, res) => {
  try {
    await ensureMongoConnected();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const statuses = await Status.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .lean();

    const userIds = [...new Set(statuses.map((s) => s.userSqlId))];
    const users = await User.find({ sqlId: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [u.sqlId, u]));

    res.json(statuses.map((s) => formatStatus(s, userMap.get(s.userSqlId))));
  } catch (err) {
    console.error('Status list error:', err);
    res.status(500).json({ error: 'Failed to load statuses' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await ensureMongoConnected();
    const id = parseInt(req.params.id, 10);
    const status = await Status.findOne({ sqlId: id }).lean();
    if (!status) return res.status(404).json({ error: 'Not found' });
    if (status.userSqlId !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    await Status.deleteOne({ sqlId: id });
    res.json({ success: true });
  } catch (err) {
    console.error('Status delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
