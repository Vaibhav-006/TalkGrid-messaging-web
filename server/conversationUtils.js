const { Conversation, User, formatUser } = require('./mongo');

async function getMemberIds(conversationId) {
  const conv = await Conversation.findOne({ sqlId: Number(conversationId) }).lean();
  if (!conv?.members) return [];
  return conv.members.map((m) => Number(m.userId)).filter((id) => !Number.isNaN(id) && id > 0);
}

function emitToConversationMembers(io, conversationId, event, payload) {
  if (!io) return;
  getMemberIds(conversationId).then((ids) => {
    for (const id of ids) {
      io.to(`user:${String(id)}`).emit(event, payload);
    }
  }).catch((err) => console.error('emitToConversationMembers:', err.message));
}

async function getMemberRole(conversationId, userId) {
  const conv = await Conversation.findOne({ sqlId: Number(conversationId) }).lean();
  if (!conv) return null;
  const member = conv.members?.find((m) => Number(m.userId) === Number(userId));
  return member?.role ?? null;
}

async function isGroupAdmin(conversationId, userId) {
  return (await getMemberRole(conversationId, userId)) === 'admin';
}

async function isGroupConversation(conversationId) {
  const conv = await Conversation.findOne({ sqlId: Number(conversationId) }).lean();
  return !!conv?.isGroup;
}

async function isConversationMember(conversationId, userId) {
  const conv = await Conversation.findOne({ sqlId: Number(conversationId) }).lean();
  if (!conv) return false;
  return conv.members?.some((m) => Number(m.userId) === Number(userId));
}

async function findDirectConversation(userIdA, userIdB) {
  const a = Number(userIdA);
  const b = Number(userIdB);
  return Conversation.findOne({
    isGroup: false,
    $and: [
      { members: { $elemMatch: { userId: a } } },
      { members: { $elemMatch: { userId: b } } },
      { $expr: { $eq: [{ $size: '$members' }, 2] } },
    ],
  }).lean();
}

async function populateMemberUsers(memberIds) {
  const users = await User.find({ sqlId: { $in: memberIds } }).lean();
  const map = new Map(users.map((u) => [u.sqlId, formatUser(u)]));
  return map;
}

module.exports = {
  formatUser,
  getMemberIds,
  getMemberRole,
  isGroupAdmin,
  emitToConversationMembers,
  isGroupConversation,
  isConversationMember,
  findDirectConversation,
  populateMemberUsers,
};
