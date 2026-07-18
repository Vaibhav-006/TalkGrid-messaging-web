require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Must run before any Mongoose model is loaded — prevents 10s buffer timeouts without MONGODB_URI.
if (!process.env.MONGODB_URI) {
  require('mongoose').set('bufferCommands', false);
}

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const { connectMongo, saveMessageToMongo } = require('./mongo');
const { verifyToken } = require('./auth');
const registerVoiceHandlers = require('./voiceSignaling');
const { registerChatSocketHandlers } = require('./socket/chatSocket');
const { emitToConversationMembers } = require('./conversationUtils');

/** userId -> number of active socket connections (tabs / devices) */
const presenceCounts = new Map();

function getOnlineUserIds() {
  const ids = [];
  for (const [userId, count] of presenceCounts) {
    if (count > 0) ids.push(userId);
  }
  return ids;
}

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

app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html><head><title>TalkGrid API</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem">
  <h1>TalkGrid API is running</h1>
  <p>This port (<code>3001</code>) is the <strong>backend API only</strong> — not the chat UI.</p>
  <p>Open the app here: <a href="http://localhost:5173"><strong>http://localhost:5173</strong></a></p>
  <p><a href="/api/health">/api/health</a></p>
</body></html>`);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'TalkGrid API' });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/conversations', require('./routes/conversations')(io));
app.use('/api/messages', require('./routes/messages')(io));
app.use('/api/status', require('./routes/status'));
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
  const uid = Number(socket.userId);
  if (Number.isNaN(uid) || uid < 1) {
    socket.disconnect(true);
    return;
  }

  const prevCount = presenceCounts.get(uid) || 0;
  presenceCounts.set(uid, prevCount + 1);
  if (prevCount === 0) {
    socket.broadcast.emit('presence:online', { userId: uid });
  }
  socket.emit('presence:snapshot', { onlineUserIds: getOnlineUserIds() });

  socket.join('user:' + String(uid));
  registerVoiceHandlers(socket, io, db);
  registerChatSocketHandlers(io, socket);

  socket.on('message:send', async ({ conversationId, content }) => {
    if (!content?.trim()) return;
    const convId = parseInt(conversationId, 10);
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, socket.userId);
    if (!member) return;
    db.prepare('INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)').run(convId, socket.userId, content.trim());
    const row = db.prepare('SELECT id, conversation_id, sender_id, content, created_at FROM messages WHERE id = last_insert_rowid()').get();
    const senderRow = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(socket.userId);
    const sender = senderRow ? {
      id: senderRow.id ?? senderRow.ID,
      username: senderRow.username ?? senderRow.USERNAME,
      display_name: senderRow.display_name ?? senderRow.DISPLAY_NAME,
      avatar_color: senderRow.avatar_color ?? senderRow.AVATAR_COLOR,
    } : null;
    const payload = { ...row, sender };
    await saveMessageToMongo({
      conversationSqlId: convId,
      senderSqlId: socket.userId,
      content: payload.content,
    }).catch((err) => {
      console.error('MongoMessage create failed:', err.message);
    });
    emitToConversationMembers(io, convId, 'message:new', payload);
  });

  socket.on('disconnect', () => {
    const c = (presenceCounts.get(uid) || 1) - 1;
    if (c <= 0) {
      presenceCounts.delete(uid);
      io.emit('presence:offline', { userId: uid });
    } else {
      presenceCounts.set(uid, c);
    }
  });
});

const PORT = Number(process.env.PORT) || 3001;
(async () => {
  await db.init();
  await connectMongo().catch((err) => {
    console.error('MongoDB connection failed:', err.message);
  });
  server.listen(PORT, () => {
    console.log(`API server:  http://localhost:${PORT}`);
    console.log(`Chat app:    http://localhost:5173  ← open this in your browser`);
  });
})();
