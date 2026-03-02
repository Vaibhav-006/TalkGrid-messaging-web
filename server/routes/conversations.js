const express = require('express');
const db = require('../db');
const { MongoConversation } = require('../mongo');
const { authMiddleware } = require('../auth');

// Helper: get numeric id from sql.js row (handles id/ID casing)
function rowId(row) {
  if (!row) return null;
  const v = row.id !== undefined ? row.id : row.ID;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') return parseInt(v, 10);
  return null;
}

function getOtherMember(conversationId, myId) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color
    FROM conversation_members m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND m.user_id != ?
  `).get(conversationId, myId);
  if (!row) return null;
  return {
    id: rowId(row),
    username: row.username ?? row.USERNAME ?? '',
    display_name: row.display_name ?? row.DISPLAY_NAME ?? null,
    avatar_color: row.avatar_color ?? row.AVATAR_COLOR ?? null,
  };
}

function getConversationById(conversationId, myId) {
  const other = getOtherMember(conversationId, myId);
  if (!other) return null;
  const last = db.prepare(`
    SELECT content, created_at FROM messages
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(conversationId);
  return {
    id: conversationId,
    otherUser: other,
    lastMessage: last ? (last.content ?? last.CONTENT ?? null) : null,
    lastAt: last ? (last.created_at ?? last.CREATED_AT ?? null) : null,
  };
}

function createRouter(io) {
  const router = express.Router();
  router.use(authMiddleware);

  // Get or create 1:1 conversation with another user
  router.post('/direct/:userId', (req, res) => {
  try {
    const myId = Number(req.user.id);
    if (!req.user?.id || Number.isNaN(myId) || myId < 1) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const otherId = parseInt(req.params.userId, 10);
    if (Number.isNaN(otherId) || otherId < 1 || otherId === myId) {
      return res.status(400).json({ error: 'Invalid user' });
    }
    const other = db.prepare('SELECT id FROM users WHERE id = ?').get(otherId);
    if (!other) return res.status(404).json({ error: 'User not found' });

    // Find existing 1:1 conversation
    const existing = db.prepare(`
      SELECT c.id FROM conversations c
      INNER JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
      INNER JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
      WHERE (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
    `).get(myId, otherId);

    const existingConvId = rowId(existing);
    if (existingConvId) {
      const conv = getConversationById(existingConvId, myId);
      return res.json(conv);
    }

    db.prepare('INSERT INTO conversations DEFAULT VALUES').run();
    const newRow = db.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get();
    const convId = rowId(newRow);
    if (!convId) {
      return res.status(500).json({ error: 'Failed to create conversation' });
    }
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)').run(convId, myId, convId, otherId);
    if (MongoConversation) {
      MongoConversation.findOneAndUpdate(
        { sqlId: convId },
        {
          sqlId: convId,
          participantsSqlIds: [myId, otherId],
        },
        { upsert: true, setDefaultsOnInsert: true }
      ).catch((err) => {
        console.error('MongoConversation upsert failed:', err.message);
      });
    }
    const conv = getConversationById(convId, myId);
    if (!conv) {
      return res.status(500).json({ error: 'Failed to load conversation' });
    }
    // Notify the other user in real time so the new chat appears without refresh
    if (io) {
      const meAsOther = getOtherMember(convId, otherId);
      if (meAsOther) {
        const convForOther = { id: convId, otherUser: meAsOther, lastMessage: null, lastAt: null };
        io.to('user:' + String(otherId)).emit('conversation:new', convForOther);
      }
    }
    return res.status(201).json(conv);
  } catch (err) {
    console.error('POST /direct/:userId error:', err);
    const msg = err && (err.message || String(err));
    return res.status(500).json({ error: msg || 'Failed to create conversation' });
  }
  });

  // List my conversations with last message
  router.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT c.id,
             (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_at
      FROM conversations c
      INNER JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      ORDER BY last_at DESC
    `).all(req.user.id);
    const list = rows.map((r) => {
      const cid = rowId(r);
      const other = cid ? getOtherMember(cid, req.user.id) : null;
      return {
        id: cid,
        otherUser: other,
        lastMessage: r.last_message ?? r.LAST_MESSAGE ?? null,
        lastAt: r.last_at ?? r.LAST_AT ?? null,
      };
    });
    res.json(list);
  });

  // Get one conversation with messages
  router.get('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const conv = getConversationById(id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    const messages = db.prepare(`
      SELECT id, sender_id, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(id);
    res.json({ ...conv, messages });
  });

  return router;
}

module.exports = createRouter;
module.exports.getConversationById = getConversationById;
module.exports.getOtherMember = getOtherMember;
