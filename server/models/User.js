const mongoose = require('mongoose');

/**
 * User document — stores the ECDH public key only (SPKI, Base64).
 * Private keys are generated and stored client-side in IndexedDB; never sent to the server.
 */
const userSchema = new mongoose.Schema(
  {
    /** SQLite user id (primary app id) */
    sqlId: { type: Number, index: true, unique: true, sparse: true },
    username: { type: String, required: true, lowercase: true, trim: true, index: true },
    displayName: { type: String },
    avatarColor: { type: String, default: '#25D366' },
    /** ECDH P-256 public key, SPKI format, Base64-encoded */
    publicKey: { type: String, default: null },
  },
  { timestamps: true }
);

const MongoUser = mongoose.models.MongoUser || mongoose.model('MongoUser', userSchema);

module.exports = { userSchema, User: MongoUser, MongoUser };
