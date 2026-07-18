const mongoose = require('mongoose');

/**
 * Encrypted direct message — server stores opaque ciphertext + IV only.
 * The server cannot decrypt; clients derive the AES-GCM key via ECDH locally.
 */
const messageSchema = new mongoose.Schema(
  {
    conversationSqlId: { type: Number, index: true },
    /** Sender's SQLite user id */
    senderSqlId: { type: Number, required: true, index: true },
    /** Receiver's SQLite user id (1-on-1 chats) */
    receiverSqlId: { type: Number, index: true },
    /** AES-GCM ciphertext, Base64 (E2EE payloads) */
    ciphertext: { type: String, default: null },
    /** 12-byte IV, Base64 (E2EE payloads) */
    iv: { type: String, default: null },
    /** Legacy plaintext field — used by non-E2EE REST messages */
    content: { type: String, default: null },
  },
  { timestamps: true }
);

const MongoMessage = mongoose.models.MongoMessage || mongoose.model('MongoMessage', messageSchema);

module.exports = { messageSchema, Message: MongoMessage, MongoMessage };
