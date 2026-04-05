require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const { connectMongo } = require('./mongo');
const { verifyToken } = require('./auth');
const registerVoiceHandlers = require('./voiceSignaling');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return cb(null, true);
        if (/\.(vercel\.app|onrender\.com)$/i.test(host)) return cb(null, true);
      } catch {
        return cb(null, false);
      }
      cb(null, false);
    },
    methods: ['GET', 'POST'],
  },
});

// Allow REST API from local dev and deployed frontend (e.g. Vercel).
// In a real app you might tighten this to a specific Vercel URL via env.
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/conversations', require('./routes/conversations')(io));
app.use('/api/messages', require('./routes/messages')(io));

// Socket.io: authenticate by token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Auth required'));
  const user = verifyToken(token);
  if (!user) return next(new Error('Invalid token'));
  socket.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  socket.join('user:' + String(socket.userId));
  registerVoiceHandlers(socket, io, db);

  socket.on('message:send', ({ conversationId, content }) => {
    if (!content?.trim()) return;
    const convId = parseInt(conversationId, 10);
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, socket.userId);
    if (!member) return;
    db.prepare('INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)').run(convId, socket.userId, content.trim());
    const row = db.prepare('SELECT id, conversation_id, sender_id, content, created_at FROM messages WHERE id = last_insert_rowid()').get();
    const sender = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(socket.userId);
    const other = db.prepare(`
      SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?
    `).get(convId, socket.userId);
    const payload = { ...row, sender };
    socket.emit('message:new', payload);
    const otherId = other && (other.user_id ?? other.USER_ID);
    if (otherId) io.to(`user:${otherId}`).emit('message:new', payload);
  });

  socket.on('disconnect', () => {});
});

const PORT = Number(process.env.PORT) || 3001;
(async () => {
  await db.init();
  await connectMongo().catch((err) => {
    console.error('MongoDB connection failed:', err.message);
  });
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
})();
