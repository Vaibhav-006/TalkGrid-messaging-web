const mongoose = require('mongoose');

let connected = false;

const uri = process.env.MONGODB_URI;

/** Without a URI, fail Mongo ops immediately instead of buffering 10s per call. */
if (!uri) {
  mongoose.set('bufferCommands', false);
}

async function connectMongo() {
  if (connected) return;
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

module.exports = {
  connectMongo,
  isMongoConnected,
  MongoUser,
  MongoConversation,
  MongoMessage,
};

