const API = import.meta.env.DEV
  ? '/api'
  : 'https://talkgrid-messaging-web.onrender.com/api';

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
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ username, password, displayName: displayName || username }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  return data;
}

export async function login(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function getMe() {
  const res = await fetch(`${API}/auth/me`, { headers: headers() });
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
