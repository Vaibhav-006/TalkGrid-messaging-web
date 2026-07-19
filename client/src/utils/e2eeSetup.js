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

/** @deprecated Use authKeyHandler.initializeUserKeys — kept for backwards compatibility. */
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
    if (cachedPublic) {
      try {
        const profile = await fetchUserProfile();
        if (!profile?.publicKey) {
          await uploadPublicKey(cachedPublic);
        }
      } catch {
        // ignore
      }
    }
    return;
  }

  const { publicKey, privateKey: newPrivate } = await generateKeyPair();
  const cachedPublic = await exportPublicKey(publicKey);
  await savePrivateKey(userId, newPrivate);
  await savePublicKey(userId, cachedPublic);
  await uploadPublicKey(cachedPublic);
}
