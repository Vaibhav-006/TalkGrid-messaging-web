import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from './socket';
import * as api from './api';
import Avatar from './Avatar';

export default function Chat({ user, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [currentConv, setCurrentConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [listError, setListError] = useState('');
  const [startingChat, setStartingChat] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const normalizeId = (value) => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isNaN(n)) return String(n);
    return String(value);
  };

  const parseCreatedAt = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    const str = String(value);
    if (!str) return null;
    // SQLite CURRENT_TIMESTAMP is UTC like "YYYY-MM-DD HH:MM:SS"
    let normalized = str.includes('T') ? str : str.replace(' ', 'T');
    const hasZone = normalized.endsWith('Z') || /[+\-]\d{2}:\d{2}$/.test(normalized);
    if (!hasZone) normalized += 'Z';
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  };

  const loadConversations = useCallback(() => {
    api.getConversations().then(setConversations).catch(console.error);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      setCurrentConv(null);
      setMessages([]);
      setInputValue('');
      setLoading(false);
      return;
    }
    setLoading(true);
    api.getConversation(selectedId).then((data) => {
      setCurrentConv(data);
      setMessages(data.messages || []);
    }).catch((err) => {
      console.error(err);
      setListError(err?.message || 'Could not load chat.');
    }).finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNewMessage = (msg) => {
      const cid = msg.conversation_id ?? msg.conversation_ID;
      if (cid === selectedId || cid == null) {
        const fixed = {
          ...msg,
          created_at: msg.created_at ?? msg.CREATED_AT ?? msg.createdAt ?? new Date().toISOString(),
        };
        setMessages((prev) => {
          const id = normalizeId(fixed.id ?? fixed.ID);
          if (id != null && prev.some((m) => normalizeId(m.id ?? m.ID) === id)) return prev;
          return [...prev, fixed];
        });
      }
      loadConversations();
    };
    const onNewConversation = (conv) => {
      if (!conv?.id) return;
      setShowNewChat(false);
      setConversations((prev) => {
        if (prev.some((c) => c.id === conv.id)) return prev;
        return [conv, ...prev];
      });
    };
    const onDeletedMessage = ({ id }) => {
      const targetId = normalizeId(id);
      if (!targetId) return;
      setMessages((prev) => prev.filter((m) => normalizeId(m.id ?? m.ID) !== targetId));
      loadConversations();
    };
    socket.on('message:new', onNewMessage);
    socket.on('conversation:new', onNewConversation);
    socket.on('message:deleted', onDeletedMessage);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('conversation:new', onNewConversation);
      socket.off('message:deleted', onDeletedMessage);
    };
  }, [selectedId, loadConversations]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const content = inputValue.trim();
    if (!content || !selectedId) return;
    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      // Let the server broadcast the message over socket; we don't push it manually here
      await api.sendMessage(selectedId, content);
    } catch (err) {
      console.error(err);
      setInputValue(content);
    }
  };

  const handleDeleteMessage = async (rawId) => {
    const id = normalizeId(rawId);
    if (!id) return;
    try {
      await api.deleteMessage(id);
      setMessages((prev) => prev.filter((m) => normalizeId(m.id ?? m.ID) !== id));
      loadConversations();
    } catch (err) {
      console.error(err);
      setListError(err?.message || 'Failed to delete message');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const startChat = (otherUser) => {
    setListError('');
    setStartingChat(true);
    api.getOrCreateDirect(otherUser.id)
      .then((conv) => {
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === conv.id);
          if (exists) return prev.map((c) => (c.id === conv.id ? { ...c, ...conv } : c));
          return [conv, ...prev];
        });
        setSelectedId(conv.id);
        setCurrentConv(conv);
        setMessages(conv.messages || []);
        setShowNewChat(false);
      })
      .catch((err) => {
        console.error(err);
        setListError(err?.message || 'Could not start chat. Is the server running?');
      })
      .finally(() => setStartingChat(false));
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    const term = searchTerm.trim();
    setUsers([]);
    setListError('');
    if (!term) return;
    try {
      const result = await api.searchUser(term);
      setUsers(result);
      if (result.length === 0) {
        setListError('No user found with that username.');
      }
    } catch (err) {
      console.error(err);
      setListError(err.message || 'Search failed');
    }
  };

  const selectConversation = (convId) => {
    if (convId == null) return;
    setListError('');
    setSelectedId(convId);
  };

  const other = currentConv?.otherUser;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Chat</h1>
          <div className="user-pill">
            <Avatar user={user} size={28} />
            <span>{user.display_name || user.username}</span>
          </div>
          <button className="logout-btn" onClick={onLogout} type="button">Logout</button>
        </header>
        {showNewChat ? (
          <>
            <div className="new-chat-header">New chat</div>
            <form className="new-chat-search" onSubmit={handleSearch}>
              <input
                type="text"
                placeholder="Search username (exact match)"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setListError('');
                  setUsers([]);
                }}
              />
              <button type="submit" className="logout-btn" style={{ padding: '6px 12px' }}>
                Search
              </button>
            </form>
            {listError && <div key="list-error" className="sidebar-error">{listError}</div>}
            {startingChat && <div key="sidebar-loading" className="sidebar-loading">Opening chat…</div>}
            <div className="conversation-list">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="user-list-item"
                  onClick={() => startChat(u)}
                  disabled={startingChat}
                >
                  <Avatar user={u} size={48} />
                  <span className="name">{u.display_name || u.username}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="new-chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Conversations</span>
              <button type="button" className="logout-btn" onClick={() => { setShowNewChat(true); setListError(''); }} style={{ padding: '4px 10px' }}>+ New</button>
            </div>
            {listError && <div key="list-error" className="sidebar-error">{listError}</div>}
            <div className="conversation-list">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`conversation-item ${c.id === selectedId ? 'active' : ''}`}
                  onClick={() => selectConversation(c.id)}
                >
                  <Avatar user={c.otherUser} size={48} />
                  <div className="meta">
                    <p className="name">{c.otherUser?.display_name || c.otherUser?.username}</p>
                    <p className="preview">{c.lastMessage || 'No messages yet'}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
      <main className="chat-area">
        {!selectedId ? (
          <div className="empty-chat">
            <p>Select a conversation or start a new chat</p>
            <small>Click a name on the left, or &quot;+ New&quot; to message another user</small>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <Avatar user={other} size={42} />
              <div>
                <h2 className="name">{other?.display_name || other?.username}</h2>
              </div>
            </header>
            <div className="chat-messages">
              {loading ? (
                <div key="loading" className="empty-chat"><p>Loading…</p></div>
              ) : (
                messages.map((msg, index) => {
                  const isMe = msg.sender_id === user.id;
                  const msgId = msg.id ?? msg.ID ?? `msg-${index}`;
                  const createdRaw = msg.created_at ?? msg.CREATED_AT ?? msg.createdAt;
                  const createdDate = parseCreatedAt(createdRaw);
                  const canDelete = isMe; // always show delete icon for own messages; server enforces 5‑minute window
                  return (
                    <div key={msgId} className={`message-row ${isMe ? 'me' : ''}`}>
                      <div className="message-bubble">
                        {canDelete && (
                          <button
                            type="button"
                            className="message-delete-btn"
                            onClick={() => handleDeleteMessage(msg.id ?? msg.ID)}
                            title="Delete message (last 5 minutes only)"
                          >
                            ×
                          </button>
                        )}
                        {msg.content}
                        <div className="message-time">
                          {createdDate
                            ? createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div key="messages-end" ref={messagesEndRef} />
            </div>
          </>
        )}
        <form className="chat-input-wrap" onSubmit={handleSend}>
          <div className={`chat-input-inner ${!selectedId ? 'chat-input-disabled' : ''}`}>
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                const t = e.target;
                t.style.height = 'auto';
                t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
              }}
              placeholder={selectedId ? 'Type a message' : 'Select a conversation to start messaging'}
              rows={1}
              disabled={!selectedId}
              onKeyDown={handleKeyDown}
            />
            <button type="submit" className="send-btn" aria-label="Send" disabled={!selectedId || !inputValue.trim()}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
