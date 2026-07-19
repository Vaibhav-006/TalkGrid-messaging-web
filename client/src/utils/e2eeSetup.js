import {
  generateKeyPair,
  exportPublicKey,
} from './cryptoUtils';
import {
  getPrivateKey,
  savePrivateKey,
  getPublicKey,
  savePublicKey,
} from './keyStorage';
import { fetchUserProfile, uploadPublicKey } from '../api';

/** @deprecated Use authKeyHandler.initializeUserKeys */
export async function ensureUserEncryptionKeys(userId) {
  const privateKey = await getPrivateKey(userId);
  if (privateKey) {
    let cachedPublic = await getPublicKey(userId);
    if (!cachedPublic) {
      try {
        const profile = await fetchUserProfile();
        if (profile?.publicKey) {
          cachedPublic = profile.publicKey;
          await savePublicKey(userId, cachedPublic);
        }
      } catch {
        // ignore
      }
    }
    return;
  }

  const { publicKey, privateKey: newPrivate, privateKeyPkcs8 } = await generateKeyPair();
  const cachedPublic = await exportPublicKey(publicKey);
  await savePrivateKey(userId, newPrivate, privateKeyPkcs8);
  await savePublicKey(userId, cachedPublic);
  await uploadPublicKey(cachedPublic);
}
