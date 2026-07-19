import { generateKeyPair, exportPublicKey } from './cryptoUtils';
import { getPrivateKey, savePrivateKey, getPublicKey, savePublicKey } from './keyStorage';
import { uploadPublicKey } from '../api';

/** @deprecated Use authKeyHandler.initializeUserKeys */
export async function ensureUserEncryptionKeys(userId) {
  const existing = await getPrivateKey(userId);
  if (existing) return;

  const { publicKey, privateKey, privateKeyPkcs8 } = await generateKeyPair();
  const publicKeyBase64 = await exportPublicKey(publicKey);
  await savePrivateKey(userId, privateKey, privateKeyPkcs8);
  await savePublicKey(userId, publicKeyBase64);
  await uploadPublicKey(publicKeyBase64);
}
