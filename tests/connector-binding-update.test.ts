import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixtures/connector-operation-context';
import { app } from '../server/index';
import { importProjectSource } from '../server/project-sources';
test('editing a binding invalidates grants and retains disconnected snapshots with stale-edit protection',async t=>{
  const f=await setup(t);f.env.CONNECTORS_ENABLED='true';
  await f.db.prepare("UPDATE project_connection_bindings SET role='source',selection_json=? WHERE id='binding'").bind(JSON.stringify({adapter:'mcp',tools:[],resources:['resource://old']})).run();
  const snapshot=await importProjectSource(f.env,f.session,'alice-project','binding',{selection:{adapter:'mcp',tools:[],resources:['resource://old']},remoteIdentity:'resource://old',remoteVersion:'1',mimeType:'text/plain',extractionVersion:'utf8',bytes:new TextEncoder().encode('Original source')});
  const update=(credential:string,revision=1)=>app.request('https://studio.test/api/projects/alice-project/connections/binding',{method:'PUT',headers:{Cookie:`studio_session=${credential}`,Origin:'https://studio.test','Content-Type':'application/json'},body:JSON.stringify({expectedPolicyRevision:revision,role:'source',selection:{adapter:'mcp',tools:[],resources:['resource://new']}})},f.env);
  assert.equal((await update('bob-session')).status,404);
  const response=await update('alice-session');assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json() as any).binding.policyRevision,2);
  assert.equal((await f.db.prepare('SELECT status FROM project_source_snapshots WHERE id=?').bind(snapshot.id).first<any>()).status,'disconnected');
  assert.ok((await f.db.prepare("SELECT revoked_at FROM connection_agent_grants WHERE id='grant'").first<any>()).revoked_at);
  assert.equal((await update('alice-session')).status,409);assert.equal((await f.db.prepare("SELECT policy_revision FROM project_connection_bindings WHERE id='binding'").first<any>()).policy_revision,2);
});
