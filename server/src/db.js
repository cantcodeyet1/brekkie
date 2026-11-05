// One tiny interface over two Postgres backends:
//   DATABASE_URL set  -> Neon (or any Postgres) through `pg`
//   DATABASE_URL empty -> embedded Postgres (PGlite) stored in server/.pglite, for local development
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let impl;

export async function initDb() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    impl = {
      kind: 'neon',
      query: async (t, p) => (await pool.query(t, p)).rows,
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
    await pool.query(schema);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(path.join(here, '..', '.pglite'));
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
