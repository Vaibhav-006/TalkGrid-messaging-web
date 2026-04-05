import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  return socket;
}

const DEFAULT_PROD_SOCKET = 'https://talkgrid-messaging-web.onrender.com';

function resolveSocketUrl() {
  const fromEnv = import.meta.env.VITE_SOCKET_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (import.meta.env.DEV) return 'http://localhost:3001';
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      return 'http://localhost:3001';
    }
  }
  return DEFAULT_PROD_SOCKET;
}

export function connectSocket(token) {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();
  const url = resolveSocketUrl();
  socket = io(url, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
