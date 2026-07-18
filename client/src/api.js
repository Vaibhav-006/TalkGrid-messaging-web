const DEFAULT_PROD_API = 'https://talkgrid-messaging-web.onrender.com/api';

function resolveApiBase() {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (import.meta.env.DEV) return '/api';
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      return 'http://localhost:3001/api';
    }
  }
  return DEFAULT_PROD_API;
}

const API = resolveApiBase();
const DEFAULT_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Server not responding — run npm run dev and ensure port 3001 is up');
    }
    throw new Error('Cannot reach server — run npm run dev in the project folder');
  } finally {
    clearTimeout(timer);
  }
}

function getToken() {
  return localStorage.getItem('chat_token');
}

function headers() {
  const t = getToken();
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

export async function register(username, password, displayName) {
  const res = await fetchWithTimeout(`${API}/auth/register`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ username, password, displayName: displayName || username }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  return data;
}

export async function login(username, password) {
  const res = await fetchWithTimeout(`${API}/auth/login`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function getMe() {
  const res = await fetchWithTimeout(`${API}/auth/me`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Not authenticated');
  return data;
}

export async function searchUser(username) {
  const q = username?.trim().toLowerCase();
  if (!q) return [];
  const res = await fetch(`${API}/users?q=${encodeURIComponent(q)}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to search user');
  return data;
}

export async function getConversations() {
  const res = await fetch(`${API}/conversations`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load conversations');
  return data;
}

export async function getOrCreateDirect(userId) {
  const res = await fetch(`${API}/conversations/direct/${userId}`, {
    method: 'POST',
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create conversation');
  return data;
}

export async function createGroup(name, memberIds) {
  const res = await fetch(`${API}/conversations/group`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name, memberIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create group');
  return data;
}

export async function getConversation(id) {
  const res = await fetch(`${API}/conversations/${id}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load conversation');
  return data;
}

export async function sendMessage(conversationId, content) {
  const res = await fetch(`${API}/messages/send`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ conversationId, content }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to send message');
  return data;
}

/** Send an encrypted direct message (ciphertext + IV already computed client-side). */
export async function sendEncryptedMessage(conversationId, receiverId, ciphertext, iv) {
  const res = await fetch(`${API}/messages/send-encrypted`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ conversationId, receiverId, ciphertext, iv }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to send encrypted message');
  return data;
}

export async function deleteMessage(id) {
  const res = await fetch(`${API}/messages/${id}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete message');
  }
}

export async function promoteGroupAdmin(conversationId, userId) {
  const res = await fetch(`${API}/conversations/${conversationId}/members/${userId}/admin`, {
    method: 'PATCH',
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to promote member');
  return data;
}

export async function removeGroupMemberFromChat(conversationId, userId) {
  const res = await fetch(`${API}/conversations/${conversationId}/members/${userId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to remove member');
  return data;
}

export async function deleteGroup(conversationId) {
  const res = await fetch(`${API}/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to delete group');
  return data;
}

export async function deleteChat(conversationId) {
  const res = await fetch(`${API}/conversations/${conversationId}/me`, {
    method: 'DELETE',
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to delete chat');
  return data;
}

export async function getStatuses() {
  const res = await fetch(`${API}/status`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load statuses');
  return data;
}


export async function uploadStatus(file) {
  const t = getToken();
  const formData = new FormData();
  formData.append('media', file);
  const res = await fetch(`${API}/status`, {
    method: 'POST',
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to upload status');
  return data;
}

export async function deleteStatus(id) {
  const res = await fetch(`${API}/status/${id}`, {
    method: 'DELETE',
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to delete status');
  return data;
}

/** Upload ECDH public key (SPKI Base64) for the authenticated user. */
export async function uploadPublicKey(publicKey) {
  const res = await fetch(`${API}/users/me/public-key`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ publicKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to upload public key');
  return data;
}

/** Fetch a user's ECDH public key by SQLite user id. */
export async function getUserPublicKey(userId) {
  const res = await fetch(`${API}/users/${userId}/public-key`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load public key');
  return data;
}

/** Fetch full user profile including encrypted backup (used for multi-device recovery). */
export async function fetchUserProfile() {
  const res = await fetch(`${API}/users/me/profile`, {
    headers: headers(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load user profile');
  return data;
}

/** Upload encrypted private key backup for multi-device recovery. */
export async function uploadEncryptedKeyBackup(backup) {
  const res = await fetch(`${API}/users/me/encrypted-key-backup`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(backup),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to upload encrypted key backup');
  return data;
}


