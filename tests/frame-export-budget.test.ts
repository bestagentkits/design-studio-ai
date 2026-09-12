import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocument} from '../src/shared/catalog';
import {renderSnapshotExport} from '../server/exports';
import {preflightCommunity} from '../server/community-publication';
import {FileBucket, SqliteDatabase} from '../server/node-adapters';
import {ApiError, now} from '../server/security';
import type {Bindings} from '../server/types';
import {frameExportBudget, MAX_FRAME_EXPORT_PIXELS} from '../src/shared/frame-export-budget';

test('frame budget keeps native dimensions and rounds the exclusive-end frame count upward', () => {
  const input = {width: 1280, height: 800, start: 0, end: 9.25, fps: 30};
  assert.deepEqual(frameExportBudget(input), {frameCount: 278, maxFrames: 65, maxFps: 7, withinLimits: false});
  assert.deepEqual(frameExportBudget({...input, fps: 7}), {frameCount: 65, maxFrames: 65, maxFps: 7, withinLimits: true});
  assert.equal(frameExportBudget({...input, start: 3, end: 12.25, fps: 7}).frameCount, 65);
  assert.equal(frameExportBudget({...input, fps: 8}).withinLimits, false);
});

test('frame budget enforces exact frame and pixel boundaries and rejects invalid ranges', () => {
  const input = {width: 16, height: 16, start: 0, end: 10, fps: 30};
  assert.equal(frameExportBudget(input).withinLimits, true);
  assert.equal(frameExportBudget({...input, end: 10.001}).withinLimits, false);
  assert.equal(frameExportBudget({...input, width: MAX_FRAME_EXPORT_PIXELS / 16, end: 1, fps: 1}).withinLimits, true);
  assert.equal(frameExportBudget({...input, width: MAX_FRAME_EXPORT_PIXELS / 16 + 1, end: 1, fps: 1}).withinLimits, false);
  for (const end of [0, -1, Infinity, NaN]) assert.equal(frameExportBudget({...input, end}).withinLimits, false);
  for (const fps of [0, 1.5, 61, Infinity, NaN]) assert.equal(frameExportBudget({...input, fps}).withinLimits, false);
  assert.equal(frameExportBudget({...input, start: -1}).withinLimits, false);
  assert.equal(frameExportBudget({...input, width: 0}).withinLimits, false);
  assert.equal(frameExportBudget({...input, width: NaN}).maxFps, 0);
  assert.equal(frameExportBudget({...input, end: 301}).maxFps, 0);
});

test('spritesheet admission also fits the renderer grid within its per-side limit', () => {
  const input = {width: 4096, height: 512, start: 0, end: 1, fps: 30};
  assert.equal(frameExportBudget(input).withinLimits, true);
  assert.equal(frameExportBudget({...input, format: 'png-sequence'}).withinLimits, true);
  assert.deepEqual(frameExportBudget({...input, format: 'spritesheet'}), {frameCount: 30, maxFrames: 16, maxFps: 16, withinLimits: false});
  assert.equal(frameExportBudget({...input, format: 'spritesheet', fps: 16}).withinLimits, true);
  assert.equal(frameExportBudget({...input, format: 'spritesheet', fps: 17}).withinLimits, false);
  assert.equal(frameExportBudget({...input, width: 512, height: 4096, format: 'spritesheet', fps: 20}).withinLimits, true);
  assert.equal(frameExportBudget({...input, width: 512, height: 4096, format: 'spritesheet', fps: 21}).withinLimits, false);
  assert.equal(frameExportBudget({...input, width: 16385, height: 1, format: 'spritesheet', fps: 1}).maxFrames, 0);
});

test('oversized spritesheet sides are rejected before launching a browser', async () => {
  const document = animatedDocument();
  document.pages[0].width = 4096;
  document.pages[0].height = 512;
  await assert.rejects(renderSnapshotExport({} as Bindings, document.name, document, {format: 'spritesheet', end: 1, fps: 30}, async () => { assert.fail('No asset work should start'); }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'render_budget_exceeded');
    assert.match(error.message, /16 fps/);
    assert.match(error.message, /16384 pixels per side/);
    return true;
  });
});

const animatedDocument = () => {
  const document = createDocument('3d', 'Frame budget regression');
  document.pages[0].width = 1280;
  document.pages[0].height = 800;
  document.timeline = {duration: 9.25, fps: 30, tracks: []};
  return document;
};
const budgetError = (error: unknown) => {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'render_budget_exceeded');
  assert.match(error.message, /7 fps/);
  assert.match(error.message, /1280.*800/);
  assert.match(error.message, /9\.25/);
  return true;
};

test('oversized frame archives are rejected before browser or asset work', async () => {
  const document = animatedDocument();
  const bindings = {} as Bindings;
  for (const format of ['png-sequence', 'spritesheet']) {
    await assert.rejects(renderSnapshotExport(bindings, document.name, document, {format, fps: 30}, async () => {
      assert.fail('An invalid frame budget must not resolve assets');
    }), budgetError);
    await assert.rejects(renderSnapshotExport(bindings, document.name, document, {format, start: 1, end: 1}, async () => {
      assert.fail('An invalid range must not resolve assets');
    }), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'render_budget_exceeded');
      assert.match(error.message, /end time greater than the start time/);
      return true;
    });
  }
});

test('Community preflight rejects oversized explicit frame sampling and accepts a fitting full duration', async () => {
  const db = new SqliteDatabase(':memory:');
  const directory = await mkdtemp(join(tmpdir(), 'frame-preflight-'));
  const env: Bindings = {DB: db, ASSETS_BUCKET: new FileBucket(directory)};
  try {
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile('migrations/' + file, 'utf8'));
    const time = now(), document = animatedDocument();
    await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind('frame-owner', 'frame-owner@example.test', 'Frame owner', 'unused-test-only', time).run();
    await db.prepare('INSERT INTO projects(id,user_id,name,kind,document,revision,created_at,updated_at) VALUES(?,?,?,?,?,11,?,?)').bind(document.id, 'frame-owner', document.name, document.kind, JSON.stringify(document), time, time).run();
    const input = {projectId: document.id, expectedProjectRevision: 11, title: 'Frame budget regression'};
    for (const format of ['png-sequence', 'spritesheet']) {
      await assert.rejects(preflightCommunity(env, 'frame-owner', {...input, formats: [{format, fps: 30}]}), budgetError);
      const accepted = await preflightCommunity(env, 'frame-owner', {...input, formats: [{format, fps: 7}]});
      assert.ok(accepted.formats.includes(format as 'png-sequence' | 'spritesheet'));
      assert.equal(accepted.document.timeline?.duration, 9.25);
      assert.equal(accepted.document.pages[0].width, 1280);
    }
    document.pages[0].width = 4096; document.pages[0].height = 512;
    await db.prepare('UPDATE projects SET document=? WHERE id=?').bind(JSON.stringify(document), document.id).run();
    await preflightCommunity(env, 'frame-owner', {...input, formats: [{format: 'png-sequence', end: 1, fps: 30}]});
    await assert.rejects(preflightCommunity(env, 'frame-owner', {...input, formats: [{format: 'spritesheet', end: 1, fps: 30}]}), error => {
      assert.ok(error instanceof ApiError); assert.equal(error.code, 'render_budget_exceeded'); assert.match(error.message, /16384 pixels per side/); return true;
    });
    await preflightCommunity(env, 'frame-owner', {...input, formats: [{format: 'spritesheet', end: 1, fps: 16}]});
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM community_jobs').first<{count: number}>())?.count, 0);
  } finally { db.close(); await rm(directory, {recursive: true, force: true}); }
});
