const { Message, nextMessageId } = require('./mongo');
const { isConversationMember } = require('./conversationUtils');
const { ENCRYPTED_PREVIEW } = require('./models/Message');

async function saveAndBroadcastEncryptedMessage(io, {
  senderId,
  receiverId,
  ciphertext,
  iv,
  conversationId,
}) {
  const sid = Number(senderId);
  const rid = Number(receiverId);

  if (conversationId != null && !Number.isNaN(conversationId)) {
    const convId = Number(conversationId);
    const senderMember = await isConversationMember(convId, sid);
    if (!senderMember) {
      const err = new Error('Not a member of this conversation');
      err.status = 403;
      throw err;
    }
    const receiverMember = await isConversationMember(convId, rid);
    if (!receiverMember) {
      const err = new Error('Receiver is not in this conversation');
      err.status = 403;
      throw err;
    }
  }

  const convIdNum = conversationId != null ? Number(conversationId) : null;
  const messageSqlId = await nextMessageId();
  const createdAt = new Date();

  if (convIdNum != null && !Number.isNaN(convIdNum)) {
    await Message.create({
      sqlId: messageSqlId,
      conversationSqlId: convIdNum,
      senderSqlId: sid,
      receiverSqlId: rid,
      content: ENCRYPTED_PREVIEW,
      ciphertext,
      iv,
    });
  }

  const outbound = {
    id: messageSqlId,
    senderId: sid,
    receiverId: rid,
    sender_id: sid,
    receiver_id: rid,
    conversationId: Number.isNaN(convIdNum) ? null : convIdNum,
    conversation_id: Number.isNaN(convIdNum) ? null : convIdNum,
    ciphertext,
    iv,
    encrypted: true,
    createdAt,
    created_at: createdAt,
  };

  if (io) {
    io.to(`user:${rid}`).emit('receive_message', outbound);
    io.to(`user:${sid}`).emit('receive_message', outbound);
  }

  return outbound;
}

module.exports = { saveAndBroadcastEncryptedMessage, ENCRYPTED_PREVIEW };
