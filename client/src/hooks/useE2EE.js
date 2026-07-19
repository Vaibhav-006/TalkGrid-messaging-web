import { useState, useEffect, useCallback, useRef } from 'react';
import {
  importPublicKey,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
} from '../utils/cryptoUtils';
import { getPrivateKey } from '../utils/keyStorage';
import * as api from '../api';

/**
 * E2EE helpers for 1-on-1 direct chats (used by Chat.jsx).
 * Key generation happens once in authKeyHandler on login — this hook only loads existing keys.
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

  const loadKeys = useCallback(async () => {
    if (!userId) return;
    setKeyError('');
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const privateKey = await getPrivateKey(userId);
        if (privateKey) {
          privateKeyRef.current = privateKey;
          setKeysReady(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      privateKeyRef.current = null;
      setKeysReady(false);
      setKeyError('Encryption keys not ready. Log out and sign in with your password.');
    } catch (err) {
      console.error('[E2EE] Failed to load encryption keys:', err);
      setKeyError(err?.message || 'Failed to load encryption keys');
      setKeysReady(false);
    }
  }, [userId]);

  useEffect(() => {
    loadKeys();
    const onKeysRestored = () => loadKeys();
    window.addEventListener('e2ee-keys-ready', onKeysRestored);
    return () => window.removeEventListener('e2ee-keys-ready', onKeysRestored);
  }, [loadKeys]);

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
    loadKeys,
    sendEncryptedMessage,
    decryptChatMessage,
    decryptMessageList,
  };
}
