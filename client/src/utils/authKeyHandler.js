/**
 * E2EE keys — stored locally (same browser) + encrypted backup on server (other devices).
 * Password is only used at login/register — never a separate encryption prompt.
 */

import { generateKeyPair, exportPublicKey } from './cryptoUtils';
import {
  getPrivateKey,
  savePrivateKey,
  getPublicKey,
  savePublicKey,
  getPkcs8Bytes,
} from './keyStorage';
import { fetchUserProfile, uploadPublicKey, uploadEncryptedKeyBackup } from '../api';

async function derivePBKDF2Key(password, salt) {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
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

async function encryptPkcs8WithPassword(pkcs8Bytes, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePBKDF2Key(password, salt);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    toPkcs8Buffer(pkcs8Bytes)
  );
  return {
    encryptedPrivateKey: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    salt: btoa(String.fromCharCode(...new Uint8Array(salt))),
  };
}

async function decryptPkcs8WithPassword(backup, password) {
  const encryptedData = Uint8Array.from(atob(backup.encryptedPrivateKey), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(backup.iv), (c) => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(backup.salt), (c) => c.charCodeAt(0));
  const key = await derivePBKDF2Key(password, salt);
  const pkcs8 = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedData);
  const privateKey = await window.crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
  return { privateKey, pkcs8 };
}

async function uploadBackupSilently(userId, pkcs8Bytes, password) {
  if (!password || !pkcs8Bytes) return;
  try {
    const backup = await encryptPkcs8WithPassword(pkcs8Bytes, password);
    await uploadEncryptedKeyBackup(backup);
  } catch (err) {
    console.warn('[E2EE] Could not sync key backup to server:', err);
  }
}

async function restoreFromServerBackup(userId, password, profile) {
  const backup = {
    encryptedPrivateKey: profile.encryptedPrivateKeyBackup,
    iv: profile.encryptedPrivateKeyIV,
    salt: profile.encryptedPrivateKeySalt,
  };
  if (!backup.encryptedPrivateKey || !backup.iv || !backup.salt) {
    return false;
  }

  const publicKeyBase64 = profile.publicKey;
  if (!publicKeyBase64) {
    return false;
  }

  const { privateKey, pkcs8 } = await decryptPkcs8WithPassword(backup, password);
  await savePrivateKey(userId, privateKey, pkcs8);
  await savePublicKey(userId, publicKeyBase64);
  return true;
}

/**
 * @param {number|string} userId
 * @param {{ password?: string }} [options] - password from login/register (not a separate prompt)
 */
export async function initializeUserKeys(userId, options = {}) {
  if (!userId) throw new Error('userId is required');

  const password = options.password || null;

  // ── Same browser: keys already here ──
  let privateKey = await getPrivateKey(userId);
  let publicKeyBase64 = await getPublicKey(userId);

  if (privateKey) {
    if (!publicKeyBase64) {
      try {
        const profile = await fetchUserProfile();
        if (profile?.publicKey) {
          publicKeyBase64 = profile.publicKey;
          await savePublicKey(userId, publicKeyBase64);
        }
      } catch {
        // non-fatal
      }
    }
    const pkcs8 = getPkcs8Bytes(userId);
    if (password && pkcs8) {
      uploadBackupSilently(userId, pkcs8, password);
    }
    console.log('[E2EE] Keys loaded from this browser');
    return { status: 'SUCCESS', action: 'KEYS_REUSED' };
  }

  // ── New browser/device: restore from server backup using login password ──
  if (password) {
    try {
      const profile = await fetchUserProfile();
      if (profile?.encryptedPrivateKeyBackup) {
        const restored = await restoreFromServerBackup(userId, password, profile);
        if (restored) {
          console.log('[E2EE] Keys restored from server backup (new device)');
          return { status: 'SUCCESS', action: 'KEYS_RESTORED' };
        }
      }
    } catch (err) {
      console.warn('[E2EE] Server backup restore failed:', err);
    }
  }

  // ── First time ever, or legacy account without backup ──
  console.log('[E2EE] Creating new encryption keys for this device...');
  const { publicKey, privateKey: newPrivate, privateKeyPkcs8 } = await generateKeyPair();
  publicKeyBase64 = await exportPublicKey(publicKey);

  await savePrivateKey(userId, newPrivate, privateKeyPkcs8);
  await savePublicKey(userId, publicKeyBase64);

  if (!(await getPrivateKey(userId))) {
    throw new Error('Could not save encryption keys');
  }

  try {
    const profile = await fetchUserProfile();
    if (!profile?.publicKey) {
      await uploadPublicKey(publicKeyBase64);
    }
  } catch {
    await uploadPublicKey(publicKeyBase64);
  }

  if (password) {
    await uploadBackupSilently(userId, privateKeyPkcs8, password);
  }

  console.log('[E2EE] New keys created');
  return { status: 'SUCCESS', action: 'KEYS_CREATED' };
}
