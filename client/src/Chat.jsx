import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from './socket';
import * as api from './api';
import { useE2EE } from './hooks/useE2EE';
import Avatar from './Avatar';
import GroupAvatar from './GroupAvatar';
import { useVoiceCall } from './useVoiceCall';
import VoiceCallOverlay from './VoiceCallOverlay';
import StatusBar from './StatusBar';
import StatusPage from './StatusPage';

function convTitle(conv) {
  if (!conv) return '';
  if (conv.isGroup) return conv.name || 'Group';
  const u = conv.otherUser;
  return u?.display_name || u?.username || '';
}

export default function Chat({ user, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [currentConv, setCurrentConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatMode, setNewChatMode] = useState('direct');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [listError, setListError] = useState('');
  const [startingChat, setStartingChat] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [groupActionError, setGroupActionError] = useState('');
  const [groupActionLoading, setGroupActionLoading] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [chatActionError, setChatActionError] = useState('');
const [statuses, setStatuses] = useState([]);
const [selectedStatuses, setSelectedStatuses] = useState(null);
  const [peerPublicKey, setPeerPublicKey] = useState(null);
  const [peerKeyError, setPeerKeyError] = useState('');
  const [sendError, setSendError] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const chatMenuRef = useRef(null);

  const isUserOnline = useCallback((userId) => {
    if (userId == null || userId === '') return false;
    return onlineIds.has(String(Number(userId)));
  }, [onlineIds]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!showChatMenu) return;
    const onClickOutside = (e) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target)) {
        setShowChatMenu(false);
      }
    };
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, [showChatMenu]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const key = (id) => String(Number(id));

    const onSnapshot = (payload) => {
      const ids = payload?.onlineUserIds ?? [];
      setOnlineIds(new Set(ids.map((x) => key(x))));
    };
    const onOnline = ({ userId }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        next.add(key(userId));
        return next;
      });
    };
    const onOffline = ({ userId }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        next.delete(key(userId));
        return next;
      });
    };

    socket.on('presence:snapshot', onSnapshot);
    socket.on('presence:online', onOnline);
    socket.on('presence:offline', onOffline);
    return () => {
      socket.off('presence:snapshot', onSnapshot);
      socket.off('presence:online', onOnline);
      socket.off('presence:offline', onOffline);
    };
  }, []);

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
    return api
      .getConversations()
      .then((data) => {
        setConversations(Array.isArray(data) ? data : []);
        setListError('');
      })
      .catch((err) => {
        console.error(err);
        setListError(err?.message || 'Failed to load conversations');
      });
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const loadStatuses = useCallback(() => {
  return api.getStatuses().then(setStatuses).catch((err) => console.error(err));
}, []);

useEffect(() => {
  loadStatuses();
}, [loadStatuses]);

  useEffect(() => {
    if (!selectedId) {
      setCurrentConv(null);
      setMessages([]);
      setInputValue('');
      setLoading(false);
      setShowGroupSettings(false);
      return;
    }
    setShowChatMenu(false);
    setChatActionError('');
    setLoading(true);
    setPeerPublicKey(null);
    setPeerKeyError('');
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
      if (msg.ciphertext || msg.encrypted) return;
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
    const applyGroupConversation = (conv) => {
      if (!conv?.id) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, ...conv } : c))
      );
      if (selectedId === conv.id) {
        setCurrentConv((prev) => ({ ...prev, ...conv }));
      }
    };
    const onGroupUpdated = ({ conversationId, conversation }) => {
      if (conversation) applyGroupConversation(conversation);
      else loadConversations();
    };
    const onGroupRemoved = ({ conversationId }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (selectedId === conversationId) {
        setSelectedId(null);
        setCurrentConv(null);
        setMessages([]);
        setShowGroupSettings(false);
        if (isMobile) setMobileChatOpen(false);
      }
    };
    const onGroupDeleted = ({ conversationId }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (selectedId === conversationId) {
        setSelectedId(null);
        setCurrentConv(null);
        setMessages([]);
        setShowGroupSettings(false);
        if (isMobile) setMobileChatOpen(false);
      }
    };
    const onConversationDeleted = ({ conversationId }) => {
      onGroupRemoved({ conversationId });
    };
    socket.on('message:new', onNewMessage);
    socket.on('conversation:new', onNewConversation);
    socket.on('message:deleted', onDeletedMessage);
    socket.on('group:updated', onGroupUpdated);
    socket.on('group:removed', onGroupRemoved);
    socket.on('group:deleted', onGroupDeleted);
    socket.on('conversation:deleted', onConversationDeleted);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('conversation:new', onNewConversation);
      socket.off('message:deleted', onDeletedMessage);
      socket.off('group:updated', onGroupUpdated);
      socket.off('group:removed', onGroupRemoved);
      socket.off('group:deleted', onGroupDeleted);
      socket.off('conversation:deleted', onConversationDeleted);
    };
  }, [selectedId, loadConversations, isMobile]);

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

  const resetNewChatForm = () => {
    setSearchTerm('');
    setUsers([]);
    setGroupName('');
    setGroupMembers([]);
    setListError('');
  };

  const openNewChat = (mode) => {
    setNewChatMode(mode);
    setShowNewChat(true);
    resetNewChatForm();
  };

  const addGroupMember = (u) => {
    if (!u?.id || u.id === user.id) return;
    setGroupMembers((prev) => (prev.some((m) => m.id === u.id) ? prev : [...prev, u]));
    setSearchTerm('');
    setUsers([]);
  };

  const removeGroupMember = (userId) => {
    setGroupMembers((prev) => prev.filter((m) => m.id !== userId));
  };

  const createGroup = async (e) => {
    if (e) e.preventDefault();
    const name = groupName.trim();
    if (!name) {
      setListError('Enter a group name.');
      return;
    }
    if (groupMembers.length < 1) {
      setListError('Add at least one member.');
      return;
    }
    setListError('');
    setCreatingGroup(true);
    try {
      const conv = await api.createGroup(name, groupMembers.map((m) => m.id));
      setConversations((prev) => {
        if (prev.some((c) => c.id === conv.id)) {
          return prev.map((c) => (c.id === conv.id ? { ...c, ...conv } : c));
        }
        return [conv, ...prev];
      });
      setSelectedId(conv.id);
      setCurrentConv(conv);
      setMessages(conv.messages || []);
      setShowNewChat(false);
      resetNewChatForm();
      if (isMobile) setMobileChatOpen(true);
    } catch (err) {
      console.error(err);
      setListError(err?.message || 'Could not create group.');
    } finally {
      setCreatingGroup(false);
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
        if (isMobile) setMobileChatOpen(true);
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
    if (isMobile) setMobileChatOpen(true);
  };

  const isGroup = !!currentConv?.isGroup;
  const other = isGroup ? null : currentConv?.otherUser;

  const socket = getSocket();
  const {
    keysReady,
    isDirectE2EEReady,
    keyError: e2eeKeyError,
    sendEncryptedMessage,
    decryptChatMessage,
    decryptMessageList,
    loadKeys,
  } = useE2EE({
    userId: user.id,
    socket,
    peerId: other?.id,
    peerPublicKey,
  });

  useEffect(() => {
    if (!other?.id || isGroup) {
      setPeerPublicKey(null);
      setPeerKeyError('');
      return;
    }
    setPeerKeyError('');
    let cancelled = false;
    api.getUserPublicKey(other.id)
      .then((data) => {
        if (!cancelled) setPeerPublicKey(data.publicKey);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setPeerPublicKey(null);
          setPeerKeyError(err?.message || 'Could not load encryption key for this user');
        }
      });
    return () => { cancelled = true; };
  }, [other?.id, isGroup, selectedId]);

  useEffect(() => {
    if (!selectedId || isGroup || !peerPublicKey || !keysReady) return;
    let cancelled = false;
    (async () => {
      const needsDecrypt = messages.some(
        (m) => (m.ciphertext || m.encrypted) && m.content === '🔒 Encrypted message'
      );
      if (!needsDecrypt) return;
      try {
        const decrypted = await decryptMessageList(messages, peerPublicKey);
        if (!cancelled) {
          setMessages((prev) => {
            if (prev.length !== decrypted.length) return decrypted;
            const changed = decrypted.some((m, i) => m.content !== prev[i]?.content);
            return changed ? decrypted : prev;
          });
        }
      } catch (err) {
        console.error('[E2EE] Failed to decrypt history:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, isGroup, peerPublicKey, keysReady, messages, decryptMessageList]);

  useEffect(() => {
    const sock = getSocket();
    if (!sock || isGroup || !peerPublicKey || !other?.id) return;

    const onReceive = async (payload) => {
      if (Number(payload.senderId ?? payload.sender_id) === Number(user.id)) return;

      const convId = payload.conversationId ?? payload.conversation_id;
      if (convId != null && Number(convId) !== Number(selectedId)) return;

      const involved =
        Number(payload.senderId) === Number(user.id) ||
        Number(payload.receiverId) === Number(user.id);
      if (!involved) return;

      const peerId = Number(payload.senderId) === Number(user.id)
        ? payload.receiverId
        : payload.senderId;
      if (Number(peerId) !== Number(other.id)) return;

      try {
        const content = await decryptChatMessage(payload, peerPublicKey);
        const fixed = {
          id: payload.id ?? `${payload.senderId}-${payload.iv}`,
          sender_id: payload.senderId ?? payload.sender_id,
          receiver_id: payload.receiverId ?? payload.receiver_id,
          content,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          encrypted: true,
          created_at: payload.created_at ?? payload.createdAt ?? new Date().toISOString(),
        };
        setMessages((prev) => {
          const id = normalizeId(fixed.id);
          if (id != null && prev.some((m) => normalizeId(m.id ?? m.ID) === id)) return prev;
          return [...prev, fixed];
        });
        loadConversations();
      } catch (err) {
        console.error('[E2EE] receive_message failed:', err);
      }
    };

    sock.on('receive_message', onReceive);
    return () => sock.off('receive_message', onReceive);
  }, [selectedId, isGroup, peerPublicKey, other?.id, user.id, decryptChatMessage, loadConversations]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const content = inputValue.trim();
    if (!content || !selectedId) return;
    setInputValue('');
    setSendError('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const useE2EEPath = !isGroup && isDirectE2EEReady;

    try {
      if (useE2EEPath) {
        const sent = await sendEncryptedMessage(content, {
          conversationId: selectedId,
          receiverId: other.id,
          recipientPublicKey: peerPublicKey,
        });
        setMessages((prev) => {
          const id = normalizeId(sent?.id);
          if (id != null && prev.some((m) => normalizeId(m.id ?? m.ID) === id)) return prev;
          return [...prev, {
            id: sent.id,
            sender_id: user.id,
            receiver_id: other.id,
            content,
            ciphertext: sent.ciphertext,
            iv: sent.iv,
            encrypted: true,
            created_at: sent.created_at ?? sent.createdAt ?? new Date().toISOString(),
          }];
        });
        loadConversations();
      } else {
        if (!isGroup && !isDirectE2EEReady) {
          setSendError(
            peerKeyError || e2eeKeyError || 'End-to-end encryption is not ready for this chat'
          );
          setInputValue(content);
          return;
        }
        await api.sendMessage(selectedId, content);
      }
    } catch (err) {
      console.error(err);
      setSendError(err?.message || 'Failed to send message');
      setInputValue(content);
    }
  };

  const memberCount = isGroup ? (currentConv?.members?.length ?? 0) : 0;
  const isGroupAdmin = isGroup && currentConv?.myRole === 'admin';
  const hasOtherGroupAdmin = isGroup && (currentConv?.members || []).some(
    (m) => m.role === 'admin' && m.id !== user.id
  );
  const isOnlyGroupAdmin = isGroupAdmin && !hasOtherGroupAdmin;

  const handlePromoteMember = async (memberId) => {
    if (!selectedId || !isGroupAdmin) return;
    setGroupActionError('');
    setGroupActionLoading(true);
    try {
      const conv = await api.promoteGroupAdmin(selectedId, memberId);
      setCurrentConv((prev) => ({ ...prev, ...conv }));
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, ...conv } : c)));
    } catch (err) {
      setGroupActionError(err?.message || 'Failed to promote member');
    } finally {
      setGroupActionLoading(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!selectedId || !isGroupAdmin) return;
    if (!window.confirm('Remove this member from the group?')) return;
    setGroupActionError('');
    setGroupActionLoading(true);
    try {
      await api.removeGroupMemberFromChat(selectedId, memberId);
      loadConversations();
      if (selectedId) {
        const conv = await api.getConversation(selectedId);
        setCurrentConv(conv);
      }
    } catch (err) {
      setGroupActionError(err?.message || 'Failed to remove member');
    } finally {
      setGroupActionLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedId || !isGroupAdmin) return;
    if (!window.confirm('Delete this group permanently? This cannot be undone.')) return;
    setGroupActionError('');
    setGroupActionLoading(true);
    try {
      await api.deleteGroup(selectedId);
      setConversations((prev) => prev.filter((c) => c.id !== selectedId));
      setSelectedId(null);
      setCurrentConv(null);
      setMessages([]);
      setShowGroupSettings(false);
      if (isMobile) setMobileChatOpen(false);
    } catch (err) {
      setGroupActionError(err?.message || 'Failed to delete group');
    } finally {
      setGroupActionLoading(false);
    }
  };

  const clearActiveChat = (convId) => {
    const id = Number(convId);
    setConversations((prev) => prev.filter((c) => Number(c.id) !== id));
    setSelectedId(null);
    setCurrentConv(null);
    setMessages([]);
    setShowGroupSettings(false);
    setShowChatMenu(false);
    setChatActionError('');
    if (isMobile) setMobileChatOpen(false);
  };

  const handleDeleteChat = async () => {
    const convId = selectedId;
    if (convId == null || deletingChat) return;
    const deleteEntireGroup = isOnlyGroupAdmin;
    const confirmMessage = deleteEntireGroup
      ? 'Delete this group permanently for all members? This cannot be undone.'
      : isGroup
        ? 'Leave this group? You will no longer receive messages from it.'
        : 'Delete this chat from your account? The other person will still have the conversation.';
    if (!window.confirm(confirmMessage)) return;

    setListError('');
    setGroupActionError('');
    setChatActionError('');
    setDeletingChat(true);
    setShowChatMenu(false);
    try {
      if (deleteEntireGroup) {
        await api.deleteGroup(convId);
      } else {
        await api.deleteChat(convId);
      }
      clearActiveChat(convId);
      await loadConversations();
    } catch (err) {
      const message = err?.message || 'Failed to delete chat';
      setChatActionError(message);
      setListError(message);
      if (showGroupSettings) setGroupActionError(message);
    } finally {
      setDeletingChat(false);
    }
  };

  const switchToConversation = useCallback((convId) => {
    if (convId == null) return;
    setListError('');
    setShowNewChat(false);
    setSelectedId(convId);
    if (isMobile) setMobileChatOpen(true);
  }, [isMobile]);

  const voice = useVoiceCall({
    socket,
    userId: user.id,
    selectedConversationId: selectedId,
    otherUser: other,
    onSwitchConversation: switchToConversation,
  });

  const layoutClass =
    isMobile && mobileChatOpen && selectedId
      ? 'app-layout app-layout--mobile app-layout--mobile-chat'
      : isMobile
        ? 'app-layout app-layout--mobile'
        : 'app-layout';

  return (
    <div className={layoutClass}>
      <VoiceCallOverlay voice={voice} peerUser={other} />
      {selectedStatuses && (
  <StatusPage
    statuses={selectedStatuses}
    onClose={() => setSelectedStatuses(null)}
    currentUserId={user.id}
    setStatuses={setStatuses}
    setSelectedStatuses={setSelectedStatuses}
  />
)}
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand">
            <div className="brand-logo" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <div className="brand-text">
              <h1>TalkGrid</h1>
              <span className="brand-tagline">Messages</span>
            </div>
          </div>
          <div className="sidebar-header-actions">
            <div className="user-pill">
              <Avatar user={user} size={28} presence={!!socket?.connected} />
              <span className="user-pill-name">{user.display_name || user.username}</span>
            </div>
            <button className="btn-ghost btn-sm logout-btn" onClick={onLogout} type="button">Logout</button>
          </div>
        </header>
        {showNewChat ? (
          <>
            <div className="new-chat-header new-chat-header--tabs">
              <button
                type="button"
                className={`new-chat-tab ${newChatMode === 'direct' ? 'active' : ''}`}
                onClick={() => { setNewChatMode('direct'); resetNewChatForm(); }}
              >
                Direct
              </button>
              <button
                type="button"
                className={`new-chat-tab ${newChatMode === 'group' ? 'active' : ''}`}
                onClick={() => { setNewChatMode('group'); resetNewChatForm(); }}
              >
                Group
              </button>
            </div>
            {newChatMode === 'group' && (
              <form className="group-create-form" onSubmit={createGroup}>
                <input
                  type="text"
                  placeholder="Group name"
                  value={groupName}
                  onChange={(e) => { setGroupName(e.target.value); setListError(''); }}
                  maxLength={100}
                />
                {groupMembers.length > 0 && (
                  <div className="group-member-chips">
                    {groupMembers.map((m) => (
                      <span key={m.id} className="group-member-chip">
                        {m.display_name || m.username}
                        <button type="button" onClick={() => removeGroupMember(m.id)} aria-label="Remove">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="submit"
                  className="btn-primary btn-sm"
                  disabled={creatingGroup || !groupName.trim() || groupMembers.length < 1}
                >
                  {creatingGroup ? 'Creating…' : 'Create group'}
                </button>
              </form>
            )}
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
              <button type="submit" className="btn-primary btn-sm">
                Search
              </button>
            </form>
            {listError && <div key="list-error" className="sidebar-error">{listError}</div>}
            {(startingChat || creatingGroup) && (
              <div key="sidebar-loading" className="sidebar-loading">
                {creatingGroup ? 'Creating group…' : 'Opening chat…'}
              </div>
            )}
            <div className="conversation-list">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="user-list-item"
                  onClick={() => (newChatMode === 'group' ? addGroupMember(u) : startChat(u))}
                  disabled={startingChat || creatingGroup}
                >
                  <Avatar user={u} size={48} presence={isUserOnline(u.id)} />
                  <span className="name">{u.display_name || u.username}</span>
                  {newChatMode === 'group' && groupMembers.some((m) => m.id === u.id) && (
                    <span className="group-added-label">Added</span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="new-chat-back-btn"
              onClick={() => { setShowNewChat(false); resetNewChatForm(); }}
            >
              ← Back to chats
            </button>
          </>
        ) : (
          <>
            <div className="new-chat-header new-chat-header--actions">
              <span className="section-label">Conversations</span>
              <div className="new-chat-actions">
                <button type="button" className="btn-secondary btn-sm" onClick={() => openNewChat('direct')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Chat
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={() => openNewChat('group')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  Group
                </button>
              </div>
            </div>
            <StatusBar
  statuses={statuses}
  currentUser={user}
  onRefresh={loadStatuses}
  onOpen={(group) => setSelectedStatuses(group)}
/>
            {listError && <div key="list-error" className="sidebar-error">{listError}</div>}
            <div className="conversation-list">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`conversation-item ${c.id === selectedId ? 'active' : ''}`}
                  onClick={() => selectConversation(c.id)}
                >
                  {c.isGroup ? (
                    <GroupAvatar name={c.name} size={48} />
                  ) : (
                    <Avatar user={c.otherUser} size={48} presence={isUserOnline(c.otherUser?.id)} />
                  )}
                  <div className="meta">
                    <p className="name">{convTitle(c)}</p>
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
          <div className="empty-chat empty-chat--desktop-only">
            <div className="empty-chat-icon" aria-hidden>
              <svg viewBox="0 0 80 80" fill="none">
                <circle cx="40" cy="40" r="38" stroke="url(#emptyGrad)" strokeWidth="2" opacity="0.4" />
                <path d="M24 32c0-4.4 3.6-8 8-8h16c4.4 0 8 3.6 8 8v6c0 4.4-3.6 8-8 8H36l-8 6.5V46c-4.4 0-8-3.6-8-8v-6z" fill="url(#emptyGrad)" opacity="0.85" />
                <defs>
                  <linearGradient id="emptyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h2>Welcome to TalkGrid</h2>
            <p>Select a conversation or start a new chat to begin messaging</p>
            <div className="empty-chat-hints">
              <span className="hint-chip">Direct messages</span>
              <span className="hint-chip">Group chats</span>
              <span className="hint-chip">Voice calls</span>
            </div>
          </div>
        ) : (
          <>
            <header className="chat-header">
              {isMobile && (
                <button
                  type="button"
                  className="chat-back-btn"
                  onClick={() => setMobileChatOpen(false)}
                  aria-label="Back to chats"
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden>
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                  </svg>
                </button>
              )}
              {isGroup ? (
                <GroupAvatar name={currentConv?.name} size={42} />
              ) : (
                <Avatar user={other} size={42} presence={isUserOnline(other?.id)} />
              )}
              <div className="chat-header-main">
                <h2 className="name">{convTitle(currentConv)}</h2>
                <p className={`chat-header-presence ${!isGroup && isUserOnline(other?.id) ? 'chat-header-presence--online' : ''}`}>
                  {isGroup
                    ? `${memberCount} members`
                    : isDirectE2EEReady
                      ? (isUserOnline(other?.id) ? 'Online · End-to-end encrypted' : 'Offline · End-to-end encrypted')
                      : (isUserOnline(other?.id) ? 'Online' : 'Offline')}
                </p>
              </div>
              {!isGroup && (
                <button
                  type="button"
                  className="chat-call-btn"
                  onClick={() => voice.startCall()}
                  disabled={!other || voice.phase !== 'idle'}
                  title="Voice call"
                  aria-label="Start voice call"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden>
                    <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
                  </svg>
                </button>
              )}
              {isGroup && (
                <button
                  type="button"
                  className="chat-settings-btn"
                  onClick={() => { setShowGroupSettings(true); setGroupActionError(''); setShowChatMenu(false); }}
                  title="Group settings"
                  aria-label="Group settings"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              )}
              <div className="chat-menu-wrap" ref={chatMenuRef}>
                <button
                  type="button"
                  className="chat-menu-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowChatMenu((open) => !open);
                  }}
                  title="Chat options"
                  aria-label="Chat options"
                  aria-expanded={showChatMenu}
                  aria-haspopup="menu"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden>
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
                {showChatMenu && (
                  <div
                    className="chat-menu-dropdown"
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="chat-menu-item chat-menu-item--danger"
                      role="menuitem"
                      disabled={deletingChat}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChat();
                      }}
                    >
                      {isOnlyGroupAdmin
                        ? 'Delete group'
                        : isGroup
                          ? 'Leave group'
                          : 'Delete chat'}
                    </button>
                  </div>
                )}
              </div>
            </header>
            {chatActionError && (
              <div className="chat-action-error" role="alert">{chatActionError}</div>
            )}
            {sendError && (
              <div className="chat-action-error" role="alert">{sendError}</div>
            )}
            {!isGroup && peerKeyError && (
              <div className="chat-action-error" role="alert">{peerKeyError}</div>
            )}
            {showGroupSettings && isGroup && (
              <div className="group-settings-backdrop" onClick={() => setShowGroupSettings(false)}>
                <div className="group-settings-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Group settings">
                  <header className="group-settings-header">
                    <div>
                      <h3>{convTitle(currentConv)}</h3>
                      <p>{memberCount} members · {isGroupAdmin ? 'You are an admin' : 'Member'}</p>
                    </div>
                    <button type="button" className="group-settings-close" onClick={() => setShowGroupSettings(false)} aria-label="Close">×</button>
                  </header>
                  {groupActionError && <div className="group-settings-error">{groupActionError}</div>}
                  <div className="group-settings-members">
                    <p className="group-settings-label">Members</p>
                    {(currentConv?.members || []).map((m) => (
                      <div key={m.id} className="group-settings-member">
                        <Avatar user={m} size={40} presence={isUserOnline(m.id)} />
                        <div className="group-settings-member-info">
                          <span className="name">{m.display_name || m.username}</span>
                          {m.role === 'admin' && <span className="admin-badge">Admin</span>}
                        </div>
                        {isGroupAdmin && m.id !== user.id && m.role !== 'admin' && (
                          <div className="group-settings-member-actions">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={groupActionLoading}
                              onClick={() => handlePromoteMember(m.id)}
                            >
                              Make admin
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-sm group-remove-btn"
                              disabled={groupActionLoading}
                              onClick={() => handleRemoveMember(m.id)}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {isGroupAdmin && (
                    <div className="group-settings-danger">
                      <button
                        type="button"
                        className="group-delete-btn"
                        disabled={groupActionLoading}
                        onClick={handleDeleteGroup}
                      >
                        Delete group
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="chat-messages">
              {loading ? (
                <div key="loading" className="chat-loading">
                  <div className="loading-spinner" aria-hidden />
                  <p>Loading messages…</p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isMe = msg.sender_id === user.id;
                  const msgId = msg.id ?? msg.ID ?? `msg-${index}`;
                  const createdRaw = msg.created_at ?? msg.CREATED_AT ?? msg.createdAt;
                  const createdDate = parseCreatedAt(createdRaw);
                  const canDelete = isMe;
                  const sender = msg.sender;
                  const senderLabel = sender?.display_name || sender?.username;
                  return (
                    <div key={msgId} className={`message-row ${isMe ? 'me' : ''}`}>
                      <div className="message-bubble">
                        {isGroup && !isMe && senderLabel && (
                          <p className="message-sender-name">{senderLabel}</p>
                        )}
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
              placeholder={
                selectedId
                  ? (!isGroup && isDirectE2EEReady ? 'Type an encrypted message' : 'Type a message')
                  : 'Select a conversation to start messaging'
              }
              rows={1}
              disabled={!selectedId}
              onKeyDown={handleKeyDown}
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="on"
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
