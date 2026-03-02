import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  return socket;
}

export function connectSocket(token) {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();
  const isDev = import.meta.env.DEV;
  const url = isDev
    ? 'http://localhost:3001'
    : 'https://talkgrid-messaging-web.onrender.com';
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
