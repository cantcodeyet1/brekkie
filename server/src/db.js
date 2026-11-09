// One tiny interface over two Postgres backends:
//   DATABASE_URL set  -> Neon (or any Postgres) through `pg`
//   DATABASE_URL empty -> embedded Postgres (PGlite) stored in server/.pglite, for local development
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let impl;
let pool;

export async function initDb() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    // Neon drops idle connections, so keep them short-lived and never let a dead socket crash the process
    pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
    pool.removeAllListeners('error'); pool.on('error', (e) => console.error('Idle database connection dropped:', e.message));
    const dropped = (e) => ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01'].includes(e?.code) || /Connection terminated|read ECONNRESET/i.test(e?.message || '');
    const run = async (t, p) => { try { return (await pool.query(t, p)).rows; } catch (e) { if (!dropped(e)) throw e; return (await pool.query(t, p)).rows; } };   // one retry on a dead socket
    impl = {
      kind: 'neon',
      query: run,
      tx: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const r = await fn(async (t, p) => (await c.query(t, p)).rows);
          await c.query('commit');
          return r;
        } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
      },
    };
    await run(schema);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(process.env.PGLITE_DIR || path.join(here, '..', '.pglite'));   // PGLITE_DIR=memory:// gives a throwaway database (used by the tests)
    await db.waitReady;
    impl = {
      kind: 'pglite',
      query: async (t, p) => (await db.query(t, p)).rows,
      tx: (fn) => db.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)),
    };
    await db.exec(schema);
  }
  return impl.kind;
}

export const q = (text, params) => impl.query(text, params);
export const tx = (fn) => impl.tx(fn);
