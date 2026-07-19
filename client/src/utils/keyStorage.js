/**
 * Local E2EE key storage — IndexedDB + localStorage dual write.
 * Keys persist across browser restarts without any password prompt.
 */

const DB_NAME = 'talkgrid_e2ee_keys';
const DB_VERSION = 2;
const STORE_NAME = 'privateKeys';

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };

function normalizeUserId(userId) {
  const n = Number(userId);
  return Number.isFinite(n) ? String(n) : String(userId);
}

function pkcs8LsKey(userId) {
  return `talkgrid_pkcs8_${normalizeUserId(userId)}`;
}

function pubLsKey(userId) {
  return `talkgrid_pub_${normalizeUserId(userId)}`;
}

function bufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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

function savePkcs8ToLocalStorage(userId, pkcs8Bytes) {
  try {
    localStorage.setItem(pkcs8LsKey(userId), bufferToBase64(toPkcs8Buffer(pkcs8Bytes)));
  } catch (err) {
    console.warn('[E2EE] localStorage PKCS8 save failed:', err);
  }
}

function loadPkcs8FromLocalStorage(userId) {
  try {
    const b64 = localStorage.getItem(pkcs8LsKey(userId));
    return b64 ? base64ToBuffer(b64) : null;
  } catch {
    return null;
  }
}

/** Read stored PKCS8 bytes (for server backup sync). */
export function getPkcs8Bytes(userId) {
  return loadPkcs8FromLocalStorage(userId);
}

function savePubToLocalStorage(userId, publicKeyBase64) {
  try {
    localStorage.setItem(pubLsKey(userId), publicKeyBase64);
  } catch (err) {
    console.warn('[E2EE] localStorage public key save failed:', err);
  }
}

function loadPubFromLocalStorage(userId) {
  try {
    return localStorage.getItem(pubLsKey(userId));
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

export async function savePrivateKey(userId, privateKey, pkcs8Bytes = null) {
  if (!userId || !privateKey) {
    throw new Error('savePrivateKey requires userId and privateKey');
  }

  if (pkcs8Bytes) {
    savePkcs8ToLocalStorage(userId, pkcs8Bytes);
  }

  const payload = pkcs8Bytes
    ? { v: 2, pkcs8: toPkcs8Buffer(pkcs8Bytes) }
    : { v: 1, cryptoKey: privateKey };

  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
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

  savePubToLocalStorage(userId, publicKeyBase64);

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

  let fromIdb = null;
  try {
    const db = await openDb();
    fromIdb = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(publicStorageKey(userId));
      request.onsuccess = () => {
        db.close();
        resolve(request.result ?? null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    // fall through to localStorage
  }

  return fromIdb || loadPubFromLocalStorage(userId);
}

export async function getPrivateKey(userId) {
  if (!userId) return null;

  let record = null;
  try {
    const db = await openDb();
    record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(storageKey(userId));
      request.onsuccess = () => {
        db.close();
        resolve(request.result ?? null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('[E2EE] IndexedDB read failed, trying localStorage:', err);
  }

  try {
    if (record instanceof CryptoKey) return record;
    if (record?.v === 2 && record?.pkcs8) {
      return await importPrivateKeyFromPkcs8(record.pkcs8);
    }
    if (record?.v === 1 && record?.cryptoKey instanceof CryptoKey) {
      return record.cryptoKey;
    }
  } catch (err) {
    console.warn('[E2EE] IndexedDB key import failed, trying localStorage:', err);
  }

  const lsPkcs8 = loadPkcs8FromLocalStorage(userId);
  if (lsPkcs8) {
    try {
      const key = await importPrivateKeyFromPkcs8(lsPkcs8);
      await savePrivateKey(userId, key, lsPkcs8);
      return key;
    } catch (err) {
      console.error('[E2EE] localStorage key import failed:', err);
    }
  }

  return null;
}

export async function deletePrivateKey(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(pkcs8LsKey(userId));
    localStorage.removeItem(pubLsKey(userId));
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
  });
}
