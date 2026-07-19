const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sqlId: { type: Number, required: true, unique: true, index: true },
    conversationSqlId: { type: Number, required: true, index: true },
    senderSqlId: { type: Number, required: true, index: true },
    receiverSqlId: { type: Number, default: null, index: true },
    content: { type: String, default: null },
    ciphertext: { type: String, default: null },
    iv: { type: String, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ conversationSqlId: 1, createdAt: 1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

const ENCRYPTED_PREVIEW = '🔒 Encrypted message';

function formatMessage(doc, sender = null) {
  if (!doc) return null;
  const ciphertext = doc.ciphertext || null;
  return {
    id: doc.sqlId,
    sender_id: doc.senderSqlId,
    receiver_id: doc.receiverSqlId ?? null,
    content: ciphertext ? ENCRYPTED_PREVIEW : (doc.content ?? ''),
    ciphertext,
    iv: doc.iv ?? null,
    encrypted: !!ciphertext,
    created_at: doc.createdAt,
    sender,
  };
}

module.exports = { Message, messageSchema, formatMessage, ENCRYPTED_PREVIEW };
