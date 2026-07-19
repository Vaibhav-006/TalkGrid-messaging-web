const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');
const { getNextSequence } = require('./models/Counter');
const { User, formatUser } = require('./models/User');
const { Conversation } = require('./models/Conversation');
const { Message, formatMessage } = require('./models/Message');
const { Status } = require('./models/Status');

const uri = process.env.MONGODB_URI;
let connected = false;

async function repairLegacySequenceValues(Model, fieldName, sequenceName) {
  if (!mongoose.connection.db) return;
  const collection = mongoose.connection.db.collection(Model.collection.name);

  const missingDocs = await collection.find({
    $or: [{ [fieldName]: null }, { [fieldName]: { $exists: false } }],
  }).toArray();

  for (const doc of missingDocs) {
    const nextId = await getNextSequence(sequenceName);
    await collection.updateOne({ _id: doc._id }, { $set: { [fieldName]: nextId } });
  }

  const duplicates = await collection.aggregate([
    { $group: { _id: `$${fieldName}`, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
  ]).toArray();

  for (const group of duplicates) {
    const [, ...rest] = group.ids;
    for (const id of rest) {
      const nextId = await getNextSequence(sequenceName);
      await collection.updateOne({ _id: id }, { $set: { [fieldName]: nextId } });
    }
  }
}

async function migrateLegacyIndexes() {
  if (!mongoose.connection.db) return;

  try {
    const usersCollection = mongoose.connection.db.collection('users');
    const indexes = await usersCollection.listIndexes().toArray();
    const legacyEmailIndex = indexes.find((idx) => idx.name === 'email_1');
    if (legacyEmailIndex) {
      await usersCollection.dropIndex('email_1');
      console.log('Dropped legacy users.email_1 index');
    }
  } catch (err) {
    console.warn('Legacy index migration skipped:', err.message);
  }

  await repairLegacySequenceValues(User, 'sqlId', 'user');
  await repairLegacySequenceValues(Conversation, 'sqlId', 'conversation');
  await repairLegacySequenceValues(Message, 'sqlId', 'message');
  await repairLegacySequenceValues(Status, 'sqlId', 'status');

  await Promise.all([
    User.syncIndexes(),
    Conversation.syncIndexes(),
    Message.syncIndexes(),
    Status.syncIndexes(),
  ]);
}

async function connectMongo() {
  if (!uri) {
    throw new Error('MONGODB_URI is required — SQLite has been removed');
  }
  if (connected || mongoose.connection.readyState === 1) {
    connected = true;
    return;
  }
  mongoose.set('autoIndex', false);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  connected = true;
  await migrateLegacyIndexes();
  console.log('Connected to MongoDB');
}

async function ensureMongoConnected() {
  await connectMongo();
  return true;
}

function isMongoConnected() {
  return connected && mongoose.connection.readyState === 1;
}

async function nextUserId() {
  return getNextSequence('user');
}

async function nextConversationId() {
  return getNextSequence('conversation');
}

async function nextMessageId() {
  return getNextSequence('message');
}

async function nextStatusId() {
  return getNextSequence('status');
}

async function findUserBySqlId(sqlId) {
  return User.findOne({ sqlId: Number(sqlId) }).lean();
}

async function findUserByUsername(username) {
  return User.findOne({ username: username.trim().toLowerCase() }).lean();
}

module.exports = {
  connectMongo,
  ensureMongoConnected,
  isMongoConnected,
  User,
  Conversation,
  Message,
  Status,
  formatUser,
  formatMessage,
  nextUserId,
  nextConversationId,
  nextMessageId,
  nextStatusId,
  findUserBySqlId,
  findUserByUsername,
  // legacy alias
  MongoUser: User,
  MongoMessage: Message,
  MongoConversation: Conversation,
};
