require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const { connectMongo, Message, nextMessageId, findUserBySqlId, formatUser, ensureMongoConnected } = require('./mongo');
const { verifyToken } = require('./auth');
const registerVoiceHandlers = require('./voiceSignaling');
const { registerChatSocketHandlers } = require('./socket/chatSocket');
const { emitToConversationMembers, isConversationMember } = require('./conversationUtils');

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

app.use(cors({ origin: (origin, cb) => cb(null, true), credentials: true }));
app.use(express.json());

app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html><head><title>TalkGrid API</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem">
  <h1>TalkGrid API is running</h1>
  <p>MongoDB backend — set <code>MONGODB_URI</code> in <code>server/.env</code></p>
  <p>Chat UI: <a href="http://localhost:5173"><strong>http://localhost:5173</strong></a></p>
  <p><a href="/api/health">/api/health</a></p>
</body></html>`);
});

app.get('/api/health', async (req, res) => {
  try {
    await ensureMongoConnected();
    res.json({ ok: true, service: 'TalkGrid API', database: 'mongodb' });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/conversations', require('./routes/conversations')(io));
app.use('/api/messages', require('./routes/messages')(io));
app.use('/api/status', require('./routes/status'));

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
  registerVoiceHandlers(socket, io);
  registerChatSocketHandlers(io, socket);

  socket.on('message:send', async ({ conversationId, content }) => {
    try {
      if (!content?.trim()) return;
      await ensureMongoConnected();
      const convId = parseInt(conversationId, 10);
      if (!(await isConversationMember(convId, socket.userId))) return;

      const messageSqlId = await nextMessageId();
      const msg = await Message.create({
        sqlId: messageSqlId,
        conversationSqlId: convId,
        senderSqlId: uid,
        content: content.trim(),
      });

      const senderDoc = await findUserBySqlId(uid);
      const payload = {
        id: msg.sqlId,
        conversation_id: convId,
        sender_id: msg.senderSqlId,
        content: msg.content,
        created_at: msg.createdAt,
        sender: formatUser(senderDoc),
      };

      emitToConversationMembers(io, convId, 'message:new', payload);
    } catch (err) {
      console.error('socket message:send error:', err.message);
    }
  });

  socket.on('typing:start', async ({ conversationId }) => {
    try {
      const convId = parseInt(conversationId, 10);
      if (!(await isConversationMember(convId, socket.userId))) return;
      emitToConversationMembers(io, convId, 'typing:start', { conversationId: convId, userId: uid });
    } catch (err) {}
  });

  socket.on('typing:stop', async ({ conversationId }) => {
    try {
      const convId = parseInt(conversationId, 10);
      if (!(await isConversationMember(convId, socket.userId))) return;
      emitToConversationMembers(io, convId, 'typing:stop', { conversationId: convId, userId: uid });
    } catch (err) {}
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
  if (!process.env.MONGODB_URI) {
    console.error('FATAL: MONGODB_URI is required in server/.env');
    process.exit(1);
  }
  try {
    await connectMongo();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`API server:  http://localhost:${PORT}`);
    console.log(`Chat app:    http://localhost:5173`);
    console.log('Database:    MongoDB');
  });
})();
