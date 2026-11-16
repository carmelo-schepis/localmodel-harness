import Database from 'better-sqlite3';
import { createClient, type InStatement } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sourcePath = process.env.SOURCE_DB;
const targetUrl = process.env.TURSO_DATABASE_URL;
const targetToken = process.env.TURSO_AUTH_TOKEN;
if (!sourcePath || !targetUrl || !targetToken) throw new Error('Set SOURCE_DB, TURSO_DATABASE_URL, and TURSO_AUTH_TOKEN before running this explicit migration.');

const tableNames = ['endpoints', 'projects', 'messages', 'files', 'drafts', 'cases'] as const;
const schema = `
CREATE TABLE IF NOT EXISTS endpoints (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (project_id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, message_id TEXT NOT NULL, status TEXT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_until TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_operations (project_id TEXT PRIMARY KEY, id TEXT NOT NULL, kind TEXT NOT NULL, lease_until TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_project ON chat_runs(project_id) WHERE status IN ('preparing','streaming');
CREATE INDEX IF NOT EXISTS chat_runs_lease ON chat_runs(status,lease_until);`;
const target = createClient({ url: targetUrl, authToken: targetToken });
const stagingDir = mkdtempSync(join(tmpdir(), 'hugo-sqlite-backup-'));
const backupPath = join(stagingDir, 'consistent.sqlite');

try {
  const source = new Database(resolve(sourcePath), { readonly: true, fileMustExist: true });
  await source.backup(backupPath);
  source.close();
  const snapshot = new Database(backupPath, { readonly: true, fileMustExist: true });
  const existing = await target.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if (existing.rows.length) throw new Error('The managed database is not empty. Import into a new, empty database; no target data was changed.');
  await target.executeMultiple(schema);
  const sourceRows = new Map<string, Record<string, unknown>[]>();
  for (const table of tableNames) sourceRows.set(table, snapshot.prepare(`SELECT * FROM ${table}${table === 'messages' ? ' ORDER BY rowid' : ''}`).all() as Record<string, unknown>[]);
  snapshot.close();
  for (const table of tableNames) {
    const rows = sourceRows.get(table)!;
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
    for (let offset = 0; offset < rows.length; offset += 250) {
      const batch: InStatement[] = rows.slice(offset, offset + 250).map(row => ({ sql, args: columns.map(column => row[column] as null | string | number | Uint8Array) }));
      await target.batch(batch, 'write');
    }
  }
  for (const table of tableNames) {
    const expected = sourceRows.get(table)!.length;
    const actual = Number((await target.execute(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count);
    if (actual !== expected) throw new Error(`Verification failed for ${table}: SQLite has ${expected} rows, managed database has ${actual}.`);
    console.log(`${table}: ${actual} rows verified`);
  }
  const expectedOrder = sourceRows.get('messages')!.map(row => row.id);
  const actualOrder = (await target.execute('SELECT id FROM messages ORDER BY rowid')).rows.map(row => row.id);
  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) throw new Error('Verification failed: message ordering differs from the SQLite snapshot.');
  console.log('Message identifiers and row order verified. Original SQLite database left untouched.');
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
  await target.close();
}
