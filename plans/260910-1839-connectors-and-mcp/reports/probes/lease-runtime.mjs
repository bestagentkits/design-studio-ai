import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Scratch-only SQL proves CAS/lease primitives; it is not a product migration.
const schema = `CREATE TABLE operations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, idempotency TEXT NOT NULL, status TEXT NOT NULL, lease TEXT, expires INTEGER, revision INTEGER NOT NULL DEFAULT 1, UNIQUE(owner,idempotency));`;
const reserve = `INSERT INTO operations(id,owner,idempotency,status) VALUES(?,?,?,'pending') ON CONFLICT(owner,idempotency) DO NOTHING`;
const claim = `UPDATE operations SET status='running',lease=?,expires=?,revision=revision+1 WHERE id=? AND owner=? AND status='pending' AND revision=? RETURNING id`;
const recover = `UPDATE operations SET status='outcome_unknown',lease=NULL,expires=NULL,revision=revision+1 WHERE status='running' AND expires<?`;
const finish = `UPDATE operations SET status='succeeded',lease=NULL,expires=NULL,revision=revision+1 WHERE id=? AND owner=? AND status='running' AND lease=? AND revision=? RETURNING id`;
async function verify(db) {
  await db.exec(schema);
  await Promise.all([db.run(reserve, ['one','alice','same']), db.run(reserve, ['two','alice','same'])]);
  const rows = await db.all('SELECT * FROM operations', []);
  assert.equal(rows.length, 1);
  const id = rows[0].id;
  const claims = await Promise.all([db.all(claim, ['tab-a',100,id,'alice',1]), db.all(claim, ['tab-b',100,id,'alice',1])]);
  assert.equal(claims.flat().length, 1);
  assert.equal((await db.all(claim, ['thief',100,id,'bob',2])).length, 0);
  await db.run(recover, [101]);
  assert.equal((await db.all(finish, [id,'alice',claims[0].length ? 'tab-a' : 'tab-b',2])).length, 0);
  assert.equal((await db.all(claim, ['replay',200,id,'alice',3])).length, 0);
  const result = (await db.all('SELECT status,revision FROM operations', []))[0];
  assert.equal(result.status, 'outcome_unknown');
  return result;
}
const native = new DatabaseSync(':memory:');
let runtime;
try {
  const node = await verify({ exec: sql => native.exec(sql), run: (sql,args) => native.prepare(sql).run(...args), all: (sql,args) => native.prepare(sql).all(...args) });
  runtime = new Miniflare(convertV4MiniflareOptions({ modules:true, compatibilityDate:'2026-09-07', d1Databases:['DB'], script:'export default {fetch(){return new Response("scratch")}}' }));
  const db = await runtime.getD1Database('DB');
  const d1 = await verify({ exec: sql => db.exec(sql), run: (sql,args) => db.prepare(sql).bind(...args).run(), all: async (sql,args) => (await db.prepare(sql).bind(...args).all()).results });
  console.log(JSON.stringify({ node, localD1:d1, cases:['duplicate reservation','single lease across tabs','owner isolation','unknown expired write','late completion rejected','unknown replay rejected'] }));
} finally { native.close(); await runtime?.dispose(); }
