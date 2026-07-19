const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    userId: { type: Number, required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    sqlId: { type: Number, required: true, unique: true, index: true },
    isGroup: { type: Boolean, default: false },
    name: { type: String, default: null },
    members: [memberSchema],
  },
  { timestamps: true }
);

conversationSchema.index({ 'members.userId': 1 });

const Conversation = mongoose.models.Conversation
  || mongoose.model('Conversation', conversationSchema);

module.exports = { Conversation, conversationSchema };
