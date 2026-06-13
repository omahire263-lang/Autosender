import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

let db: Database;

export async function initDb() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phoneNumber TEXT UNIQUE,
      sessionString TEXT,
      sessionToken TEXT UNIQUE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT,
      status TEXT,
      totalUsers INTEGER,
      sentCount INTEGER DEFAULT 0,
      failedCount INTEGER DEFAULT 0,
      estimatedTime INTEGER,
      remainingUsers TEXT,
      baseDelay REAL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sent_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT UNIQUE,
      sentAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { await db.exec('ALTER TABLE users ADD COLUMN sessionToken TEXT'); } catch {}
  try { await db.exec('ALTER TABLE campaigns ADD COLUMN remainingUsers TEXT'); } catch {}
  try { await db.exec('ALTER TABLE campaigns ADD COLUMN baseDelay REAL'); } catch {}
}

export function getDb() {
  return db;
}
