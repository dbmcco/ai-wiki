import pg from 'pg';
import { neon, neonConfig } from '@neondatabase/serverless';

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;
export type QueryResult<T extends pg.QueryResultRow> = pg.QueryResult<T>;

let pool: pg.Pool | null = null;
let neonSql: ReturnType<typeof neon> | null = null;

// Detect if we're using Neon (serverless) or local PostgreSQL
function isNeonConnection(url: string): boolean {
  return url.includes('neon.tech') || url.includes('neon.database');
}

export function getDb(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // For Neon in serverless, we still use pg Pool but with SSL
    const isNeon = isNeonConnection(connectionString);

    pool = new Pool({
      connectionString,
      max: isNeon ? 1 : 20, // Neon handles pooling server-side
      idleTimeoutMillis: isNeon ? 0 : 30000,
      connectionTimeoutMillis: 5000,
      ssl: isNeon ? { rejectUnauthorized: false } : undefined,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }
  return pool;
}

// Get Neon serverless SQL function (for edge/serverless contexts)
export function getNeonSql() {
  if (!neonSql) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    neonConfig.fetchConnectionCache = true;
    neonSql = neon(connectionString);
  }
  return neonSql;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getDb().query<T>(text, params);
}

export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}
