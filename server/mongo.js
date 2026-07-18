const mongoose = require('mongoose');

let connected = false;

const uri = process.env.MONGODB_URI;

/** Without a URI, fail Mongo ops immediately instead of buffering 10s per call. */
if (!uri) {
  mongoose.set('bufferCommands', false);
}

async function connectMongo() {
  if (connected || mongoose.connection.readyState === 1) {
    connected = true;
    return;
  }
  if (mongoose.connection.readyState === 2) {
    return;
  }
  if (!uri) {
    console.warn('MONGODB_URI not set; MongoDB Atlas will not be used.');
    return;
  }
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  });
  connected = true;
  console.log('Connected to MongoDB Atlas');
}

async function ensureMongoConnected() {
  try {
    await connectMongo();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
  }
  return isMongoConnected();
}

function isMongoConnected() {
  return Boolean(uri) && connected && mongoose.connection.readyState === 1;
}

const { User: MongoUser } = require('./models/User');
const { Message: MongoMessage } = require('./models/Message');

const conversationSchema = new mongoose.Schema(
  {
    sqlId: { type: Number, index: true, unique: true },
    participantsSqlIds: [{ type: Number, index: true }],
  },
  { timestamps: true }
);

const MongoConversation = mongoose.models.MongoConversation
  || mongoose.model('MongoConversation', conversationSchema);

async function saveMessageToMongo(payload) {
  if (!payload) return null;
  const connectedOk = await ensureMongoConnected();
  if (!connectedOk || !MongoMessage) return null;

  return MongoMessage.create({
    conversationSqlId: payload.conversationSqlId ?? payload.conversationId ?? null,
    senderSqlId: payload.senderSqlId ?? payload.senderId ?? null,
    receiverSqlId: payload.receiverSqlId ?? payload.receiverId ?? null,
    content: payload.content ?? null,
    ciphertext: payload.ciphertext ?? null,
    iv: payload.iv ?? null,
  });
}

module.exports = {
  connectMongo,
  ensureMongoConnected,
  isMongoConnected,
  saveMessageToMongo,
  MongoUser,
  MongoConversation,
  MongoMessage,
};

