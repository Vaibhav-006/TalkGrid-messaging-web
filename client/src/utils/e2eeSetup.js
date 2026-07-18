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
} from './keyStorage';
import { uploadPublicKey } from '../api';

/** Run once after login — ensures local keys exist and public key is on the server. */
export async function ensureUserEncryptionKeys(userId) {
  let privateKey = await getPrivateKey(userId);
  let cachedPublic = await getPublicKey(userId);

  if (privateKey && !cachedPublic) {
    await deletePrivateKey(userId);
    privateKey = null;
  }

  if (privateKey && cachedPublic) {
    const valid = await verifyKeyPairMatches(privateKey, cachedPublic);
    if (!valid) {
      await deletePrivateKey(userId);
      privateKey = null;
      cachedPublic = null;
    }
  }

  if (!privateKey) {
    const { publicKey, privateKey: newPrivate } = await generateKeyPair();
    cachedPublic = await exportPublicKey(publicKey);
    await savePrivateKey(userId, newPrivate);
    await savePublicKey(userId, cachedPublic);
  }

  if (cachedPublic) {
    await uploadPublicKey(cachedPublic);
  }
}
