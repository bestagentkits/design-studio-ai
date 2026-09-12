import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicMetadata, stripPublicMetadata } from '../src/shared/public-metadata';

const defaults = { origin: 'https://self-hosted.example', path: '/', title: 'Design Studio AI', description: 'A workspace for people and agents.' };
const schema = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);

test('homepage metadata uses the deployment origin and describes the real application', () => {
  const html = publicMetadata(defaults);
  assert.match(html, /property="og:image" content="https:\/\/self-hosted.example\/social-card.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  const graph = schema(html)['@graph'];
  assert.deepEqual(graph.map((node: any) => node['@type']), ['WebSite', 'WebPage', 'SoftwareApplication']);
  assert.equal(graph[1].mainEntity['@id'], graph[2]['@id']);
  assert.equal(graph[1].isPartOf['@id'], graph[0]['@id']);
  assert.equal(graph[2].offers, undefined);
  assert.equal(graph[2].aggregateRating, undefined);
});

test('documentation metadata preserves article identity and linked breadcrumbs', () => {
  const html = publicMetadata({ ...defaults, path: '/docs/api', title: 'REST API', type: 'TechArticle', breadcrumbs: [{ name: 'Home', path: '/' }, { name: 'Documentation', path: '/docs' }, { name: 'REST API', path: '/docs/api' }] });
  const graph = schema(html)['@graph'];
  assert.equal(graph[2]['@type'], 'TechArticle');
  assert.equal(graph[1].mainEntity['@id'], graph[2]['@id']);
  assert.equal(graph[1].breadcrumb['@id'], graph[3]['@id']);
  assert.equal(graph[3].itemListElement[2].item, 'https://self-hosted.example/docs/api');
  assert.match(html, /property="og:type" content="article"/);
});

test('custom Community covers are shared without fabricated image dimensions', () => {
  const html = publicMetadata({ ...defaults, path: '/community/designs/example', type: 'ItemPage', image: '/api/community/listings/example/cover', imageAlt: 'Public cover' });
  assert.match(html, /name="twitter:image" content="https:\/\/self-hosted.example\/api\/community\/listings\/example\/cover"/);
  assert.match(html, /property="og:image:alt" content="Public cover"/);
  assert.doesNotMatch(html, /og:image:(width|height|type)/);
});

test('private and filtered pages do not advertise indexable structured data', () => {
  const html = publicMetadata({ ...defaults, path: '/community/saved', indexable: false });
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(html, /application\/ld\+json/);
});

test('metadata escapes public user content and replaces stale shell tags once', () => {
  const title = 'A "title" </script><script>alert(1)</script>';
  const fresh = publicMetadata({ ...defaults, path: '/community/designs/example', title });
  assert.doesNotMatch(fresh, /<script>alert\(1\)<\/script>/);
  assert.equal(schema(fresh)['@graph'][1].name, title);
  const shell = `<html><head><link rel="icon" href="/favicon.svg">${publicMetadata(defaults)}</head></html>`;
  const replaced = stripPublicMetadata(shell).replace('</head>', `${fresh}</head>`);
  for (const pattern of [/<title>/g, /name="description"/g, /rel="canonical"/g, /property="og:image"/g, /name="twitter:card"/g, /application\/ld\+json/g]) assert.equal([...replaced.matchAll(pattern)].length, 1);
  assert.match(replaced, /rel="icon"/);
});
