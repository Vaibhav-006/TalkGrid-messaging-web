/**
 * WebRTC signaling relay for 1:1 voice. Verifies both users are in the conversation.
 */
module.exports = function registerVoiceHandlers(socket, io, db) {
  function memberUserId(row) {
    if (!row) return null;
    const v = row.user_id ?? row.USER_ID;
    return v != null ? Number(v) : null;
  }

  function isMember(convId, userId) {
    const uid = Number(userId);
    const cid = Number(convId);
    if (Number.isNaN(uid) || Number.isNaN(cid)) return false;
    const m = db.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).get(cid, uid);
    return !!m;
  }

  function peerInConversation(convId, myId) {
    const cid = Number(convId);
    const me = Number(myId);
    if (Number.isNaN(cid) || Number.isNaN(me)) return null;
    const row = db.prepare(
      `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?`
    ).get(cid, me);
    return memberUserId(row);
  }

  function validatePeerPayload(payload) {
    const convId = parseInt(payload?.conversationId, 10);
    const targetUserId = Number(payload?.targetUserId);
    if (Number.isNaN(convId) || !targetUserId) return { error: 'Invalid payload' };
    const myId = Number(socket.userId);
    if (!isMember(convId, myId)) return { error: 'Not in conversation' };
    const peer = peerInConversation(convId, myId);
    if (peer !== targetUserId) return { error: 'Invalid peer' };
    return { convId, targetUserId, myId };
  }

  function toUser(userId, event, data) {
    io.to('user:' + String(userId)).emit(event, data);
  }

  socket.on('voice:ring', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error) return;
    const row = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(r.myId);
    toUser(r.targetUserId, 'voice:incoming', {
      conversationId: r.convId,
      fromUserId: r.myId,
      fromUsername: row?.username ?? row?.USERNAME ?? '',
      fromDisplayName: row?.display_name ?? row?.DISPLAY_NAME ?? null,
    });
  });

  socket.on('voice:cancel', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:cancelled', { conversationId: r.convId });
  });

  socket.on('voice:accept', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:accepted', {
      conversationId: r.convId,
      peerUserId: r.myId,
    });
  });

  socket.on('voice:decline', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:declined', { conversationId: r.convId });
  });

  socket.on('voice:offer', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error || !payload?.sdp) return;
    toUser(r.targetUserId, 'voice:offer', {
      conversationId: r.convId,
      fromUserId: r.myId,
      sdp: payload.sdp,
    });
  });

  socket.on('voice:answer', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error || !payload?.sdp) return;
    toUser(r.targetUserId, 'voice:answer', {
      conversationId: r.convId,
      fromUserId: r.myId,
      sdp: payload.sdp,
    });
  });

  socket.on('voice:ice', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error || payload.candidate == null) return;
    toUser(r.targetUserId, 'voice:ice', {
      conversationId: r.convId,
      fromUserId: r.myId,
      candidate: payload.candidate,
    });
  });

  socket.on('voice:hangup', (payload) => {
    const r = validatePeerPayload(payload);
    if (r.error) return;
    toUser(r.targetUserId, 'voice:hangup', { conversationId: r.convId });
  });
};
