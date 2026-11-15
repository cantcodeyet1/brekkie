// One tiny interface over two Postgres backends:
//   DATABASE_URL set  -> Neon (or any Postgres) through `pg`
//   DATABASE_URL empty -> embedded Postgres (PGlite) stored in server/.pglite, for local development
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let impl;
let pool;
let stamp = null;   // set when the database still needs its start-up work (see markBooted)

/** `fingerprint` stands for the data files start-up copies into the database: while it and schema.sql are unchanged, a hosted
 *  function skips that work on a cold start (it used to take hundreds of round trips to the database every time). */
export async function initDb(fingerprint = '') {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    // Neon drops idle connections, so keep them short-lived and never let a dead socket crash the process
    pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
    pool.removeAllListeners('error'); pool.on('error', (e) => console.error('Idle database connection dropped:', e.message));
    const dropped = (e) => ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03'].includes(e?.code) || /Connection terminated|ECONNRESET|not queryable|timeout exceeded when trying to connect/i.test(e?.message || '');
    // A function that slept leaves up to five dead sockets in the pool, and every failed one is thrown away as it is found,
    // so keep going until a fresh connection is opened rather than giving up after one.
    const run = async (t, p) => {
      for (let i = 0; ; i++) { try { return (await pool.query(t, p)).rows; } catch (e) { if (!dropped(e) || i >= 6) throw e; } }
    };
    impl = {
      kind: 'neon',
      query: run,
      tx: async (fn) => {
        let c;
        for (let i = 0; ; i++) {
          c = await pool.connect();
          try { await c.query('begin'); break; } catch (e) { c.release(e); if (!dropped(e) || i >= 6) throw e; }
        }
        try {
          const r = await fn(async (t, p) => (await c.query(t, p)).rows);
          await c.query('commit');
          return r;
        } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
      },
    };
    await run('create table if not exists app_meta(key text primary key, value text)');
    const want = crypto.createHash('sha1').update(schema).update(String(fingerprint)).digest('hex');
    const [have] = await run("select value from app_meta where key='boot'");
    if (have?.value === want) return 'neon';      // already set up for this version of the code
    stamp = want;
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

/** true while the start-up work has not been recorded as done for this version */
export const needsBoot = () => stamp !== null || impl?.kind !== 'neon';
/** records that the start-up work finished, so the next cold start can skip it */
export async function markBooted() {
  if (stamp === null) return;
  await impl.query("insert into app_meta(key, value) values ('boot', $1) on conflict (key) do update set value=excluded.value", [stamp]);
  stamp = null;
}
export const q = (text, params) => impl.query(text, params);
export const tx = (fn) => impl.tx(fn);
