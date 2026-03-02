const mongoose = require('mongoose');

let connected = false;

const uri = process.env.MONGODB_URI;

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

const userSchema = new mongoose.Schema(
  {
    sqlId: { type: Number, index: true, unique: true },
    username: { type: String, required: true, lowercase: true, trim: true, index: true },
    displayName: { type: String },
    avatarColor: { type: String, default: '#25D366' },
  },
  { timestamps: true }
);

const conversationSchema = new mongoose.Schema(
  {
    sqlId: { type: Number, index: true, unique: true },
    participantsSqlIds: [{ type: Number, index: true }],
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    conversationSqlId: { type: Number, index: true },
    senderSqlId: { type: Number, index: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

const MongoUser = mongoose.model('MongoUser', userSchema);
const MongoConversation = mongoose.model('MongoConversation', conversationSchema);
const MongoMessage = mongoose.model('MongoMessage', messageSchema);

module.exports = {
  connectMongo,
  MongoUser,
  MongoConversation,
  MongoMessage,
};

