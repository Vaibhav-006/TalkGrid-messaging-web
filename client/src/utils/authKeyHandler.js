/**
 * E2EE key initialization — runs once on login/register.
 * Never regenerates keys when a private key already exists in IndexedDB.
 */

import {
  generateKeyPair,
  exportPublicKey,
} from './cryptoUtils';
import {
  getPrivateKey,
  savePrivateKey,
  getPublicKey,
  savePublicKey,
  saveEncryptedPrivateKeyBackup,
  hasKeyStoredFlag,
} from './keyStorage';
import { fetchUserProfile, uploadPublicKey, uploadEncryptedKeyBackup } from '../api';

/**
 * Derives an encryption key from user's password using PBKDF2.
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
      iterations: 600000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt PKCS8 private key bytes with a password-derived key.
 */
export async function encryptPrivateKeyPkcs8WithPassword(pkcs8Bytes, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encryptionKey = await derivePBKDF2Key(password, salt);

  const encryptedData = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    pkcs8Bytes
  );

  return {
    encryptedPrivateKey: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    salt: btoa(String.fromCharCode(...new Uint8Array(salt))),
  };
}

/**
 * Decrypts a private key backup and imports it as a non-extractable CryptoKey.
 */
export async function decryptPrivateKeyWithPassword(
  encryptedPrivateKeyBase64,
  ivBase64,
  saltBase64,
  password
) {
  const encryptedData = Uint8Array.from(atob(encryptedPrivateKeyBase64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));

  const decryptionKey = await derivePBKDF2Key(password, salt);

  const decryptedPrivateKeyBytes = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    decryptionKey,
    encryptedData
  );

  return window.crypto.subtle.importKey(
    'pkcs8',
    decryptedPrivateKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
}

/** Upload public key only when the server does not already have one. */
async function syncPublicKeyIfMissing(localPublicKeyBase64) {
  if (!localPublicKeyBase64) return;
  try {
    const profile = await fetchUserProfile();
    if (!profile?.publicKey) {
      await uploadPublicKey(localPublicKeyBase64);
    }
  } catch (err) {
    console.warn('[E2EE] Could not verify server public key; skipping upload:', err);
  }
}

/**
 * Initialize or recover user's encryption keys.
 */
export async function initializeUserKeys(userId, options = {}) {
  if (!userId) {
    throw new Error('userId is required for key initialization');
  }

  const password = options.password || null;

  // STEP 1: Reuse private key from IndexedDB — never delete or regenerate it.
  console.log('[E2EE] Checking IndexedDB for existing private key...');
  let localPrivateKey = await getPrivateKey(userId);
  let localPublicKey = await getPublicKey(userId);

  if (localPrivateKey) {
    if (!localPublicKey) {
      console.log('[E2EE] Private key found but public key missing locally — fetching from server...');
      try {
        const profile = await fetchUserProfile();
        if (profile?.publicKey) {
          localPublicKey = profile.publicKey;
          await savePublicKey(userId, localPublicKey);
        }
      } catch (err) {
        console.warn('[E2EE] Could not fetch public key from server:', err);
      }
    }

    console.log('[E2EE] Existing private key found in IndexedDB — reusing for history integrity.');
    syncPublicKeyIfMissing(localPublicKey).catch((err) => {
      console.warn('[E2EE] Background public key sync failed:', err);
    });
    return {
      status: 'SUCCESS',
      action: 'KEYS_REUSED',
      message: 'Existing encryption keys loaded from IndexedDB',
    };
  }

  // STEP 2: No local private key — check backend for recovery or new-user flow.
  console.log('[E2EE] No local private key — fetching user profile from backend...');
  if (hasKeyStoredFlag(userId)) {
    console.warn('[E2EE] Key flag found in localStorage but IndexedDB is empty — browser storage may have been cleared.');
  }
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

  // STEP 3: Try automatic backup restore when password is available (login).
  if (backendEncryptedKeyBackup && backendIV && backendSalt && password) {
    console.log('[E2EE] Encrypted backup found — restoring with login password...');
    try {
      await recoverKeysFromBackup(userId, password, userProfile);
      return {
        status: 'SUCCESS',
        action: 'KEYS_RESTORED_FROM_BACKUP',
        message: 'Encryption keys restored from encrypted backup',
      };
    } catch (err) {
      console.warn('[E2EE] Automatic backup restore failed:', err);
    }
  }

  if (backendPublicKey || backendEncryptedKeyBackup) {
    if (backendEncryptedKeyBackup && backendIV && backendSalt) {
      console.log('[E2EE] Encrypted backup found — password required for recovery.');
      return {
        status: 'NEEDS_BACKUP_RESTORE',
        action: 'RESTORE_FROM_BACKUP',
        requiresPassword: true,
        hasBackup: true,
        message: 'Encrypted backup found. Please provide your password to recover encryption keys.',
      };
    }

    console.log('[E2EE] Public key on server but no local keys or backup.');
    return {
      status: 'NEEDS_BACKUP_RESTORE',
      action: 'MANUAL_KEY_RECOVERY_NEEDED',
      requiresPassword: false,
      hasBackup: false,
      message: 'Encryption keys not found in this browser.',
    };
  }

  // STEP 4: Brand-new user — generate a fresh key pair.
  console.log('[E2EE] New user — generating ECDH key pair...');
  const { publicKey, privateKey: newPrivate, privateKeyPkcs8 } = await generateKeyPair();
  const publicKeyBase64 = await exportPublicKey(publicKey);

  await savePrivateKey(userId, newPrivate);
  await savePublicKey(userId, publicKeyBase64);

  const persisted = await getPrivateKey(userId);
  if (!persisted) {
    throw new Error('Failed to persist encryption keys in this browser');
  }

  await uploadPublicKey(publicKeyBase64);

  if (password && privateKeyPkcs8) {
    console.log('[E2EE] Creating encrypted private key backup...');
    try {
      const backup = await encryptPrivateKeyPkcs8WithPassword(privateKeyPkcs8, password);
      await uploadEncryptedKeyBackup({
        encryptedPrivateKey: backup.encryptedPrivateKey,
        iv: backup.iv,
        salt: backup.salt,
      });
      await saveEncryptedPrivateKeyBackup(userId, backup);
    } catch (err) {
      console.warn('[E2EE] Could not create encrypted backup:', err);
    }
  }

  return {
    status: 'SUCCESS',
    action: 'NEW_KEYS_GENERATED',
    message: 'New encryption key pair generated and stored securely.',
  };
}

/**
 * Recover keys from encrypted backup (manual modal or auto on login with password).
 */
export async function recoverKeysFromBackup(userId, password, profileOverride = null) {
  if (!userId || !password) {
    throw new Error('userId and password required for backup recovery');
  }

  let userProfile = profileOverride;
  if (!userProfile) {
    userProfile = await fetchUserProfile();
  }

  const encryptedPrivateKey = userProfile?.encryptedPrivateKeyBackup;
  const iv = userProfile?.encryptedPrivateKeyIV;
  const salt = userProfile?.encryptedPrivateKeySalt;

  if (!encryptedPrivateKey || !iv || !salt) {
    throw new Error('No encrypted backup found on server. Cannot recover keys.');
  }

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

  const publicKeyBase64 = userProfile?.publicKey;
  if (!publicKeyBase64) {
    throw new Error('Public key not found in user profile');
  }

  await savePrivateKey(userId, recoveredPrivateKey);
  await savePublicKey(userId, publicKeyBase64);

  const persisted = await getPrivateKey(userId);
  if (!persisted) {
    throw new Error('Failed to persist recovered keys in this browser');
  }

  console.log('[E2EE] Keys recovered and restored to IndexedDB.');
  return {
    status: 'SUCCESS',
    message: 'Encryption keys recovered and restored. Chat history is now accessible.',
  };
}

/**
 * Generate new keys when user explicitly skips recovery on a new device.
 * Old encrypted history will remain unreadable on this browser.
 */
export async function generateFreshKeysAfterSkip(userId) {
  const existing = await getPrivateKey(userId);
  if (existing) {
    return { status: 'SUCCESS', action: 'KEYS_ALREADY_PRESENT' };
  }

  const { publicKey, privateKey: newPrivate } = await generateKeyPair();
  const publicKeyBase64 = await exportPublicKey(publicKey);

  await savePrivateKey(userId, newPrivate);
  await savePublicKey(userId, publicKeyBase64);

  const persisted = await getPrivateKey(userId);
  if (!persisted) {
    throw new Error('Failed to persist encryption keys in this browser');
  }

  await uploadPublicKey(publicKeyBase64);

  return {
    status: 'SUCCESS',
    action: 'NEW_KEYS_AFTER_SKIP',
    message: 'New encryption keys created. Previous messages from other devices cannot be decrypted here.',
  };
}
