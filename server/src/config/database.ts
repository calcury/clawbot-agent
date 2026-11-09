import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'clawbot.db');
export const db = new Database(DB_PATH);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      token_secret TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      llm_endpoint TEXT DEFAULT 'https://api.deepseek.com/v1',
      llm_api_key TEXT DEFAULT '',
      llm_model TEXT DEFAULT 'deepseek-chat',
      clawbot_webhook_token TEXT DEFAULT '',
      clawbot_outbound_url TEXT DEFAULT '',
      clawbot_outbound_key TEXT DEFAULT '',
      clawbot_to_wxid TEXT DEFAULT '',
      work_slots TEXT DEFAULT '[{"start":"09:00","end":"12:00"},{"start":"13:00","end":"18:00"},{"start":"19:00","end":"24:00"},{"start":"00:00","end":"02:00"}]',
      task_buffer_minutes INTEGER DEFAULT 10,
      reminder_before_start_minutes INTEGER DEFAULT 5,
      reminder_before_end_minutes INTEGER DEFAULT 5,
      calendar_sync_interval_minutes INTEGER DEFAULT 60,
      weixin_connected INTEGER DEFAULT 0,
      weixin_bot_token TEXT DEFAULT '',
      weixin_bot_id TEXT DEFAULT '',
      weixin_user_id TEXT DEFAULT '',
      weixin_base_url TEXT DEFAULT 'https://ilinkai.weixin.qq.com',
      weixin_sync_buf TEXT DEFAULT '',
      weixin_nickname TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS calendar_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      last_sync_at DATETIME,
      sync_status TEXT DEFAULT 'ok',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS external_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER REFERENCES calendar_subscriptions(id) ON DELETE CASCADE,
      uid TEXT,
      title TEXT NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      is_all_day INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      urgency INTEGER DEFAULT 3,
      importance INTEGER DEFAULT 3,
      deadline DATETIME,
      scheduled_start DATETIME,
      scheduled_end DATETIME,
      status TEXT NOT NULL DEFAULT 'scheduled',
      notes TEXT,
      start_reminder_sent INTEGER DEFAULT 0,
      end_reminder_sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      current_intent TEXT,
      pending_task_json TEXT,
      missing_fields TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrate user_settings columns if missing
  const columns = (db.prepare('PRAGMA table_info(user_settings)').all() as any[]).map(c => c.name);
  const addCol = (name: string, type: string, def: string) => {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE user_settings ADD COLUMN ${name} ${type} DEFAULT ${def};`);
    }
  };
  addCol('weixin_connected', 'INTEGER', '0');
  addCol('weixin_bot_token', 'TEXT', "''");
  addCol('weixin_bot_id', 'TEXT', "''");
  addCol('weixin_user_id', 'TEXT', "''");
  addCol('weixin_base_url', 'TEXT', "'https://ilinkai.weixin.qq.com'");
  addCol('weixin_sync_buf', 'TEXT', "''");
  addCol('weixin_nickname', 'TEXT', "''");

  // Seed initial admin if database has no users
  const defaultAdminPassword = process.env.ADMIN_DEFAULT_PASSWORD || '86698111';
  const userCount = db.prepare('SELECT count(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(defaultAdminPassword, salt);
    const secret = crypto.randomBytes(24).toString('hex');
    const webhookToken = crypto.randomBytes(16).toString('hex');

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, status, token_secret)
      VALUES (?, ?, 'admin', 'approved', ?)
    `).run('admin', hash, secret);

    const adminId = result.lastInsertRowid;
    db.prepare(`
      INSERT INTO user_settings (user_id, clawbot_webhook_token)
      VALUES (?, ?)
    `).run(adminId, webhookToken);

    console.log('🌟 [DB] Initial superadmin account initialized (username: admin)');
  }
}
