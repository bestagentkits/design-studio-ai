import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect } from './authenticated-browser';

test('operator reviews real curation and reports without overriding owner unlisting',async({page,baseURL},testInfo)=>{
  test.setTimeout(180_000);
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');expect(process.env.STUDIO_E2E_SPEC_ISOLATED).toBe('1');
  const directory=resolve(process.env.DATA_DIR!);expect(directory.startsWith(resolve(tmpdir())+'\\studio-e2e-')||directory.startsWith(resolve(tmpdir())+'/studio-e2e-')).toBe(true);
  const me=await(await page.request.get('/api/auth/me')).json();expect(me.user.id).toBeTruthy();
  const database=new DatabaseSync(join(directory,'studio.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout=5000');
    const actual=database.prepare('SELECT email FROM users WHERE id=?').get(me.user.id) as {email:string};expect(actual.email).toBe(me.user.email);
    // A verified-identity fixture for this isolated server; product routes still enforce the persisted grant.
    database.prepare('INSERT INTO community_admin_claims(email_hash,user_id,verified_at) VALUES(?,?,?) ON CONFLICT(email_hash) DO UPDATE SET user_id=excluded.user_id,verified_at=excluded.verified_at').run(createHash('sha256').update('community-operator@studio-test.invalid').digest('base64url'),me.user.id,new Date().toISOString());
  } finally { database.close(); }
  const headers={Origin:baseURL!};
  expect((await page.request.put('/api/community/me/profile',{headers,data:{displayName:'Operator test creator',handle:'operator-'+randomUUID().slice(0,8),bio:'',expectedProfileRevision:0}})).ok()).toBe(true);
  const {project}=await(await page.request.post('/api/projects',{headers,data:{name:'Moderation browser design '+testInfo.project.name,kind:'web'}})).json();
  const metadata={projectId:project.id,expectedProjectRevision:project.revision,title:project.name,description:'Real renderer-backed moderation check.',tags:[],formats:[],cover:{pageIndex:0,focalX:.5,focalY:.5,time:0}};
  const {preflight}=await(await page.request.post('/api/community/preflight',{headers,data:metadata})).json();
  const receipt=await page.request.post('/api/community/listings',{headers,data:{...metadata,operationId:randomUUID(),digest:preflight.digest,license:'CC-BY-4.0',acceptLicense:true,confirmPublic:true}});expect(receipt.status()).toBe(202);const {job}=await receipt.json();
  await expect.poll(async()=> (await(await page.request.get(`/api/community/jobs/${job.operationId}`)).json()).job.status,{timeout:90_000}).toBe('succeeded');
  const {job:done}=await(await page.request.get(`/api/community/jobs/${job.operationId}`)).json();
  await page.goto('/community/moderation');await page.getByRole('button',{name:'Create collection',exact:true}).click();await page.getByLabel('Collection title',{exact:true}).fill('Reviewed selection '+testInfo.project.name);await page.getByRole('button',{name:'Add reviewed design',exact:true}).click();await page.getByLabel('Listing ID',{exact:true}).fill(done.listingId);await page.getByLabel('Reviewed version',{exact:true}).fill('1');await page.getByLabel('Why this is a Community pick',{exact:true}).fill('Useful visible structure, reviewed at version one.');await page.getByRole('button',{name:'Save collection',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/community');await expect(page.getByText('Community pick · Useful visible structure, reviewed at version one.').first()).toBeVisible();
  expect((await page.request.post(`/api/community/listings/${done.listingId}/reports`,{headers,data:{operationId:randomUUID(),version:1,reason:'privacy',message:'Review the visible content of this isolated test design.'}})).status()).toBe(201);
  await page.goto('/community/moderation');await page.getByRole('button',{name:'Review report',exact:true}).first().click();await page.getByRole('button',{name:'Preview reported version',exact:true}).click();await expect(page.getByTitle('Private reported version preview',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Stop preview',exact:true}).click();await page.getByLabel('Decision',{exact:true}).selectOption('hide');await page.getByLabel('Decision reason',{exact:true}).fill('Hidden for the isolated browser review.');await page.getByRole('button',{name:'Confirm decision',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await page.request.get(`/api/community/listings/${done.listingId}`)).status()).toBe(404);
  const {listings}=await(await page.request.get('/api/community/me/listings')).json();const listing=listings.find((item:{id:string})=>item.id===done.listingId);expect((await page.request.post(`/api/community/listings/${done.listingId}/unlist`,{headers,data:{operationId:randomUUID(),expectedListingRevision:listing.revision}})).ok()).toBe(true);
  await page.getByRole('button',{name:'Review report',exact:true}).first().click();await page.getByLabel('Decision',{exact:true}).selectOption('restore');await page.getByLabel('Decision reason',{exact:true}).fill('Moderator restriction cleared; owner unlisting must remain.');await page.getByRole('button',{name:'Confirm decision',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await page.request.get(`/api/community/listings/${done.listingId}`)).status()).toBe(404);
});
