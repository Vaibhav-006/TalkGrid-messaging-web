const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'chat.db');
let db = null;

function getDb() {
  if (db) return db;
  throw new Error('Database not initialized');
}

function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function prepare(sql) {
  const stmt = getDb().prepare(sql);
  return {
    run(...params) {
      if (params.length) stmt.bind(params);
      stmt.step();
      stmt.free();
      const idStmt = getDb().prepare('SELECT last_insert_rowid() as id');
      idStmt.step();
      const row = idStmt.getAsObject();
      idStmt.free();
      const raw = row && (typeof row.id !== 'undefined' ? row.id : row.ID);
      const lastInsertRowid = typeof raw === 'number' ? raw : (typeof raw === 'string' ? parseInt(raw, 10) : 0);
      save();
      return { lastInsertRowid };
    },
    get(...params) {
      if (params.length) stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    all(...params) {
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
  };
}

async function init() {
  let buffer = null;
  if (fs.existsSync(dbPath)) {
    buffer = fs.readFileSync(dbPath);
  }
  const SQL = await initSqlJs();
  db = new SQL.Database(buffer);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      avatar_color TEXT DEFAULT '#25D366',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );
  `);
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);');
  } catch (_) {}

  save();
  return db;
}

module.exports = {
  init,
  save,
  get prepare() {
    return prepare;
  },
};
