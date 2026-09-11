import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveArtifact, liveArtifactSchema, renderLiveArtifact } from '../src/shared/live-artifact';
import { createDocument, createBlock } from '../src/shared/catalog';
import { renderSvg } from '../src/shared/render';
import { documentSchema } from '../src/shared/schema';

test('renderLiveArtifact is deterministic and maps params to blocks', () => {
  const theme = createDocument('web', 'Theme').theme;
  const kpi = { renderer: 'kpi' as const, params: { title: 'Revenue', label: 'This quarter', value: 4200 } };
  assert.deepEqual(renderLiveArtifact(kpi, theme), renderLiveArtifact(structuredClone(kpi), theme));
  const kpiView = renderLiveArtifact(kpi, theme);
  assert.equal(kpiView.title, 'Revenue');
  assert.deepEqual(kpiView.blocks, [{ label: 'This quarter', value: '4200', accent: true }]);

  const progress = { renderer: 'progress' as const, params: { value: 140 } };
  const progressView = renderLiveArtifact(progress, theme);
  assert.equal(progressView.blocks[0].value, '100%', 'progress clamps to 100');

  const list = { renderer: 'stat-list' as const, params: { title: 'Overview', users: 12, revenue: '3.2k' } };
  const listView = renderLiveArtifact(list, theme);
  assert.equal(listView.title, 'Overview');
  assert.equal(listView.blocks.length, 2);
  assert.deepEqual(listView.blocks.map(b => b.label).sort(), ['revenue', 'users']);
});

test('liveArtifactSchema and parseLiveArtifact validate the manifest shape', () => {
  assert.doesNotThrow(() => liveArtifactSchema.parse({ renderer: 'kpi', params: { value: 1 } }));
  assert.throws(() => liveArtifactSchema.parse({ renderer: 'unknown' }));
  assert.throws(() => liveArtifactSchema.parse({ renderer: 'kpi', params: { value: { nested: true } } }));

  assert.deepEqual(parseLiveArtifact({ live: { renderer: 'kpi', params: {} } }), { renderer: 'kpi', params: {} });
  assert.equal(parseLiveArtifact({ live: { renderer: 'bad' } }), null);
  assert.equal(parseLiveArtifact({}), null);
  assert.equal(parseLiveArtifact(null), null);
  assert.equal(parseLiveArtifact('not-object'), null);

  // `params` is defaulted, so a manifest without params must parse and render.
  const noParams = parseLiveArtifact({ live: { renderer: 'kpi' } });
  assert.deepEqual(noParams, { renderer: 'kpi', params: {} });
  assert.doesNotThrow(() => renderLiveArtifact(noParams!, createDocument('web', 'Theme').theme));
});

test('renderSvg resolves a live node and document writes validate the manifest', () => {
  const doc = createDocument('web', 'Live test');
  const node = createBlock('live-kpi')[0];
  node.data = { live: { renderer: 'kpi', params: { title: 'Revenue', label: 'This quarter', value: 4200 } } };
  doc.pages[0].nodes = [node];
  const svg = renderSvg(doc);
  assert.match(svg, /Revenue/);
  assert.match(svg, /4200/);
  assert.match(svg, /<rect[^>]*rx="12"/, 'live node renders its card background and radius');

  assert.doesNotThrow(() => documentSchema.parse(doc), 'valid live manifest is accepted');
  const invalid = structuredClone(doc);
  invalid.pages[0].nodes[0].data = { live: { renderer: 'unknown' } };
  assert.throws(() => documentSchema.parse(invalid), /live-artifact/);
});
