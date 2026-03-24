import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = path.join(PROJECT_ROOT, 'clitrigger.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initDatabase(db);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
