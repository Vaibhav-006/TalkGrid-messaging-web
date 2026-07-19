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
  return {
    run(...params) {
      const stmt = getDb().prepare(sql);
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
      const stmt = getDb().prepare(sql);
      if (params.length) stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    all(...params) {
      const stmt = getDb().prepare(sql);
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
  db.run(`
  CREATE TABLE IF NOT EXISTS status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_url TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
try {
  db.run('CREATE INDEX IF NOT EXISTS idx_status_created ON status(created_at);');
} catch (_) {}
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);');
  } catch (_) {}
  try {
    db.run('ALTER TABLE conversations ADD COLUMN is_group INTEGER DEFAULT 0');
  } catch (_) {}
  try {
    db.run('ALTER TABLE conversations ADD COLUMN name TEXT');
  } catch (_) {}
  try {
    db.run("ALTER TABLE conversation_members ADD COLUMN role TEXT DEFAULT 'member'");
  } catch (_) {}
  try {
    db.run('ALTER TABLE users ADD COLUMN public_key TEXT');
  } catch (_) {}
  try {
    db.run('ALTER TABLE messages ADD COLUMN ciphertext TEXT');
  } catch (_) {}
  try {
    db.run('ALTER TABLE messages ADD COLUMN iv TEXT');
  } catch (_) {}
  try {
    db.run('ALTER TABLE messages ADD COLUMN receiver_id INTEGER');
  } catch (_) {}
  try {
    db.run('ALTER TABLE users ADD COLUMN encrypted_private_key_backup TEXT');
  } catch (_) {}
  try {
    db.run('ALTER TABLE users ADD COLUMN encrypted_private_key_iv TEXT');
  } catch (_) {}
  try {
    db.run('ALTER TABLE users ADD COLUMN encrypted_private_key_salt TEXT');
  } catch (_) {}

  // Ensure each existing group has at least one admin (earliest joined member)
  const groupRows = [];
  const groupStmt = db.prepare('SELECT id FROM conversations WHERE COALESCE(is_group, 0) = 1');
  while (groupStmt.step()) groupRows.push(groupStmt.getAsObject());
  groupStmt.free();
  for (const g of groupRows) {
    const gid = g.id ?? g.ID;
    if (!gid) continue;
    const adminCheck = db.prepare(
      "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND role = 'admin' LIMIT 1"
    );
    adminCheck.bind([gid]);
    const hasAdmin = adminCheck.step();
    adminCheck.free();
    if (hasAdmin) continue;
    const firstStmt = db.prepare(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at ASC LIMIT 1'
    );
    firstStmt.bind([gid]);
    const first = firstStmt.step() ? firstStmt.getAsObject() : null;
    firstStmt.free();
    const uid = first && (first.user_id ?? first.USER_ID);
    if (uid) {
      const upd = db.prepare(
        "UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?"
      );
      upd.bind([gid, uid]);
      upd.step();
      upd.free();
    }
  }

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
