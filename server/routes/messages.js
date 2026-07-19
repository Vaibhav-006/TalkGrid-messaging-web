const express = require('express');
const {
  Message,
  formatMessage,
  nextMessageId,
  findUserBySqlId,
  formatUser,
  ensureMongoConnected,
} = require('../mongo');
const { authMiddleware } = require('../auth');
const { emitToConversationMembers, isConversationMember } = require('../conversationUtils');
const { saveAndBroadcastEncryptedMessage } = require('../e2eeMessages');

function createRouter(io) {
  const router = express.Router();
  router.use(authMiddleware);

  router.get('/conversation/:conversationId', async (req, res) => {
    try {
      await ensureMongoConnected();
      const convId = parseInt(req.params.conversationId, 10);
      if (!(await isConversationMember(convId, req.user.id))) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const messages = await Message.find({ conversationSqlId: convId }).sort({ createdAt: 1 }).lean();
      const senderIds = [...new Set(messages.map((m) => m.senderSqlId))];
      const users = await Promise.all(senderIds.map((id) => findUserBySqlId(id)));
      const userMap = new Map(users.filter(Boolean).map((u) => [u.sqlId, formatUser(u)]));
      res.json(messages.map((m) => formatMessage(m, userMap.get(m.senderSqlId) ?? null)));
    } catch (err) {
      console.error('GET messages error:', err);
      res.status(500).json({ error: 'Failed to load messages' });
    }
  });

  router.post('/send', async (req, res) => {
    try {
      await ensureMongoConnected();
      const { conversationId, content } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
      const convId = parseInt(conversationId, 10);
      if (!(await isConversationMember(convId, req.user.id))) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const messageSqlId = await nextMessageId();
      const msg = await Message.create({
        sqlId: messageSqlId,
        conversationSqlId: convId,
        senderSqlId: Number(req.user.id),
        content: content.trim(),
      });

      const senderDoc = await findUserBySqlId(req.user.id);
      const payload = {
        id: msg.sqlId,
        conversation_id: convId,
        sender_id: msg.senderSqlId,
        content: msg.content,
        created_at: msg.createdAt,
        sender: formatUser(senderDoc),
      };

      emitToConversationMembers(io, convId, 'message:new', payload);
      res.status(201).json(payload);
    } catch (err) {
      console.error('POST /send error:', err);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  router.post('/send-encrypted', async (req, res) => {
    try {
      await ensureMongoConnected();
      const { conversationId, receiverId, ciphertext, iv } = req.body;
      const ct = typeof ciphertext === 'string' ? ciphertext.trim() : '';
      const ivStr = typeof iv === 'string' ? iv.trim() : '';
      const rid = parseInt(receiverId, 10);
      const convId = conversationId != null ? parseInt(conversationId, 10) : null;

      if (!rid || Number.isNaN(rid)) {
        return res.status(400).json({ error: 'Valid receiverId required' });
      }
      if (!ct || !ivStr) {
        return res.status(400).json({ error: 'ciphertext and iv are required' });
      }

      const outbound = await saveAndBroadcastEncryptedMessage(io, {
        senderId: Number(req.user.id),
        receiverId: rid,
        ciphertext: ct,
        iv: ivStr,
        conversationId: convId,
      });

      return res.status(201).json(outbound);
    } catch (err) {
      console.error('[E2EE] POST /send-encrypted failed:', err);
      return res.status(err.status || 500).json({ error: err.message || 'Failed to send encrypted message' });
    }
  });

  const DELETE_WINDOW_MS = 5 * 60 * 1000;

  router.delete('/:id', async (req, res) => {
    try {
      await ensureMongoConnected();
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid message id' });
      }
      const msg = await Message.findOne({ sqlId: id }).lean();
      if (!msg) return res.status(404).json({ error: 'Message not found' });
      if (msg.senderSqlId !== Number(req.user.id)) {
        return res.status(403).json({ error: 'You can only delete your own messages' });
      }
      if (msg.createdAt && Date.now() - new Date(msg.createdAt).getTime() > DELETE_WINDOW_MS) {
        return res.status(403).json({ error: 'Can only delete messages within 5 minutes' });
      }
      await Message.deleteOne({ sqlId: id });
      emitToConversationMembers(io, msg.conversationSqlId, 'message:deleted', {
        id,
        conversation_id: msg.conversationSqlId,
      });
      return res.status(204).end();
    } catch (err) {
      console.error('DELETE message error:', err);
      return res.status(500).json({ error: 'Failed to delete message' });
    }
  });

  return router;
}

module.exports = createRouter;
