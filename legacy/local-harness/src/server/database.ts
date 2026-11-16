import { createClient, type InArgs, type InStatement } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
CREATE INDEX IF NOT EXISTS chat_runs_lease ON chat_runs(status,lease_until);
`;

const localPath = resolve(process.env.DATA_DIR ?? './data', 'harness.sqlite');
if (!process.env.TURSO_DATABASE_URL) {
  if (process.env.VERCEL) throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required on Vercel.');
  mkdirSync(dirname(localPath), { recursive: true });
}

const client = createClient(process.env.TURSO_DATABASE_URL
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: `file:${localPath}` });

export async function initializeDatabase() {
  if (process.env.TURSO_DATABASE_URL && !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is configured.');
  }
  await client.executeMultiple(schema);
}

export async function all<T>(sql: string, args: InArgs = []): Promise<T[]> {
  const result = await client.execute({ sql, args });
  return result.rows as unknown as T[];
}

export async function get<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
  const result = await client.execute({ sql, args });
  return result.rows[0] as unknown as T | undefined;
}

export async function run(sql: string, args: InArgs = []): Promise<{ changes: number }> {
  const result = await client.execute({ sql, args });
  return { changes: Number(result.rowsAffected) };
}

export async function batch(statements: InStatement[], mode: 'read' | 'write' = 'write') {
  return client.batch(statements, mode);
}

export async function executeMultiple(sql: string) {
  return client.executeMultiple(sql);
}

