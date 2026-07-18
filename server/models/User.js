const mongoose = require('mongoose');

/**
 * User document — stores the ECDH public key and encrypted private key backup.
 * 
 * Security Model:
 * - publicKey: ECDH P-256 public key (SPKI, Base64) — shareable, used by other clients
 * - encryptedPrivateKeyBackup: AES-256-GCM encrypted private key (Base64)
 *   - Encrypted using user's password via PBKDF2 derivation
 *   - User can recover keys on new devices by providing their password
 * - encryptedPrivateKeyIV: IV used for AES-GCM encryption (Base64)
 * - encryptedPrivateKeySalt: PBKDF2 salt (Base64)
 * 
 * Private key never exists in plaintext on the server. Recovery requires the user's password.
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
    /** Encrypted private key backup (AES-256-GCM, Base64) — allows multi-device recovery */
    encryptedPrivateKeyBackup: { type: String, default: null },
    /** IV for AES-GCM encryption (Base64, 12 bytes = 96 bits) */
    encryptedPrivateKeyIV: { type: String, default: null },
    /** PBKDF2 salt for key derivation (Base64, typically 16 bytes) */
    encryptedPrivateKeySalt: { type: String, default: null },
    /** Timestamp when encrypted backup was created/last updated */
    encryptedBackupUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const MongoUser = mongoose.models.MongoUser || mongoose.model('MongoUser', userSchema);

module.exports = { userSchema, User: MongoUser, MongoUser };
