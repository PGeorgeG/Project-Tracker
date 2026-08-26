const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'tracker.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migration: older databases were created before sort_order existed.
// CREATE TABLE IF NOT EXISTS won't add columns to an existing table, so
// add it explicitly if missing, then backfill using existing creation order.
const projectCols = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!projectCols.includes('sort_order')) {
  db.exec('ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0');
  const rows = db.prepare('SELECT id FROM projects ORDER BY created_at ASC').all();
  const setOrder = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
  rows.forEach((row, i) => setOrder.run(i, row.id));
}

const todoCols = db.prepare("PRAGMA table_info(todos)").all().map(c => c.name);
if (!todoCols.includes('completed_at')) {
  db.exec('ALTER TABLE todos ADD COLUMN completed_at TEXT DEFAULT NULL');
  // Existing completed todos predate this column, so their completion date
  // is unknown; leave completed_at null for them rather than guessing.
}
if (!todoCols.includes('today_list_date')) {
  db.exec('ALTER TABLE todos ADD COLUMN today_list_date TEXT DEFAULT NULL');
}

const alertCols = db.prepare("PRAGMA table_info(alerts)").all().map(c => c.name);
if (!alertCols.includes('today_list_date')) {
  db.exec('ALTER TABLE alerts ADD COLUMN today_list_date TEXT DEFAULT NULL');
}

module.exports = db;
