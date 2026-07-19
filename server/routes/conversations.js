const express = require('express');
const {
  Conversation,
  Message,
  User,
  formatUser,
  formatMessage,
  nextConversationId,
  findUserBySqlId,
  ensureMongoConnected,
} = require('../mongo');
const { authMiddleware } = require('../auth');
const {
  getMemberIds,
  getMemberRole,
  isGroupAdmin,
  emitToConversationMembers,
  isGroupConversation,
  isConversationMember,
  findDirectConversation,
  populateMemberUsers,
} = require('../conversationUtils');

async function getOtherMember(conversationId, myId) {
  const conv = await Conversation.findOne({ sqlId: Number(conversationId) }).lean();
  if (!conv || conv.isGroup) return null;
  const otherId = conv.members?.find((m) => Number(m.userId) !== Number(myId))?.userId;
  if (!otherId) return null;
  const user = await findUserBySqlId(otherId);
  return formatUser(user);
}

async function getMembers(conversationId) {
  const conv = await Conversation.findOne({ sqlId: Number(conversationId) }).lean();
  if (!conv?.members) return [];
  const ids = conv.members.map((m) => m.userId);
  const userMap = await populateMemberUsers(ids);
  return conv.members
    .map((m) => {
      const user = userMap.get(m.userId);
      if (!user) return null;
      return { ...user, role: m.role ?? 'member' };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.role === 'admin' && b.role !== 'admin') return -1;
      if (b.role === 'admin' && a.role !== 'admin') return 1;
      return (a.display_name || a.username).localeCompare(b.display_name || b.username);
    });
}

async function getLastMessage(conversationId) {
  const msg = await Message.findOne({ conversationSqlId: Number(conversationId) })
    .sort({ createdAt: -1 })
    .lean();
  if (!msg) return null;
  return {
    content: msg.ciphertext ? '🔒 Encrypted message' : (msg.content ?? ''),
    created_at: msg.createdAt,
  };
}

async function buildConversationSummary(conversationId, myId) {
  const member = await isConversationMember(conversationId, myId);
  if (!member) return null;

  const conv = await Conversation.findOne({ sqlId: Number(conversationId) }).lean();
  if (!conv) return null;

  const last = await getLastMessage(conversationId);
  const base = {
    id: conversationId,
    isGroup: !!conv.isGroup,
    lastMessage: last?.content ?? null,
    lastAt: last?.created_at ?? null,
  };

  if (conv.isGroup) {
    return {
      ...base,
      name: (conv.name || 'Group').trim() || 'Group',
      members: await getMembers(conversationId),
      myRole: await getMemberRole(conversationId, myId),
    };
  }

  const other = await getOtherMember(conversationId, myId);
  if (!other) return null;
  return { ...base, otherUser: other };
}

async function getConversationById(conversationId, myId) {
  return buildConversationSummary(conversationId, myId);
}

async function getMessages(conversationId) {
  const rows = await Message.find({ conversationSqlId: Number(conversationId) })
    .sort({ createdAt: 1 })
    .lean();

  const senderIds = [...new Set(rows.map((r) => r.senderSqlId))];
  const userMap = await populateMemberUsers(senderIds);

  return rows.map((r) => formatMessage(r, userMap.get(r.senderSqlId) ?? null));
}

async function notifyGroupUpdate(io, convId) {
  if (!io) return;
  const ids = await getMemberIds(convId);
  for (const uid of ids) {
    const conv = await getConversationById(convId, uid);
    if (conv) {
      io.to(`user:${String(uid)}`).emit('group:updated', { conversationId: convId, conversation: conv });
    }
  }
}

async function notifyNewConversation(io, convId, participantIds) {
  if (!io) return;
  for (const uid of participantIds) {
    const conv = await getConversationById(convId, uid);
    if (conv) {
      io.to(`user:${String(uid)}`).emit('conversation:new', conv);
    }
  }
}

function createRouter(io) {
  const router = express.Router();
  router.use(authMiddleware);

  router.post('/direct/:userId', async (req, res) => {
    try {
      await ensureMongoConnected();
      const myId = Number(req.user.id);
      const otherId = parseInt(req.params.userId, 10);
      if (Number.isNaN(otherId) || otherId < 1 || otherId === myId) {
        return res.status(400).json({ error: 'Invalid user' });
      }

      const other = await findUserBySqlId(otherId);
      if (!other) return res.status(404).json({ error: 'User not found' });

      const existing = await findDirectConversation(myId, otherId);
      if (existing) {
        const conv = await getConversationById(existing.sqlId, myId);
        return res.json({ ...conv, messages: await getMessages(existing.sqlId) });
      }

      const convId = await nextConversationId();
      await Conversation.create({
        sqlId: convId,
        isGroup: false,
        members: [
          { userId: myId, role: 'member' },
          { userId: otherId, role: 'member' },
        ],
      });

      const conv = await getConversationById(convId, myId);
      notifyNewConversation(io, convId, [otherId]);
      return res.status(201).json({ ...conv, messages: [] });
    } catch (err) {
      console.error('POST /direct/:userId error:', err);
      return res.status(500).json({ error: err.message || 'Failed to create conversation' });
    }
  });

  router.post('/group', async (req, res) => {
    try {
      await ensureMongoConnected();
      const myId = Number(req.user.id);
      const name = String(req.body?.name || '').trim();
      if (!name || name.length > 100) {
        return res.status(400).json({ error: 'Group name is required (max 100 characters)' });
      }

      const rawIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
      const memberIds = [...new Set(
        rawIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id) && id > 0 && id !== myId)
      )];

      if (memberIds.length < 1) {
        return res.status(400).json({ error: 'Add at least one other member to the group' });
      }

      for (const uid of memberIds) {
        const exists = await findUserBySqlId(uid);
        if (!exists) return res.status(404).json({ error: `User ${uid} not found` });
      }

      const convId = await nextConversationId();
      const members = [{ userId: myId, role: 'admin' }, ...memberIds.map((id) => ({ userId: id, role: 'member' }))];
      await Conversation.create({ sqlId: convId, isGroup: true, name, members });

      const conv = await getConversationById(convId, myId);
      notifyNewConversation(io, convId, memberIds);
      return res.status(201).json({ ...conv, messages: [] });
    } catch (err) {
      console.error('POST /group error:', err);
      return res.status(500).json({ error: err.message || 'Failed to create group' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      await ensureMongoConnected();
      const myId = Number(req.user.id);
      const convs = await Conversation.find({ 'members.userId': myId }).lean();

      const list = await Promise.all(convs.map(async (c) => {
        const last = await getLastMessage(c.sqlId);
        const base = {
          id: c.sqlId,
          isGroup: !!c.isGroup,
          lastMessage: last?.content ?? null,
          lastAt: last?.created_at ?? null,
        };
        if (c.isGroup) {
          return {
            ...base,
            name: (c.name || 'Group').trim() || 'Group',
            members: await getMembers(c.sqlId),
            myRole: await getMemberRole(c.sqlId, myId),
          };
        }
        return { ...base, otherUser: await getOtherMember(c.sqlId, myId) };
      }));

      list.sort((a, b) => {
        const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
        const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
        return tb - ta;
      });

      res.json(list.filter(Boolean));
    } catch (err) {
      console.error('GET /conversations error:', err);
      res.status(500).json({ error: 'Failed to load conversations' });
    }
  });

  router.patch('/:id/members/:userId/admin', async (req, res) => {
    try {
      await ensureMongoConnected();
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      const targetId = parseInt(req.params.userId, 10);
      if (!(await isGroupConversation(convId))) {
        return res.status(400).json({ error: 'Not a group conversation' });
      }
      if (!(await isGroupAdmin(convId, myId))) {
        return res.status(403).json({ error: 'Only admins can promote members' });
      }
      const conv = await Conversation.findOne({ sqlId: convId });
      const member = conv?.members?.find((m) => m.userId === targetId);
      if (!member) return res.status(404).json({ error: 'Member not found' });
      if (member.role === 'admin') {
        return res.status(400).json({ error: 'User is already an admin' });
      }
      member.role = 'admin';
      await conv.save();
      await notifyGroupUpdate(io, convId);
      return res.json(await getConversationById(convId, myId));
    } catch (err) {
      console.error('PATCH admin error:', err);
      return res.status(500).json({ error: err.message || 'Failed to promote member' });
    }
  });

  router.delete('/:id/members/:userId', async (req, res) => {
    try {
      await ensureMongoConnected();
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      const targetId = parseInt(req.params.userId, 10);
      if (!(await isGroupConversation(convId))) {
        return res.status(400).json({ error: 'Not a group conversation' });
      }
      if (!(await isGroupAdmin(convId, myId))) {
        return res.status(403).json({ error: 'Only admins can remove members' });
      }
      if (targetId === myId) {
        return res.status(400).json({ error: 'Admins cannot remove themselves' });
      }
      const conv = await Conversation.findOne({ sqlId: convId });
      const member = conv?.members?.find((m) => m.userId === targetId);
      if (!member) return res.status(404).json({ error: 'Member not found' });
      if (member.role === 'admin') {
        return res.status(400).json({ error: 'Cannot remove another admin' });
      }
      conv.members = conv.members.filter((m) => m.userId !== targetId);
      await conv.save();
      io.to(`user:${String(targetId)}`).emit('group:removed', { conversationId: convId });
      await notifyGroupUpdate(io, convId);
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE member error:', err);
      return res.status(500).json({ error: err.message || 'Failed to remove member' });
    }
  });

  router.delete('/:id/me', async (req, res) => {
    try {
      await ensureMongoConnected();
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      const conv = await Conversation.findOne({ sqlId: convId });
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      const member = conv.members?.find((m) => m.userId === myId);
      if (!member) return res.status(404).json({ error: 'Conversation not found' });

      if (conv.isGroup && member.role === 'admin') {
        const otherAdmin = conv.members.find((m) => m.userId !== myId && m.role === 'admin');
        if (!otherAdmin) {
          return res.status(400).json({
            error: 'Promote another admin before leaving, or delete the group from settings',
          });
        }
      }

      conv.members = conv.members.filter((m) => m.userId !== myId);
      if (conv.members.length === 0) {
        await Message.deleteMany({ conversationSqlId: convId });
        await Conversation.deleteOne({ sqlId: convId });
      } else {
        await conv.save();
        if (conv.isGroup) await notifyGroupUpdate(io, convId);
      }

      io.to(`user:${String(myId)}`).emit('conversation:deleted', { conversationId: convId });
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /me error:', err);
      return res.status(500).json({ error: err.message || 'Failed to delete chat' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await ensureMongoConnected();
      const myId = Number(req.user.id);
      const convId = parseInt(req.params.id, 10);
      if (!(await isGroupConversation(convId))) {
        return res.status(400).json({ error: 'Not a group conversation' });
      }
      if (!(await isGroupAdmin(convId, myId))) {
        return res.status(403).json({ error: 'Only admins can delete the group' });
      }
      const memberIds = await getMemberIds(convId);
      await Message.deleteMany({ conversationSqlId: convId });
      await Conversation.deleteOne({ sqlId: convId });
      for (const uid of memberIds) {
        io.to(`user:${String(uid)}`).emit('group:deleted', { conversationId: convId });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE group error:', err);
      return res.status(500).json({ error: err.message || 'Failed to delete group' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      await ensureMongoConnected();
      const id = parseInt(req.params.id, 10);
      const conv = await getConversationById(id, req.user.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      res.json({ ...conv, messages: await getMessages(id) });
    } catch (err) {
      console.error('GET conversation error:', err);
      res.status(500).json({ error: 'Failed to load conversation' });
    }
  });

  return router;
}

module.exports = createRouter;
module.exports.getConversationById = getConversationById;
module.exports.getOtherMember = getOtherMember;
module.exports.getMemberIds = getMemberIds;
module.exports.emitToConversationMembers = emitToConversationMembers;
module.exports.isGroupConversation = isGroupConversation;
