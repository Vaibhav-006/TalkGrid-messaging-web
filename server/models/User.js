const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    sqlId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    displayName: { type: String },
    avatarColor: { type: String, default: '#25D366' },
    publicKey: { type: String, default: null },
    encryptedPrivateKeyBackup: { type: String, default: null },
    encryptedPrivateKeyIV: { type: String, default: null },
    encryptedPrivateKeySalt: { type: String, default: null },
    encryptedBackupUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

function formatUser(doc) {
  if (!doc) return null;
  return {
    id: doc.sqlId,
    username: doc.username,
    display_name: doc.displayName ?? null,
    avatar_color: doc.avatarColor ?? '#25D366',
  };
}

module.exports = { User, userSchema, formatUser };
