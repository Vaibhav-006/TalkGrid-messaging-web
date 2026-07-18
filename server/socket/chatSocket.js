const { saveAndBroadcastEncryptedMessage } = require('../e2eeMessages');

/**
 * Register E2EE chat Socket.io handlers on a connected socket.
 */
function registerChatSocketHandlers(io, socket) {
  const authenticatedUserId = Number(socket.userId);

  socket.on('send_message', async (payload, ack) => {
    try {
      const senderId = Number(payload?.senderId);
      const receiverId = Number(payload?.receiverId);
      const ciphertext = typeof payload?.ciphertext === 'string' ? payload.ciphertext.trim() : '';
      const iv = typeof payload?.iv === 'string' ? payload.iv.trim() : '';
      const conversationId = payload?.conversationId != null
        ? parseInt(payload.conversationId, 10)
        : null;

      if (senderId !== authenticatedUserId) {
        if (typeof ack === 'function') ack({ error: 'senderId must match authenticated user' });
        return;
      }
      if (!receiverId || Number.isNaN(receiverId) || receiverId < 1) {
        if (typeof ack === 'function') ack({ error: 'Valid receiverId required' });
        return;
      }
      if (!ciphertext || !iv) {
        if (typeof ack === 'function') ack({ error: 'ciphertext and iv are required' });
        return;
      }

      const outbound = await saveAndBroadcastEncryptedMessage(io, {
        senderId,
        receiverId,
        ciphertext,
        iv,
        conversationId,
      });

      if (typeof ack === 'function') {
        ack({ ok: true, message: outbound });
      }
    } catch (err) {
      console.error('[E2EE] send_message failed:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message || 'Failed to send encrypted message' });
      }
    }
  });
}

function setupChatSocket(io) {
  io.on('connection', (socket) => {
    registerChatSocketHandlers(io, socket);
  });
}

module.exports = {
  registerChatSocketHandlers,
  setupChatSocket,
};
