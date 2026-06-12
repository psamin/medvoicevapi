// Lazy Postgres pool. Only connects when DATABASE_URL is set and a query runs, so
// the app/tests run fine with no Postgres when using the JSON store.
let pool = null;

export function pgEnabled() {
  return !!process.env.DATABASE_URL;
}

async function getPool() {
  if (!pool) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Most hosted Postgres (Supabase/Neon/RDS) needs SSL; local usually doesn't.
      ssl: process.env.PGSSL === 'disable' ? false : process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const p = await getPool();
  return p.query(text, params);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
