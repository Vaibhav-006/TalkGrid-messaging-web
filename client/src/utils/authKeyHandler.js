/**
 * E2EE key initialization — runs once on login/register.
 * Never regenerates keys when a private key already exists in local storage.
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
  saveLocalEncryptedBackup,
  getLocalEncryptedBackup,
  hasKeyStoredFlag,
} from './keyStorage';
import { fetchUserProfile, uploadPublicKey, uploadEncryptedKeyBackup } from '../api';

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

export async function encryptPrivateKeyPkcs8WithPassword(pkcs8Bytes, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptionKey = await derivePBKDF2Key(password, salt);
  const encryptedData = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    toPkcs8Buffer(pkcs8Bytes)
  );

  return {
    encryptedPrivateKey: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    salt: btoa(String.fromCharCode(...new Uint8Array(salt))),
  };
}

function toPkcs8Buffer(pkcs8Bytes) {
  if (pkcs8Bytes instanceof ArrayBuffer) return pkcs8Bytes;
  if (ArrayBuffer.isView(pkcs8Bytes)) {
    return pkcs8Bytes.buffer.slice(
      pkcs8Bytes.byteOffset,
      pkcs8Bytes.byteOffset + pkcs8Bytes.byteLength
    );
  }
  throw new Error('Invalid PKCS8 bytes');
}

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

  return {
    privateKey: await window.crypto.subtle.importKey(
      'pkcs8',
      decryptedPrivateKeyBytes,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey']
    ),
    pkcs8: decryptedPrivateKeyBytes,
  };
}

async function persistKeyPair(userId, privateKey, publicKeyBase64, pkcs8Bytes) {
  await savePrivateKey(userId, privateKey, pkcs8Bytes);
  await savePublicKey(userId, publicKeyBase64);
  const persisted = await getPrivateKey(userId);
  if (!persisted) {
    throw new Error('Failed to persist encryption keys in this browser');
  }
}

async function storePasswordBackups(userId, pkcs8Bytes, password, publicKeyBase64) {
  if (!password || !pkcs8Bytes) return;

  const backup = await encryptPrivateKeyPkcs8WithPassword(pkcs8Bytes, password);
  saveLocalEncryptedBackup(userId, backup);

  try {
    await uploadEncryptedKeyBackup({
      encryptedPrivateKey: backup.encryptedPrivateKey,
      iv: backup.iv,
      salt: backup.salt,
    });
    await saveEncryptedPrivateKeyBackup(userId, backup);
  } catch (err) {
    console.warn('[E2EE] Server backup upload failed (local backup saved):', err);
  }

  try {
    const profile = await fetchUserProfile();
    if (!profile?.publicKey) {
      await uploadPublicKey(publicKeyBase64);
    }
  } catch {
    await uploadPublicKey(publicKeyBase64);
  }
}

async function restoreFromEncryptedBackup(userId, backup, password, publicKeyBase64) {
  const { privateKey, pkcs8 } = await decryptPrivateKeyWithPassword(
    backup.encryptedPrivateKey,
    backup.iv,
    backup.salt,
    password
  );
  await persistKeyPair(userId, privateKey, publicKeyBase64, pkcs8);
  saveLocalEncryptedBackup(userId, backup);
}

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

export async function initializeUserKeys(userId, options = {}) {
  if (!userId) {
    throw new Error('userId is required for key initialization');
  }

  const password = options.password || null;

  // STEP 1: Reuse private key from local storage — never delete or regenerate.
  console.log('[E2EE] Checking local storage for existing private key...');
  let localPrivateKey = await getPrivateKey(userId);
  let localPublicKey = await getPublicKey(userId);

  if (localPrivateKey) {
    if (!localPublicKey) {
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

    console.log('[E2EE] Existing private key loaded — reusing for history integrity.');
    syncPublicKeyIfMissing(localPublicKey).catch(() => {});
    return {
      status: 'SUCCESS',
      action: 'KEYS_REUSED',
      message: 'Existing encryption keys loaded',
    };
  }

  // STEP 2: Try local password backup (localStorage) before hitting server.
  const localBackup = getLocalEncryptedBackup(userId);
  if (localBackup && password) {
    console.log('[E2EE] Trying local encrypted backup...');
    try {
      let publicKeyBase64 = localPublicKey;
      if (!publicKeyBase64) {
        const profile = await fetchUserProfile();
        publicKeyBase64 = profile?.publicKey;
      }
      if (publicKeyBase64) {
        await restoreFromEncryptedBackup(userId, localBackup, password, publicKeyBase64);
        return {
          status: 'SUCCESS',
          action: 'KEYS_RESTORED_LOCAL',
          message: 'Encryption keys restored from local backup',
        };
      }
    } catch (err) {
      console.warn('[E2EE] Local backup restore failed:', err);
    }
  }

  // STEP 3: Fetch server profile for recovery or new-user flow.
  console.log('[E2EE] No local private key — checking server profile...');
  if (hasKeyStoredFlag(userId)) {
    console.warn('[E2EE] Key flag present but private key missing — storage may have been cleared.');
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

  // STEP 4: Restore from server backup when password is available.
  if (backendEncryptedKeyBackup && backendIV && backendSalt && password) {
    console.log('[E2EE] Restoring from server encrypted backup...');
    try {
      await recoverKeysFromBackup(userId, password, userProfile);
      return {
        status: 'SUCCESS',
        action: 'KEYS_RESTORED_FROM_BACKUP',
        message: 'Encryption keys restored from server backup',
      };
    } catch (err) {
      console.warn('[E2EE] Server backup restore failed:', err);
    }
  }

  if (backendEncryptedKeyBackup && backendIV && backendSalt) {
    return {
      status: 'NEEDS_BACKUP_RESTORE',
      action: 'RESTORE_FROM_BACKUP',
      requiresPassword: true,
      hasBackup: true,
      message: 'Enter your password to recover encryption keys.',
    };
  }

  if (backendPublicKey) {
    if (password) {
      return {
        status: 'NEEDS_BACKUP_RESTORE',
        action: 'RESTORE_FROM_BACKUP',
        requiresPassword: true,
        hasBackup: false,
        message: 'Encryption keys missing. Enter your password — if you registered before backup was enabled, old messages may be unreadable.',
      };
    }
    return {
      status: 'NEEDS_BACKUP_RESTORE',
      action: 'RESTORE_FROM_BACKUP',
      requiresPassword: true,
      hasBackup: false,
      message: 'Encryption keys missing. Log out and sign in again with your password.',
    };
  }

  // STEP 5: Brand-new user — generate keys and store PKCS8 bytes.
  console.log('[E2EE] New user — generating ECDH key pair...');
  const { publicKey, privateKey: newPrivate, privateKeyPkcs8 } = await generateKeyPair();
  const publicKeyBase64 = await exportPublicKey(publicKey);

  await persistKeyPair(userId, newPrivate, publicKeyBase64, privateKeyPkcs8);
  await uploadPublicKey(publicKeyBase64);
  await storePasswordBackups(userId, privateKeyPkcs8, password, publicKeyBase64);

  return {
    status: 'SUCCESS',
    action: 'NEW_KEYS_GENERATED',
    message: 'New encryption key pair generated',
  };
}

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
  const localBackup = getLocalEncryptedBackup(userId);

  const backup = (encryptedPrivateKey && iv && salt)
    ? { encryptedPrivateKey, iv, salt }
    : localBackup;

  if (!backup?.encryptedPrivateKey || !backup?.iv || !backup?.salt) {
    throw new Error('No encrypted backup found. Cannot recover keys.');
  }

  const publicKeyBase64 = userProfile?.publicKey;
  if (!publicKeyBase64) {
    throw new Error('Public key not found in user profile');
  }

  await restoreFromEncryptedBackup(userId, backup, password, publicKeyBase64);
  console.log('[E2EE] Keys recovered successfully.');
  return {
    status: 'SUCCESS',
    message: 'Encryption keys recovered. Chat history is now accessible.',
  };
}

/**
 * Last resort: new keys for this browser. Only call when user explicitly confirms.
 * Overwrites server public key — old encrypted messages become unreadable.
 */
export async function generateFreshKeysAfterSkip(userId, password = null) {
  const existing = await getPrivateKey(userId);
  if (existing) {
    return { status: 'SUCCESS', action: 'KEYS_ALREADY_PRESENT' };
  }

  const { publicKey, privateKey: newPrivate, privateKeyPkcs8 } = await generateKeyPair();
  const publicKeyBase64 = await exportPublicKey(publicKey);

  await persistKeyPair(userId, newPrivate, publicKeyBase64, privateKeyPkcs8);
  await uploadPublicKey(publicKeyBase64);
  if (password) {
    await storePasswordBackups(userId, privateKeyPkcs8, password, publicKeyBase64);
  }

  return {
    status: 'SUCCESS',
    action: 'NEW_KEYS_AFTER_SKIP',
    message: 'New encryption keys created for this browser.',
  };
}
