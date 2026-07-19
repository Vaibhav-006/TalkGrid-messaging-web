/**
 * IndexedDB storage for E2EE keys.
 * Stores PKCS8 bytes (reliable across browser restarts) plus optional CryptoKey cache.
 */

const DB_NAME = 'talkgrid_e2ee_keys';
const DB_VERSION = 2;
const STORE_NAME = 'privateKeys';
const KEY_FLAG_PREFIX = 'talkgrid_e2ee_v1_';
const LOCAL_BACKUP_PREFIX = 'talkgrid_e2ee_backup_';

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };

function normalizeUserId(userId) {
  const n = Number(userId);
  return Number.isFinite(n) ? String(n) : String(userId);
}

function keyFlagName(userId) {
  return `${KEY_FLAG_PREFIX}${normalizeUserId(userId)}`;
}

function localBackupName(userId) {
  return `${LOCAL_BACKUP_PREFIX}${normalizeUserId(userId)}`;
}

export function markKeyStored(userId) {
  try {
    localStorage.setItem(keyFlagName(userId), '1');
  } catch {
    // ignore
  }
}

export function hasKeyStoredFlag(userId) {
  try {
    return localStorage.getItem(keyFlagName(userId)) === '1';
  } catch {
    return false;
  }
}

/** Password-encrypted PKCS8 backup in localStorage (survives IndexedDB CryptoKey issues). */
export function saveLocalEncryptedBackup(userId, backup) {
  try {
    localStorage.setItem(localBackupName(userId), JSON.stringify(backup));
    markKeyStored(userId);
  } catch (err) {
    console.warn('[E2EE] Could not save local encrypted backup:', err);
  }
}

export function getLocalEncryptedBackup(userId) {
  try {
    const raw = localStorage.getItem(localBackupName(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
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

async function importPrivateKeyFromPkcs8(pkcs8Bytes) {
  return window.crypto.subtle.importKey(
    'pkcs8',
    toPkcs8Buffer(pkcs8Bytes),
    ECDH_PARAMS,
    false,
    ['deriveKey']
  );
}

/**
 * Persist private key. Prefer PKCS8 bytes — they survive browser restarts reliably.
 * @param {string|number} userId
 * @param {CryptoKey} privateKey
 * @param {ArrayBuffer|Uint8Array} [pkcs8Bytes]
 */
export async function savePrivateKey(userId, privateKey, pkcs8Bytes = null) {
  if (!userId || !privateKey) {
    throw new Error('savePrivateKey requires userId and privateKey');
  }

  const payload = pkcs8Bytes
    ? { v: 2, pkcs8: toPkcs8Buffer(pkcs8Bytes) }
    : { v: 1, cryptoKey: privateKey };

  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      markKeyStored(userId);
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB write failed'));
    };
    tx.objectStore(STORE_NAME).put(payload, storageKey(userId));
  });
}

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

export async function getPrivateKey(userId) {
  if (!userId) return null;
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
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

  if (!record) return null;

  try {
    if (record instanceof CryptoKey) {
      return record;
    }
    if (record?.v === 2 && record?.pkcs8) {
      return await importPrivateKeyFromPkcs8(record.pkcs8);
    }
    if (record?.v === 1 && record?.cryptoKey instanceof CryptoKey) {
      return record.cryptoKey;
    }
  } catch (err) {
    console.error('[E2EE] Failed to load private key from storage:', err);
  }

  return null;
}

export async function deletePrivateKey(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFlagName(userId));
    localStorage.removeItem(localBackupName(userId));
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
    tx.objectStore(STORE_NAME).delete(`backup_${normalizeUserId(userId)}`);
  });
}

function encryptedBackupKey(userId) {
  return `backup_${normalizeUserId(userId)}`;
}

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
