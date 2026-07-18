const db = require('./db');
const { saveMessageToMongo } = require('./mongo');

const ENCRYPTED_PREVIEW = '🔒 Encrypted message';

/**
 * Persist and broadcast an E2EE message. Used by Socket.io and REST.
 * @returns {Promise<object>} outbound payload for clients
 */
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
    const member = db.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).get(convId, sid);
    if (!member) {
      const err = new Error('Not a member of this conversation');
      err.status = 403;
      throw err;
    }
    const receiverMember = db.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).get(convId, rid);
    if (!receiverMember) {
      const err = new Error('Receiver is not in this conversation');
      err.status = 403;
      throw err;
    }
  }

  let sqliteId = null;
  let createdAt = new Date().toISOString();
  const convIdNum = conversationId != null ? Number(conversationId) : null;

  if (convIdNum != null && !Number.isNaN(convIdNum)) {
    db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, receiver_id, content, ciphertext, iv)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convIdNum, sid, rid, ENCRYPTED_PREVIEW, ciphertext, iv);

    const row = db.prepare(`
      SELECT id, created_at FROM messages WHERE id = (SELECT last_insert_rowid())
    `).get();
    sqliteId = row?.id ?? row?.ID ?? null;
    createdAt = row?.created_at ?? row?.CREATED_AT ?? createdAt;
  }

  const outbound = {
    id: sqliteId,
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

  await saveMessageToMongo({
    conversationSqlId: Number.isNaN(convIdNum) ? null : convIdNum,
    senderSqlId: sid,
    receiverSqlId: rid,
    ciphertext,
    iv,
  }).catch((err) => {
    console.error('[E2EE] MongoMessage create failed:', err.message);
  });

  return outbound;
}

module.exports = { saveAndBroadcastEncryptedMessage, ENCRYPTED_PREVIEW };
