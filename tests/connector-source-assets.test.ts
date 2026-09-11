import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixtures/connector-operation-context';
import { importProjectSource } from '../server/project-sources';
import { app } from '../server/index';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5YsAAAAASUVORK5CYII=','base64');
test('source images use project asset isolation, validate bytes and reject revoked authority during storage',async t=>{
  const f=await setup(t);f.env.CONNECTORS_ENABLED='true';
  await f.db.prepare("UPDATE project_connection_bindings SET role='source',selection_json=? WHERE id='binding'").bind(JSON.stringify({adapter:'mcp',tools:[],resources:['image://selected']})).run();
  const source=await importProjectSource(f.env,f.session,'alice-project','binding',{selection:{adapter:'mcp',tools:[],resources:['image://selected']},remoteIdentity:'image://selected',remoteVersion:'1',mimeType:'image/png',extractionVersion:'image-v1',bytes:png});
  const copy=(user='alice',project='alice-project')=>app.request(`https://studio.test/api/projects/${project}/sources/${source.id}/asset`,{method:'POST',headers:{Cookie:`studio_session=${user}-session`,Origin:'https://studio.test','Content-Type':'application/json'},body:'{}'},f.env);
  assert.equal((await copy('bob')).status,404);
  const imported=await copy();assert.equal(imported.status,201,await imported.clone().text());const result=await imported.json() as any;assert.equal(result.sourceId,source.id);
  const asset=await f.db.prepare('SELECT project_id,user_id,mime_type FROM assets WHERE id=?').bind(result.asset.id).first<any>();assert.deepEqual({...asset},{project_id:'alice-project',user_id:'alice',mime_type:'image/png'});
  const put=f.env.ASSETS_BUCKET.put.bind(f.env.ASSETS_BUCKET);
  f.env.ASSETS_BUCKET.put=async(...args)=>{await f.db.prepare("UPDATE project_connection_bindings SET policy_revision=policy_revision+1 WHERE id='binding'").run();return put(...args);};
  assert.equal((await copy()).status,409);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM assets').first<any>()).count,1);
});
