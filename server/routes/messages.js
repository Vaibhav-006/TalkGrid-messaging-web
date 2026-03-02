const express = require('express');
const db = require('../db');
const { MongoMessage } = require('../mongo');
const { authMiddleware } = require('../auth');

function createRouter(io) {
  const router = express.Router();
  router.use(authMiddleware);

  function parseCreatedAt(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const str = String(value);
    if (!str) return null;
    // SQLite CURRENT_TIMESTAMP is UTC like "YYYY-MM-DD HH:MM:SS"
    let normalized = str.includes('T') ? str : str.replace(' ', 'T');
    const hasZone = normalized.endsWith('Z') || /[+\-]\d{2}:\d{2}$/.test(normalized);
    if (!hasZone) normalized += 'Z';
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  // Get messages for a conversation
  router.get('/conversation/:conversationId', (req, res) => {
    const convId = parseInt(req.params.conversationId, 10);
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, req.user.id);
    if (!member) return res.status(404).json({ error: 'Conversation not found' });
    const messages = db.prepare(`
      SELECT id, sender_id, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(convId);
    res.json(messages);
  });

  // Send a message (works even when socket is not connected)
  router.post('/send', (req, res) => {
    const { conversationId, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    const convId = parseInt(conversationId, 10);
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, req.user.id);
    if (!member) return res.status(404).json({ error: 'Conversation not found' });
    db.prepare('INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)').run(convId, req.user.id, content.trim());
    const row = db.prepare('SELECT id, conversation_id, sender_id, content, created_at FROM messages WHERE id = (SELECT last_insert_rowid())').get();
    const senderRow = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(req.user.id);
    const sender = senderRow ? {
      id: senderRow.id ?? senderRow.ID,
      username: senderRow.username ?? senderRow.USERNAME,
      display_name: senderRow.display_name ?? senderRow.DISPLAY_NAME,
      avatar_color: senderRow.avatar_color ?? senderRow.AVATAR_COLOR,
    } : null;
    const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(convId, req.user.id);
    const payload = {
      id: row?.id ?? row?.ID,
      conversation_id: row?.conversation_id ?? row?.CONVERSATION_ID ?? convId,
      sender_id: row?.sender_id ?? row?.SENDER_ID ?? req.user.id,
      content: row?.content ?? row?.CONTENT ?? content.trim(),
      created_at: row?.created_at ?? row?.CREATED_AT,
      sender,
    };
    if (MongoMessage) {
      MongoMessage.create({
        conversationSqlId: convId,
        senderSqlId: req.user.id,
        content: payload.content,
      }).catch((err) => {
        console.error('MongoMessage create failed:', err.message);
      });
    }
    if (io) {
      const myId = String(req.user.id);
      const otherId = other && String(other.user_id ?? other.USER_ID);
      io.to('user:' + myId).emit('message:new', payload);
      if (otherId) io.to('user:' + otherId).emit('message:new', payload);
    }
    res.status(201).json(payload);
  });

  // Delete a message (only sender, only within 5 minutes). Deletes for both ends via socket event.
  const DELETE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  router.delete('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    const msg = db.prepare('SELECT id, conversation_id, sender_id, created_at FROM messages WHERE id = ?').get(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }
    const created = parseCreatedAt(msg.created_at ?? msg.CREATED_AT);
    if (created) {
      const createdMs = created.getTime();
      if (Date.now() - createdMs > DELETE_WINDOW_MS) {
        return res.status(403).json({ error: 'Can only delete messages within 5 minutes' });
      }
    }
    const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(msg.conversation_id, req.user.id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    if (io) {
      const myId = String(req.user.id);
      const otherId = other && String(other.user_id ?? other.USER_ID);
      const payload = { id, conversation_id: msg.conversation_id };
      io.to('user:' + myId).emit('message:deleted', payload);
      if (otherId) io.to('user:' + otherId).emit('message:deleted', payload);
    }
    return res.status(204).end();
  });

  return router;
}

module.exports = createRouter;
