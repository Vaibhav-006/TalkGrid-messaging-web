/**
 * E2EE helpers using the browser Web Crypto API (window.crypto.subtle).
 *
 * Cryptographic handshake (1-on-1 chat):
 * 1. Each client generates an ECDH P-256 key pair locally.
 * 2. Public keys (SPKI, Base64) are uploaded to the server; private keys never leave the device.
 * 3. To send a message, Alice imports Bob's public key and runs ECDH with her private key.
 *    Bob does the same with Alice's public key. ECDH symmetry yields the same shared secret.
 * 4. That secret is derived into an AES-256-GCM key via HKDF-like deriveKey (built into Web Crypto).
 * 5. Plaintext is encrypted with AES-GCM; a fresh 12-byte IV is generated per message.
 * 6. The server stores/forwards only { ciphertext, iv } — it cannot decrypt.
 */

const subtle = window.crypto.subtle;

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const AES_GCM_PARAMS = { name: 'AES-GCM', length: 256 };
const IV_BYTE_LENGTH = 12;

/** ArrayBuffer | Uint8Array → Base64 (standard encoding for JSON transport). */
function bufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 → ArrayBuffer. */
function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate an ECDH P-256 key pair.
 * The returned private key is non-extractable (cannot be exported via exportKey).
 * The public key remains exportable so it can be encoded as SPKI for the backend.
 */
export async function generateKeyPair() {
  const tempPair = await subtle.generateKey(ECDH_PARAMS, /* extractable */ true, ['deriveKey']);

  const pkcs8 = await subtle.exportKey('pkcs8', tempPair.privateKey);

  const privateKey = await subtle.importKey(
    'pkcs8',
    pkcs8,
    ECDH_PARAMS,
    /* extractable */ false,
    ['deriveKey']
  );

  return {
    publicKey: tempPair.publicKey,
    privateKey,
    /** PKCS8 bytes — only available at generation time for password backup. */
    privateKeyPkcs8: pkcs8,
  };
}

/**
 * Export a public CryptoKey to a Base64 SPKI string for transmission to the backend.
 */
export async function exportPublicKey(publicKey) {
  const spki = await subtle.exportKey('spki', publicKey);
  return bufferToBase64(spki);
}

/**
 * Import a peer's Base64 SPKI string into a CryptoKey suitable for ECDH deriveKey.
 */
export async function importPublicKey(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') {
    throw new Error('Invalid public key: expected Base64 SPKI string');
  }
  const raw = base64ToBuffer(base64Str.trim());
  return subtle.importKey('spki', raw, ECDH_PARAMS, /* extractable */ true, []);
}

/**
 * Derive a symmetric AES-256-GCM key from ECDH(myPrivate, theirPublic).
 * Both participants derive identical key material (Diffie–Hellman symmetry).
 */
export async function deriveSharedKey(myPrivateKey, theirPublicKey) {
  return subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    AES_GCM_PARAMS,
    /* extractable */ false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext with AES-GCM.
 * Returns Base64-encoded ciphertext and IV (fresh random 12 bytes per call).
 */
export async function encryptMessage(sharedKey, plaintext) {
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );
  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
  };
}

/**
 * Decrypt AES-GCM ciphertext. On failure (wrong key, tampered data), returns a safe fallback string.
 */
export async function decryptMessage(sharedKey, ciphertextBase64, ivBase64, { quiet = false } = {}) {
  try {
    const ciphertext = base64ToBuffer(ciphertextBase64);
    const iv = new Uint8Array(base64ToBuffer(ivBase64));
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    if (!quiet) {
      console.warn('[E2EE] Decryption failed (wrong key or legacy message)');
    }
    return '[Unable to decrypt message]';
  }
}

/**
 * Verify that a cached SPKI public key belongs to the same pair as the private key.
 * Returns false if keys are mismatched (e.g. after partial IndexedDB reset).
 */
export async function verifyKeyPairMatches(privateKey, publicKeyBase64) {
  try {
    const importedPublic = await importPublicKey(publicKeyBase64);
    await deriveSharedKey(privateKey, importedPublic);
    return true;
  } catch {
    return false;
  }
}
