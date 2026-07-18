import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  verifyKeyPairMatches,
} from '../utils/cryptoUtils';
import { getPrivateKey, savePrivateKey, getPublicKey, savePublicKey, deletePrivateKey } from '../utils/keyStorage';
import * as api from '../api';

/**
 * E2EE helpers for 1-on-1 direct chats (used by Chat.jsx).
 */
export function useE2EE({ userId, peerId, peerPublicKey }) {
  const [keysReady, setKeysReady] = useState(false);
  const [keyError, setKeyError] = useState('');
  const privateKeyRef = useRef(null);
  const sharedKeyCacheRef = useRef(new Map());

  const cacheKey = useCallback((id) => `${userId}:${Number(id)}`, [userId]);

  const getSharedKeyForPeer = useCallback(async (targetPeerId, targetPeerPublicKey) => {
    if (!privateKeyRef.current) {
      throw new Error('Local private key not initialized');
    }
    if (!targetPeerPublicKey) {
      throw new Error('Peer public key unavailable');
    }
    const peerNum = Number(targetPeerId);
    const ck = cacheKey(peerNum);
    if (sharedKeyCacheRef.current.has(ck)) {
      return sharedKeyCacheRef.current.get(ck);
    }
    const theirPublicKey = await importPublicKey(targetPeerPublicKey);
    const sharedKey = await deriveSharedKey(privateKeyRef.current, theirPublicKey);
    sharedKeyCacheRef.current.set(ck, sharedKey);
    return sharedKey;
  }, [cacheKey]);

  const regenerateAndUploadKeys = useCallback(async () => {
    const { publicKey, privateKey: newPrivate } = await generateKeyPair();
    const publicKeyBase64 = await exportPublicKey(publicKey);
    await savePrivateKey(userId, newPrivate);
    await savePublicKey(userId, publicKeyBase64);
    privateKeyRef.current = newPrivate;
    await api.uploadPublicKey(publicKeyBase64);
    return publicKeyBase64;
  }, [userId]);

  const initializeKeys = useCallback(async () => {
    if (!userId) return;
    setKeyError('');
    try {
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
        cachedPublic = await regenerateAndUploadKeys();
        privateKey = privateKeyRef.current;
      } else {
        privateKeyRef.current = privateKey;
        await api.uploadPublicKey(cachedPublic);
      }

      setKeysReady(true);
    } catch (err) {
      console.error('[E2EE] Key initialization failed:', err);
      setKeyError(err?.message || 'Failed to initialize encryption keys');
      setKeysReady(false);
    }
  }, [userId, regenerateAndUploadKeys]);

  useEffect(() => {
    initializeKeys();
  }, [initializeKeys]);

  useEffect(() => {
    sharedKeyCacheRef.current.clear();
  }, [peerPublicKey, userId]);

  const decryptChatMessage = useCallback(async (msg, targetPeerPublicKey = peerPublicKey) => {
    if (!msg?.ciphertext || !msg?.iv) {
      return msg?.content ?? '';
    }
    const senderId = Number(msg.sender_id ?? msg.senderId);
    const receiverId = Number(msg.receiver_id ?? msg.receiverId);
    const peerForDerive = senderId === Number(userId) ? receiverId : senderId;

    const sharedKey = await getSharedKeyForPeer(peerForDerive, targetPeerPublicKey);
    return decryptMessage(sharedKey, msg.ciphertext, msg.iv, { quiet: true });
  }, [userId, peerPublicKey, getSharedKeyForPeer]);

  const decryptMessageList = useCallback(async (list, targetPeerPublicKey = peerPublicKey) => {
    if (!Array.isArray(list) || !targetPeerPublicKey) return list;
    return Promise.all(
      list.map(async (msg) => {
        if (!msg?.encrypted && !msg?.ciphertext) return msg;
        const content = await decryptChatMessage(msg, targetPeerPublicKey);
        return { ...msg, content };
      })
    );
  }, [peerPublicKey, decryptChatMessage]);

  const sendEncryptedMessage = useCallback(async (plaintext, options = {}) => {
    const receiverId = Number(options.receiverId ?? peerId);
    let recipientPublicKey = options.recipientPublicKey ?? peerPublicKey;
    const conversationId = options.conversationId ?? null;

    if (!keysReady || !privateKeyRef.current) {
      throw new Error('Encryption keys not ready');
    }
    if (!receiverId || Number.isNaN(receiverId)) {
      throw new Error('No recipient selected');
    }

    if (!recipientPublicKey) {
      const fresh = await api.getUserPublicKey(receiverId);
      recipientPublicKey = fresh.publicKey;
    }

    const trimmed = plaintext?.trim();
    if (!trimmed) return null;

    const sharedKey = await getSharedKeyForPeer(receiverId, recipientPublicKey);
    const { ciphertext, iv } = await encryptMessage(sharedKey, trimmed);

    return api.sendEncryptedMessage(
      conversationId != null ? Number(conversationId) : null,
      receiverId,
      ciphertext,
      iv
    );
  }, [keysReady, peerId, peerPublicKey, getSharedKeyForPeer]);

  const isDirectE2EEReady = keysReady && !!peerPublicKey && !!peerId;

  return {
    keysReady,
    keyError,
    isDirectE2EEReady,
    initializeKeys,
    sendEncryptedMessage,
    decryptChatMessage,
    decryptMessageList,
  };
}

/** Standalone key setup — see utils/e2eeSetup.js (used by App.jsx on login). */
