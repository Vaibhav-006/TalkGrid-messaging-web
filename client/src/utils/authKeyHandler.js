/**
 * FIX 1: Strict Local Key Initialization with Encrypted Backup Support
 * 
 * This module prevents accidental key pair overwrites and handles multi-device recovery
 * through encrypted private key backups stored on the backend.
 */

import {
  generateKeyPair,
  exportPublicKey,
  verifyKeyPairMatches,
} from './cryptoUtils';
import {
  getPrivateKey,
  savePrivateKey,
  getPublicKey,
  savePublicKey,
  deletePrivateKey,
  saveEncryptedPrivateKeyBackup,
  getEncryptedPrivateKeyBackup,
} from './keyStorage';
import { fetchUserProfile, uploadPublicKey, uploadEncryptedKeyBackup } from '../api';

/**
 * Derives an encryption key from user's password using PBKDF2.
 * Used to encrypt/decrypt private key backups.
 * 
 * @param {string} password - User's account password
 * @param {Uint8Array} salt - PBKDF2 salt (recommended: 16 bytes)
 * @returns {Promise<CryptoKey>} - AES-256-GCM key
 */
export async function derivePBKDF2Key(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);

  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    data,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000, // NIST recommendation for 2024+
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable for security
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a private key using a derived PBKDF2 key.
 * Returns encrypted data and IV in Base64 for backend storage.
 * 
 * @param {CryptoKey} privateKey - The ECDH private key (raw or CryptoKey)
 * @param {string} password - User's password for PBE
 * @returns {Promise<{encryptedPrivateKey: string, iv: string, salt: string}>}
 */
export async function encryptPrivateKeyWithPassword(privateKey, password) {
  // Export the private key to raw bytes for encryption
  const privateKeyBytes = await window.crypto.subtle.exportKey('pkcs8', privateKey);

  // Generate random salt and IV
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit for GCM

  // Derive encryption key from password
  const encryptionKey = await derivePBKDF2Key(password, salt);

  // Encrypt the private key
  const encryptedData = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    privateKeyBytes
  );

  // Convert to Base64 for storage
  return {
    encryptedPrivateKey: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    salt: btoa(String.fromCharCode(...new Uint8Array(salt))),
  };
}

/**
 * Decrypts a private key backup using a password.
 * Restores the private key back into IndexedDB.
 * 
 * @param {string} encryptedPrivateKeyBase64 - Encrypted private key from backend
 * @param {string} ivBase64 - IV from backend
 * @param {string} saltBase64 - Salt from backend
 * @param {string} password - User's password for decryption
 * @returns {Promise<CryptoKey>} - Restored private key
 */
export async function decryptPrivateKeyWithPassword(
  encryptedPrivateKeyBase64,
  ivBase64,
  saltBase64,
  password
) {
  // Decode from Base64
  const encryptedData = Uint8Array.from(atob(encryptedPrivateKeyBase64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));

  // Derive decryption key
  const decryptionKey = await derivePBKDF2Key(password, salt);

  // Decrypt the private key bytes
  const decryptedPrivateKeyBytes = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    decryptionKey,
    encryptedData
  );

  // Import back as a CryptoKey
  const privateKey = await window.crypto.subtle.importKey(
    'pkcs8',
    decryptedPrivateKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // non-extractable for security
    ['deriveBits']
  );

  return privateKey;
}

/**
 * STRATEGIC FIX 1: Initialize or recover user's encryption keys
 * 
 * Flow:
 * 1. Check if private key exists in IndexedDB → reuse it (history intact)
 * 2. If not, fetch user profile from backend:
 *    - If backend has publicKey → user logged in from new device
 *      Return { status: 'NEEDS_BACKUP_RESTORE', hasBackup: true/false }
 *    - If backend has encrypted backup → user can recover keys
 *    - If backend has neither → new registration, generate fresh keys
 * 3. Only generate new keys if user is completely new
 * 
 * @param {number} userId - User's SQL ID
 * @param {Object} options
 * @param {string} [options.password] - User's password (needed for backup recovery)
 * @returns {Promise<{status: string, action: string, requiresPassword?: boolean}>}
 */
export async function initializeUserKeys(userId, options = {}) {
  if (!userId) {
    throw new Error('userId is required for key initialization');
  }

  const password = options.password || null;

  // STEP 1: Check IndexedDB for existing private key
  console.log('[E2EE] Step 1: Checking IndexedDB for existing private key...');
  let localPrivateKey = await getPrivateKey(userId);
  let localPublicKey = await getPublicKey(userId);

  if (localPrivateKey && localPublicKey) {
    // Validate the key pair matches
    const isValid = await verifyKeyPairMatches(localPrivateKey, localPublicKey);
    if (isValid) {
      console.log('[E2EE] ✓ Existing keys found in IndexedDB. Reusing for history integrity.');
      // Ensure public key is synced to server
      await uploadPublicKey(localPublicKey);
      return {
        status: 'SUCCESS',
        action: 'KEYS_REUSED',
        message: 'Existing encryption keys loaded from IndexedDB',
      };
    }
    // Keys are corrupted, clear them
    await deletePrivateKey(userId);
    localPrivateKey = null;
    localPublicKey = null;
  }

  // STEP 2: Fetch user profile from backend
  console.log('[E2EE] Step 2: Fetching user profile from backend...');
  let userProfile;
  try {
    userProfile = await fetchUserProfile();
  } catch (err) {
    console.error('[E2EE] Failed to fetch user profile:', err);
    throw new Error('Failed to fetch user profile for key initialization');
  }

  const backendPublicKey = userProfile?.publicKey || null;
  const backendEncryptedKeyBackup = userProfile?.encryptedPrivateKeyBackup || null;
  const backendIV = userProfile?.encryptedPrivateKeyIV || null;
  const backendSalt = userProfile?.encryptedPrivateKeySalt || null;

  // STEP 3: Determine the appropriate action
  if (backendPublicKey || backendEncryptedKeyBackup) {
    // User is logging in from a new device/browser
    console.log('[E2EE] User detected on new device/browser.');

    if (backendEncryptedKeyBackup && backendIV && backendSalt) {
      // User has an encrypted backup → they can recover keys
      console.log('[E2EE] Encrypted backup found on backend. Prompting for password recovery...');
      return {
        status: 'NEEDS_BACKUP_RESTORE',
        action: 'RESTORE_FROM_BACKUP',
        requiresPassword: true,
        hasBackup: true,
        message: 'Encrypted backup found. Please provide your password to recover encryption keys.',
      };
    } else if (backendPublicKey) {
      // User has a public key but no backup—older account
      console.log('[E2EE] Public key exists without encrypted backup (legacy account).');
      return {
        status: 'NEEDS_BACKUP_RESTORE',
        action: 'MANUAL_KEY_RECOVERY_NEEDED',
        requiresPassword: false,
        hasBackup: false,
        message: 'Your account has encryption keys on another device. This is a legacy account without encrypted backup. Messages from this browser will not decrypt old history.',
      };
    }
  }

  // STEP 4: New registration—generate fresh key pair
  if (!backendPublicKey && !backendEncryptedKeyBackup) {
    console.log('[E2EE] New user registration. Generating fresh ECDH key pair...');
    const { publicKey, privateKey: newPrivate } = await generateKeyPair();
    const publicKeyBase64 = await exportPublicKey(publicKey);

    // Save to IndexedDB
    await savePrivateKey(userId, newPrivate);
    await savePublicKey(userId, publicKeyBase64);

    // Upload public key to backend
    await uploadPublicKey(publicKeyBase64);

    // If password provided, create encrypted backup
    if (password) {
      console.log('[E2EE] Password provided. Creating encrypted backup...');
      const backup = await encryptPrivateKeyWithPassword(newPrivate, password);
      await uploadEncryptedKeyBackup({
        encryptedPrivateKey: backup.encryptedPrivateKey,
        iv: backup.iv,
        salt: backup.salt,
      });
      await saveEncryptedPrivateKeyBackup(userId, backup);
    }

    return {
      status: 'SUCCESS',
      action: 'NEW_KEYS_GENERATED',
      message: 'New encryption key pair generated and stored securely.',
    };
  }

  throw new Error('[E2EE] Unexpected key initialization state');
}

/**
 * STRATEGIC FIX 2: Recover keys from encrypted backup on a new device
 * 
 * Called when user returns { status: 'NEEDS_BACKUP_RESTORE' } from initializeUserKeys().
 * Prompts for password, decrypts backup, and restores keys to IndexedDB.
 * 
 * @param {number} userId - User's SQL ID
 * @param {string} password - User's password for decryption
 * @returns {Promise<{status: string, message: string}>}
 */
export async function recoverKeysFromBackup(userId, password) {
  if (!userId || !password) {
    throw new Error('userId and password required for backup recovery');
  }

  console.log('[E2EE] Step 1: Fetching encrypted backup from backend...');
  let userProfile;
  try {
    userProfile = await fetchUserProfile();
  } catch (err) {
    console.error('[E2EE] Failed to fetch user profile:', err);
    throw new Error('Failed to fetch encrypted backup');
  }

  const encryptedPrivateKey = userProfile?.encryptedPrivateKeyBackup;
  const iv = userProfile?.encryptedPrivateKeyIV;
  const salt = userProfile?.encryptedPrivateKeySalt;

  if (!encryptedPrivateKey || !iv || !salt) {
    throw new Error('No encrypted backup found on server. Cannot recover keys.');
  }

  console.log('[E2EE] Step 2: Decrypting private key with password...');
  let recoveredPrivateKey;
  try {
    recoveredPrivateKey = await decryptPrivateKeyWithPassword(
      encryptedPrivateKey,
      iv,
      salt,
      password
    );
  } catch (err) {
    console.error('[E2EE] Decryption failed:', err);
    throw new Error('Incorrect password or corrupted backup. Cannot recover keys.');
  }

  console.log('[E2EE] Step 3: Restoring recovered keys to IndexedDB...');
  const publicKeyBase64 = userProfile?.publicKey;
  if (!publicKeyBase64) {
    throw new Error('Public key not found in user profile');
  }

  await savePrivateKey(userId, recoveredPrivateKey);
  await savePublicKey(userId, publicKeyBase64);

  console.log('[E2EE] ✓ Keys successfully recovered and restored to IndexedDB.');
  return {
    status: 'SUCCESS',
    message: 'Encryption keys recovered and restored. Chat history is now accessible.',
  };
}
