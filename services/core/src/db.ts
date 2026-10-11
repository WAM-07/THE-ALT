import pg from 'pg';

// Return timestamptz as Date and bigint ids as strings (pg defaults), numeric as string.
export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (err) => console.error('[core] idle database client error', err));
  return pool;
}

/** Runs fn inside a transaction; rolls back on any thrown error. */
export async function tx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
