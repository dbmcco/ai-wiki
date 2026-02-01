import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const db = getDb();
  const result = await db.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id'
  );
  return new Set(result.rows.map((row) => row.filename));
}

async function getMigrationFiles(): Promise<string[]> {
  const files = fs.readdirSync(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function applyMigration(filename: string) {
  const db = getDb();
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf-8');

  console.log(`Applying migration: ${filename}`);

  await db.query('BEGIN');
  try {
    await db.query(sql);
    await db.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    await db.query('COMMIT');
    console.log(`  Applied successfully`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function migrate() {
  console.log('Running database migrations...\n');

  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = await getMigrationFiles();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  console.log(`Found ${pending.length} pending migration(s):\n`);

  for (const file of pending) {
    await applyMigration(file);
  }

  console.log('\nAll migrations applied.');
}

async function main() {
  try {
    await migrate();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
