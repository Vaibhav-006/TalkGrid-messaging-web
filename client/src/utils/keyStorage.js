/**
 * IndexedDB wrapper for non-exportable ECDH private keys.
 *
 * Why not localStorage?
 * - localStorage is synchronous and readable by any script on the page (XSS = full key theft).
 * - IndexedDB can persist CryptoKey objects (structured clone) so the private key never
 *   exists as extractable bytes in JS-accessible storage.
 *
 * Keys are stored under alias: priv_{userId}
 */

const DB_NAME = 'talkgrid_e2ee_keys';
const DB_VERSION = 1;
const STORE_NAME = 'privateKeys';
const KEY_FLAG_PREFIX = 'talkgrid_e2ee_v1_';

function normalizeUserId(userId) {
  const n = Number(userId);
  return Number.isFinite(n) ? String(n) : String(userId);
}

function keyFlagName(userId) {
  return `${KEY_FLAG_PREFIX}${normalizeUserId(userId)}`;
}

export function markKeyStored(userId) {
  try {
    localStorage.setItem(keyFlagName(userId), '1');
  } catch {
    // ignore quota / privacy mode
  }
}

export function hasKeyStoredFlag(userId) {
  try {
    return localStorage.getItem(keyFlagName(userId)) === '1';
  } catch {
    return false;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function storageKey(userId) {
  return `priv_${normalizeUserId(userId)}`;
}

function publicStorageKey(userId) {
  return `pub_${normalizeUserId(userId)}`;
}

/**
 * Persist the user's private CryptoKey under priv_{userId}.
 * @param {string|number} userId
 * @param {CryptoKey} privateKey
 */
export async function savePrivateKey(userId, privateKey) {
  if (!userId || !privateKey) {
    throw new Error('savePrivateKey requires userId and privateKey');
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB write failed'));
    };
    tx.objectStore(STORE_NAME).put(privateKey, storageKey(userId));
  });
  markKeyStored(userId);
}

/**
 * Persist the user's exported SPKI public key (Base64) for server re-sync.
 * @param {string|number} userId
 * @param {string} publicKeyBase64
 */
export async function savePublicKey(userId, publicKeyBase64) {
  if (!userId || !publicKeyBase64) {
    throw new Error('savePublicKey requires userId and publicKeyBase64');
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB write failed'));
    };
    tx.objectStore(STORE_NAME).put(publicKeyBase64, publicStorageKey(userId));
  });
}

/**
 * Load stored public key Base64 for userId, or null.
 * @param {string|number} userId
 * @returns {Promise<string|null>}
 */
export async function getPublicKey(userId) {
  if (!userId) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(publicStorageKey(userId));
    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('IndexedDB read failed'));
    };
  });
}

/**
 * Load the private CryptoKey for userId, or null if none exists.
 * @param {string|number} userId
 * @returns {Promise<CryptoKey|null>}
 */
export async function getPrivateKey(userId) {
  if (!userId) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(storageKey(userId));
    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('IndexedDB read failed'));
    };
  });
}

/**
 * Remove stored private key (e.g. on logout or key rotation).
 */
export async function deletePrivateKey(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFlagName(userId));
  } catch {
    // ignore
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB delete failed'));
    };
    tx.objectStore(STORE_NAME).delete(storageKey(userId));
    tx.objectStore(STORE_NAME).delete(publicStorageKey(userId));
    tx.objectStore(STORE_NAME).delete(`backup_${String(userId)}`);
  });
}

/**
 * ENHANCEMENT: Store encrypted private key backup locally for reference.
 * Format: { encryptedPrivateKey, iv, salt } all in Base64
 */
function encryptedBackupKey(userId) {
  return `backup_${String(userId)}`;
}

/**
 * Save encrypted private key backup to IndexedDB (for caching).
 * The actual encrypted backup also lives on the backend.
 * 
 * @param {string|number} userId
 * @param {Object} backup - { encryptedPrivateKey, iv, salt } in Base64
 */
export async function saveEncryptedPrivateKeyBackup(userId, backup) {
  if (!userId || !backup) {
    throw new Error('saveEncryptedPrivateKeyBackup requires userId and backup object');
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB write failed'));
    };
    tx.objectStore(STORE_NAME).put(backup, encryptedBackupKey(userId));
  });
}

/**
 * Retrieve encrypted private key backup from IndexedDB.
 * 
 * @param {string|number} userId
 * @returns {Promise<Object|null>} - { encryptedPrivateKey, iv, salt } or null
 */
export async function getEncryptedPrivateKeyBackup(userId) {
  if (!userId) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(encryptedBackupKey(userId));
    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('IndexedDB read failed'));
    };
  });
}
