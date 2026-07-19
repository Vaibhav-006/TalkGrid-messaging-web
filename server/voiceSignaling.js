/**
 * WebRTC signaling relay for 1:1 voice. Verifies both users are in the conversation.
 */
const { Conversation, findUserBySqlId } = require('./mongo');
const { isConversationMember } = require('./conversationUtils');

module.exports = function registerVoiceHandlers(socket, io) {
  async function peerInConversation(convId, myId) {
    const cid = Number(convId);
    const me = Number(myId);
    if (Number.isNaN(cid) || Number.isNaN(me)) return null;
    const conv = await Conversation.findOne({ sqlId: cid }).lean();
    if (!conv) return null;
    const other = conv.members?.find((m) => Number(m.userId) !== me);
    return other ? Number(other.userId) : null;
  }

  async function validatePeerPayload(payload) {
    const convId = parseInt(payload?.conversationId, 10);
    const targetUserId = Number(payload?.targetUserId);
    if (Number.isNaN(convId) || !targetUserId) return { error: 'Invalid payload' };
    const myId = Number(socket.userId);
    if (!(await isConversationMember(convId, myId))) return { error: 'Not in conversation' };
    const peer = await peerInConversation(convId, myId);
    if (peer !== targetUserId) return { error: 'Invalid peer' };
    return { convId, targetUserId, myId };
  }

  function toUser(userId, event, data) {
    io.to('user:' + String(userId)).emit(event, data);
  }

  socket.on('voice:ring', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error) return;
    const row = await findUserBySqlId(r.myId);
    toUser(r.targetUserId, 'voice:incoming', {
      conversationId: r.convId,
      fromUserId: r.myId,
      fromUsername: row?.username ?? '',
      fromDisplayName: row?.displayName ?? null,
    });
  });

  socket.on('voice:cancel', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:cancelled', { conversationId: r.convId });
  });

  socket.on('voice:accept', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:accepted', {
      conversationId: r.convId,
      peerUserId: r.myId,
    });
  });

  socket.on('voice:decline', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:declined', { conversationId: r.convId });
  });

  socket.on('voice:offer', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error || !payload?.sdp) return;
    toUser(r.targetUserId, 'voice:offer', {
      conversationId: r.convId,
      fromUserId: r.myId,
      sdp: payload.sdp,
    });
  });

  socket.on('voice:answer', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error || !payload?.sdp) return;
    toUser(r.targetUserId, 'voice:answer', {
      conversationId: r.convId,
      fromUserId: r.myId,
      sdp: payload.sdp,
    });
  });

  socket.on('voice:ice', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error || payload.candidate == null) return;
    toUser(r.targetUserId, 'voice:ice', {
      conversationId: r.convId,
      fromUserId: r.myId,
      candidate: payload.candidate,
    });
  });

  socket.on('voice:hangup', async (payload) => {
    const r = await validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:hangup', { conversationId: r.convId });
  });
};
