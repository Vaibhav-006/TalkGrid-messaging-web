import { useState, useEffect } from 'react';
import { useE2EE } from '../hooks/useE2EE';
import { getSocket } from '../socket';
import * as api from '../api';

/**
 * Minimal 1-on-1 E2EE chat example — shows how cryptoUtils, keyStorage, API, and Socket.io tie together.
 */
export default function E2EEChatExample({ currentUser, recipientUser }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [peerPublicKey, setPeerPublicKey] = useState(null);
  const [loadingPeer, setLoadingPeer] = useState(false);
  const [sendError, setSendError] = useState('');
  const socket = getSocket();

  useEffect(() => {
    if (!recipientUser?.id) return;
    setLoadingPeer(true);
    api.getUserPublicKey(recipientUser.id)
      .then((data) => setPeerPublicKey(data.publicKey))
      .catch((err) => {
        console.error(err);
        setSendError(err?.message || 'Could not load recipient public key');
      })
      .finally(() => setLoadingPeer(false));
  }, [recipientUser]);

  const {
    keysReady,
    keyError,
    isDirectE2EEReady,
    sendEncryptedMessage,
    decryptChatMessage,
  } = useE2EE({
    userId: currentUser.id,
    socket,
    peerId: recipientUser?.id,
    peerPublicKey,
  });

  useEffect(() => {
    if (!socket || !peerPublicKey || !recipientUser?.id) return;

    const onReceive = async (payload) => {
      const involved =
        Number(payload.senderId) === Number(currentUser.id) ||
        Number(payload.receiverId) === Number(currentUser.id);
      if (!involved) return;

      const peerId = Number(payload.senderId) === Number(currentUser.id)
        ? payload.receiverId
        : payload.senderId;
      if (Number(peerId) !== Number(recipientUser.id)) return;

      try {
        const plaintext = await decryptChatMessage(payload, peerPublicKey);
        setMessages((prev) => {
          const id = payload.id ?? `${payload.senderId}-${payload.createdAt}-${payload.iv}`;
          if (prev.some((m) => m.id === id)) return prev;
          return [
            ...prev,
            {
              id,
              senderId: payload.senderId,
              plaintext,
              createdAt: payload.createdAt ?? new Date().toISOString(),
            },
          ];
        });
      } catch (err) {
        console.error('[E2EE] Failed to handle incoming message:', err);
      }
    };

    socket.on('receive_message', onReceive);
    return () => socket.off('receive_message', onReceive);
  }, [socket, currentUser.id, recipientUser?.id, peerPublicKey, decryptChatMessage]);

  const handleSend = async (e) => {
    e.preventDefault();
    setSendError('');
    const text = input.trim();
    if (!text) return;
    setInput('');
    try {
      await sendEncryptedMessage(text);
    } catch (err) {
      console.error(err);
      setSendError(err?.message || 'Failed to send encrypted message');
      setInput(text);
    }
  };

  if (keyError) {
    return (
      <div className="e2ee-chat-example e2ee-chat-example--error">
        <p>Encryption setup failed: {keyError}</p>
      </div>
    );
  }

  if (!keysReady || loadingPeer) {
    return (
      <div className="e2ee-chat-example">
        <p>Setting up end-to-end encryption…</p>
      </div>
    );
  }

  if (!isDirectE2EEReady) {
    return (
      <div className="e2ee-chat-example e2ee-chat-example--error">
        <p>
          {recipientUser?.username ?? 'Recipient'} has not uploaded a public key yet.
        </p>
      </div>
    );
  }

  return (
    <div className="e2ee-chat-example">
      <header className="e2ee-chat-example__header">
        <h3>E2EE chat with {recipientUser.display_name || recipientUser.username}</h3>
        <span className="e2ee-chat-example__badge">🔒 Encrypted</span>
      </header>

      <div className="e2ee-chat-example__messages">
        {messages.length === 0 && (
          <p className="e2ee-chat-example__empty">No messages yet. Say hello!</p>
        )}
        {messages.map((msg) => {
          const isMe = Number(msg.senderId) === Number(currentUser.id);
          return (
            <div
              key={msg.id}
              className={`e2ee-chat-example__bubble ${isMe ? 'e2ee-chat-example__bubble--me' : ''}`}
            >
              {msg.plaintext}
            </div>
          );
        })}
      </div>

      {sendError && (
        <p className="e2ee-chat-example__error" role="alert">{sendError}</p>
      )}

      <form className="e2ee-chat-example__input" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type an encrypted message…"
          autoComplete="off"
        />
        <button type="submit" disabled={!input.trim()}>Send</button>
      </form>
    </div>
  );
}

export async function ensureUserEncryptionKeys(userId) {
  const { ensureUserEncryptionKeys: ensure } = await import('../utils/e2eeSetup');
  return ensure(userId);
}
