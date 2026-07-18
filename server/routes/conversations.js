const express = require('express');
const db = require('../db');
const { MongoConversation, isMongoConnected } = require('../mongo');
const { authMiddleware } = require('../auth');
const {
  rowId,
  formatUser,
  getMemberIds,
  getMemberRole,
  isGroupAdmin,
  emitToConversationMembers,
  isGroupConversation,
} = require('../conversationUtils');

function getOtherMember(conversationId, myId) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color
    FROM conversation_members m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND m.user_id != ?
  `).get(conversationId, myId);
  return formatUser(row);
}

function getMembers(conversationId) {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, m.role
    FROM conversation_members m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
    ORDER BY CASE WHEN m.role = 'admin' THEN 0 ELSE 1 END, u.display_name, u.username
  `).all(conversationId);
  return rows.map((r) => {
    const user = formatUser(r);
    if (!user) return null;
    return { ...user, role: r.role ?? r.ROLE ?? 'member' };
  }).filter(Boolean);
}

function getLastMessage(conversationId) {
  const row = db.prepare(`
    SELECT content, ciphertext, created_at FROM messages
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(conversationId);
  if (!row) return null;
  const ciphertext = row.ciphertext ?? row.CIPHERTEXT;
  const content = row.content ?? row.CONTENT;
  return {
    content: ciphertext ? '🔒 Encrypted message' : content,
    created_at: row.created_at ?? row.CREATED_AT,
  };
}

function buildConversationSummary(conversationId, myId) {
  const member = db.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).get(conversationId, myId);
  if (!member) return null;

  const convRow = db.prepare('SELECT id, is_group, name FROM conversations WHERE id = ?').get(conversationId);
  if (!convRow) return null;

  const isGroup = Number(convRow.is_group ?? convRow.IS_GROUP) === 1;
  const last = getLastMessage(conversationId);
  const base = {
    id: conversationId,
    isGroup,
    lastMessage: last ? (last.content ?? last.CONTENT ?? null) : null,
    lastAt: last ? (last.created_at ?? last.CREATED_AT ?? null) : null,
  };

  if (isGroup) {
    return {
      ...base,
      name: (convRow.name ?? convRow.NAME ?? 'Group').trim() || 'Group',
      members: getMembers(conversationId),
      myRole: getMemberRole(conversationId, myId),
    };
  }

  const other = getOtherMember(conversationId, myId);
  if (!other) return null;
  return { ...base, otherUser: other };
}

function getConversationById(conversationId, myId) {
  return buildConversationSummary(conversationId, myId);
}

function getMessages(conversationId) {
  const rows = db.prepare(`
    SELECT m.id, m.sender_id, m.receiver_id, m.content, m.ciphertext, m.iv, m.created_at,
           u.username, u.display_name, u.avatar_color
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
  `).all(conversationId);

  return rows.map((r) => ({
    id: r.id ?? r.ID,
    sender_id: r.sender_id ?? r.SENDER_ID,
    receiver_id: r.receiver_id ?? r.RECEIVER_ID ?? null,
    content: r.content ?? r.CONTENT,
    ciphertext: r.ciphertext ?? r.CIPHERTEXT ?? null,
    iv: r.iv ?? r.IV ?? null,
    encrypted: !!(r.ciphertext ?? r.CIPHERTEXT),
    created_at: r.created_at ?? r.CREATED_AT,
    sender: formatUser({
      id: r.sender_id ?? r.SENDER_ID,
      username: r.username ?? r.USERNAME,
      display_name: r.display_name ?? r.DISPLAY_NAME,
      avatar_color: r.avatar_color ?? r.AVATAR_COLOR,
    }),
  }));
}

function notifyGroupUpdate(io, convId) {
  if (!io) return;
  for (const uid of getMemberIds(convId)) {
    const conv = getConversationById(convId, uid);
    if (conv) {
      io.to(`user:${String(uid)}`).emit('group:updated', { conversationId: convId, conversation: conv });
    }
  }
}
function notifyNewConversation(io, convId, participantIds) {
  if (!io) return;
  for (const uid of participantIds) {
    const conv = getConversationById(convId, uid);
    if (conv) {
      io.to(`user:${String(uid)}`).emit('conversation:new', conv);
    }
  }
}

function createRouter(io) {
  const router = express.Router();
  router.use(authMiddleware);

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

      const existing = db.prepare(`
        SELECT c.id FROM conversations c
        INNER JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
        INNER JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
        WHERE COALESCE(c.is_group, 0) = 0
          AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
      `).get(myId, otherId);

      const existingConvId = rowId(existing);
      if (existingConvId) {
        const conv = getConversationById(existingConvId, myId);
        return res.json({ ...conv, messages: getMessages(existingConvId) });
      }

      db.prepare('INSERT INTO conversations (is_group) VALUES (0)').run();
      const newRow = db.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get();
      const convId = rowId(newRow);
      if (!convId) {
        return res.status(500).json({ error: 'Failed to create conversation' });
      }
      db.prepare(
        'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)'
      ).run(convId, myId, convId, otherId);

      if (isMongoConnected() && MongoConversation) {
        MongoConversation.findOneAndUpdate(
          { sqlId: convId },
          { sqlId: convId, participantsSqlIds: [myId, otherId], isGroup: false },
          { upsert: true, setDefaultsOnInsert: true }
        ).catch((err) => {
          console.error('MongoConversation upsert failed:', err.message);
        });
      }

      const conv = getConversationById(convId, myId);
      if (!conv) {
        return res.status(500).json({ error: 'Failed to load conversation' });
      }
      notifyNewConversation(io, convId, [otherId]);
      return res.status(201).json({ ...conv, messages: [] });
    } catch (err) {
      console.error('POST /direct/:userId error:', err);
      const msg = err && (err.message || String(err));
      return res.status(500).json({ error: msg || 'Failed to create conversation' });
    }
  });

  router.post('/group', (req, res) => {
    try {
      const myId = Number(req.user.id);
      if (!req.user?.id || Number.isNaN(myId) || myId < 1) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const name = String(req.body?.name || '').trim();
      if (!name || name.length > 100) {
        return res.status(400).json({ error: 'Group name is required (max 100 characters)' });
      }

      const rawIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
      const memberIds = [...new Set(
        rawIds
          .map((id) => parseInt(id, 10))
          .filter((id) => !Number.isNaN(id) && id > 0 && id !== myId)
      )];

      if (memberIds.length < 1) {
        return res.status(400).json({ error: 'Add at least one other member to the group' });
      }

      for (const uid of memberIds) {
        const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (!exists) return res.status(404).json({ error: `User ${uid} not found` });
      }

      db.prepare('INSERT INTO conversations (is_group, name) VALUES (1, ?)').run(name);
      const newRow = db.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get();
      const convId = rowId(newRow);
      if (!convId) {
        return res.status(500).json({ error: 'Failed to create group' });
      }

      const allMemberIds = [myId, ...memberIds];
      const insertMember = db.prepare(
        'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)'
      );
      insertMember.run(convId, myId, 'admin');
      for (const uid of memberIds) {
        insertMember.run(convId, uid, 'member');
      }

      if (isMongoConnected() && MongoConversation) {
        MongoConversation.findOneAndUpdate(
          { sqlId: convId },
          { sqlId: convId, participantsSqlIds: allMemberIds, isGroup: true, name },
          { upsert: true, setDefaultsOnInsert: true }
        ).catch((err) => {
          console.error('MongoConversation upsert failed:', err.message);
        });
      }

      const conv = getConversationById(convId, myId);
      if (!conv) {
        return res.status(500).json({ error: 'Failed to load group' });
      }

      notifyNewConversation(io, convId, memberIds);
      return res.status(201).json({ ...conv, messages: [] });
    } catch (err) {
      console.error('POST /group error:', err);
      const msg = err && (err.message || String(err));
      return res.status(500).json({ error: msg || 'Failed to create group' });
    }
  });

  router.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT c.id,
             COALESCE(c.is_group, 0) as is_group,
             c.name,
             (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_at
      FROM conversations c
      INNER JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      ORDER BY last_at DESC
    `).all(req.user.id);

    const list = rows.map((r) => {
      const cid = rowId(r);
      if (!cid) return null;
      const isGroup = Number(r.is_group ?? r.IS_GROUP) === 1;
      const lastMessage = r.last_message ?? r.LAST_MESSAGE ?? null;
      const lastAt = r.last_at ?? r.LAST_AT ?? null;

      if (isGroup) {
        return {
          id: cid,
          isGroup: true,
          name: (r.name ?? r.NAME ?? 'Group').trim() || 'Group',
          members: getMembers(cid),
          myRole: getMemberRole(cid, req.user.id),
          lastMessage,
          lastAt,
        };
      }

      const other = getOtherMember(cid, req.user.id);
      return {
        id: cid,
        isGroup: false,
        otherUser: other,
        lastMessage,
        lastAt,
      };
    }).filter(Boolean);

    res.json(list);
  });

  router.patch('/:id/members/:userId/admin', (req, res) => {
    try {
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      const targetId = parseInt(req.params.userId, 10);
      if (Number.isNaN(convId) || Number.isNaN(targetId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      if (!isGroupConversation(convId)) {
        return res.status(400).json({ error: 'Not a group conversation' });
      }
      if (!isGroupAdmin(convId, myId)) {
        return res.status(403).json({ error: 'Only admins can promote members' });
      }
      const member = db.prepare(
        'SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
      ).get(convId, targetId);
      if (!member) return res.status(404).json({ error: 'Member not found' });
      if ((member.role ?? member.ROLE) === 'admin') {
        return res.status(400).json({ error: 'User is already an admin' });
      }
      db.prepare(
        "UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?"
      ).run(convId, targetId);
      notifyGroupUpdate(io, convId);
      const conv = getConversationById(convId, myId);
      return res.json(conv);
    } catch (err) {
      console.error('PATCH /:id/members/:userId/admin error:', err);
      return res.status(500).json({ error: err.message || 'Failed to promote member' });
    }
  });

  router.delete('/:id/members/:userId', (req, res) => {
    try {
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      const targetId = parseInt(req.params.userId, 10);
      if (Number.isNaN(convId) || Number.isNaN(targetId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      if (!isGroupConversation(convId)) {
        return res.status(400).json({ error: 'Not a group conversation' });
      }
      if (!isGroupAdmin(convId, myId)) {
        return res.status(403).json({ error: 'Only admins can remove members' });
      }
      if (targetId === myId) {
        return res.status(400).json({ error: 'Admins cannot remove themselves' });
      }
      const member = db.prepare(
        'SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
      ).get(convId, targetId);
      if (!member) return res.status(404).json({ error: 'Member not found' });
      if ((member.role ?? member.ROLE) === 'admin') {
        return res.status(400).json({ error: 'Cannot remove another admin' });
      }
      db.prepare(
        'DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
      ).run(convId, targetId);
      io.to(`user:${String(targetId)}`).emit('group:removed', { conversationId: convId });
      notifyGroupUpdate(io, convId);
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /:id/members/:userId error:', err);
      return res.status(500).json({ error: err.message || 'Failed to remove member' });
    }
  });

  router.delete('/:id/me', (req, res) => {
    try {
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const member = db.prepare(
        'SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
      ).get(convId, myId);
      if (!member) return res.status(404).json({ error: 'Conversation not found' });

      const isGroup = isGroupConversation(convId);
      if (isGroup) {
        const role = member.role ?? member.ROLE;
        if (role === 'admin') {
          const otherAdmin = db.prepare(`
            SELECT user_id FROM conversation_members
            WHERE conversation_id = ? AND user_id != ? AND role = 'admin'
          `).get(convId, myId);
          if (!otherAdmin) {
            return res.status(400).json({
              error: 'Promote another admin before leaving, or delete the group from settings',
            });
          }
        }
      }

      db.prepare(
        'DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
      ).run(convId, myId);

      const remaining = db.prepare(
        'SELECT COUNT(*) as c FROM conversation_members WHERE conversation_id = ?'
      ).get(convId);
      const remainingCount = Number(remaining?.c ?? remaining?.C ?? 0);
      if (remainingCount === 0) {
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId);
        db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
      }

      io.to(`user:${String(myId)}`).emit('conversation:deleted', { conversationId: convId });
      if (isGroup && remainingCount > 0) {
        notifyGroupUpdate(io, convId);
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /:id/me error:', err);
      return res.status(500).json({ error: err.message || 'Failed to delete chat' });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      if (!isGroupConversation(convId)) {
        return res.status(400).json({ error: 'Not a group conversation' });
      }
      if (!isGroupAdmin(convId, myId)) {
        return res.status(403).json({ error: 'Only admins can delete the group' });
      }
      const memberIds = getMemberIds(convId);
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId);
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(convId);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
      for (const uid of memberIds) {
        io.to(`user:${String(uid)}`).emit('group:deleted', { conversationId: convId });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /:id error:', err);
      return res.status(500).json({ error: err.message || 'Failed to delete group' });
    }
  });

  router.get('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const conv = getConversationById(id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ ...conv, messages: getMessages(id) });
  });

  return router;
}

module.exports = createRouter;
module.exports.getConversationById = getConversationById;
module.exports.getOtherMember = getOtherMember;
module.exports.getMemberIds = getMemberIds;
module.exports.emitToConversationMembers = emitToConversationMembers;
module.exports.isGroupConversation = isGroupConversation;
