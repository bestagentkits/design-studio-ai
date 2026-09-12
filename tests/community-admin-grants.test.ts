import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { claimCommunityAdminEmails, isCommunityAdmin } from '../server/community-admin-grants';
import { verifiedGitHubEmails } from '../server/github-login';
import { hash } from '../server/security';
import { ZodError } from 'zod';
import type { Bindings } from '../server/types';

test('provider email selection accepts verified secondary identities and rejects unverified or malformed claims', () => {
  assert.deepEqual(verifiedGitHubEmails([
    {email:'unverified@example.test',primary:true,verified:false},
    {email:'Verified@Example.test',primary:false,verified:true},
    {email:'also-verified@example.test',primary:true,verified:true},
  ]),['verified@example.test','also-verified@example.test']);
  assert.deepEqual(verifiedGitHubEmails([{email:'admin@example.test',primary:true,verified:false}]),[]);
  for(const input of [{email:'admin@example.test'},[{email:'admin@example.test',primary:true}],[{email:'admin@example.test',primary:true,verified:'true'}],[{email:'not-an-email',primary:true,verified:true}]]) assert.throws(()=>verifiedGitHubEmails(input),ZodError);
});

test('Community admin grants use real persisted verified claims, exact ID allowlists and live revocation', async t => {
  const directory=await mkdtemp(join(tmpdir(),'community-admin-grants-')), db=new SqliteDatabase(join(directory,'db.sqlite'));
  const env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(join(directory,'assets')),COMMUNITY_ADMIN_EMAILS:' Admin@Example.test , secondary@example.test ',COMMUNITY_ADMIN_IDS:'',OBSERVABILITY_ADMIN_IDS:'local-user'};
  try {
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
    for(const [id,email] of [['local-user','admin@example.test'],['provider-user','ordinary@example.test'],['other-user','other@example.test']]) await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind(id,email,id,'unused-test-password-hash',new Date().toISOString()).run();
    const count=async()=>(await db.prepare('SELECT COUNT(*) AS total FROM community_admin_claims').first<{total:number}>())!.total;

    await t.test('local registration email, display identity and other admin allowlists never grant Community privileges',async()=>{
      assert.equal(await isCommunityAdmin(env,'local-user'),false);assert.equal(await isCommunityAdmin(env,'provider-user'),false);assert.equal(await count(),0);
      const selected=verifiedGitHubEmails([{email:'admin@example.test',primary:true,verified:false},{email:'unlisted@example.test',primary:false,verified:true}]);
      await claimCommunityAdminEmails(env,'local-user',selected);
      assert.equal(await isCommunityAdmin(env,'local-user'),false);assert.equal(await count(),0);
    });

    await t.test('verified configured secondary email claims are normalized, hashed, persisted and idempotent',async()=>{
      const selected=verifiedGitHubEmails([{email:'ordinary@example.test',primary:true,verified:true},{email:'SECONDARY@example.test',primary:false,verified:true},{email:'SECONDARY@example.test',primary:false,verified:true}]);
      await claimCommunityAdminEmails(env,'provider-user',selected);await claimCommunityAdminEmails(env,'provider-user',selected);
      assert.equal(await isCommunityAdmin(env,'provider-user'),true);assert.equal(await isCommunityAdmin(env,'local-user'),false);assert.equal(await count(),1);
      const record=await db.prepare('SELECT * FROM community_admin_claims WHERE user_id=?').bind('provider-user').first<{email_hash:string;user_id:string;verified_at:string}>();
      assert.ok(record);assert.equal(record.email_hash,await hash('secondary@example.test'));assert.equal(record.user_id,'provider-user');assert.ok(Number.isFinite(Date.parse(record.verified_at)));
      assert.equal(JSON.stringify(record).includes('secondary@example.test'),false);
    });

    await t.test('email configuration removal revokes access immediately while claims remain auditable',async()=>{
      env.COMMUNITY_ADMIN_EMAILS='admin@example.test';assert.equal(await isCommunityAdmin(env,'provider-user'),false);assert.equal(await count(),1);
      env.COMMUNITY_ADMIN_EMAILS='';assert.equal(await isCommunityAdmin(env,'provider-user'),false);
      env.COMMUNITY_ADMIN_EMAILS='secondary@example.test';assert.equal(await isCommunityAdmin(env,'provider-user'),true);
    });

    await t.test('a subsequently verified owner of the same email takes over its single grant without duplicate claims',async()=>{
      await claimCommunityAdminEmails(env,'other-user',verifiedGitHubEmails([{email:'secondary@example.test',primary:false,verified:true}]));
      assert.equal(await count(),1);assert.equal(await isCommunityAdmin(env,'provider-user'),false);assert.equal(await isCommunityAdmin(env,'other-user'),true);
    });

    await t.test('explicit IDs are exact, whitespace-trimmed and independently revoked',async()=>{
      env.COMMUNITY_ADMIN_IDS=' local-user , provider-user ';
      assert.equal(await isCommunityAdmin(env,'local-user'),true);assert.equal(await isCommunityAdmin(env,'provider-user'),true);assert.equal(await isCommunityAdmin(env,'local'),false);assert.equal(await isCommunityAdmin(env,'LOCAL-USER'),false);
      env.COMMUNITY_ADMIN_IDS='provider-user';assert.equal(await isCommunityAdmin(env,'local-user'),false);
      env.COMMUNITY_ADMIN_IDS='';assert.equal(await isCommunityAdmin(env,'provider-user'),false);assert.equal(await isCommunityAdmin(env,'other-user'),true);
    });

    await t.test('account deletion removes persisted email claims and cannot leave an orphan admin grant',async()=>{
      await db.prepare('DELETE FROM users WHERE id=?').bind('other-user').run();
      assert.equal(await count(),0);assert.equal(await isCommunityAdmin(env,'other-user'),false);
    });
  } finally {db.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});}
});
