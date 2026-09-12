import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import { documentSchema } from '../src/shared/schema';
import { upgradeDocument } from '../src/shared/document-upgrade';
import { buildDeleteStatements, planPublicationSweep } from '../scripts/sweep-publications';

const asset = (id: string) => ({id,name:`${id}.png`,type:'image',mimeType:'image/png',url:`/api/assets/${id}`});

/** A legacy v1 document with one referenced asset and one unpublished registration. */
function legacyFixture() {
  const document = createDocument('web', 'Sweep fixture');
  const referenced = asset('kept-asset');
  document.assets = [referenced, asset('orphan-asset')];
  document.pages[0].nodes.push({id:'hero-image',type:'image',name:'Hero',x:0,y:0,width:100,height:100,src:referenced.url});
  return document;
}

test('legacy v1 sweep keeps referenced assets and prunes unreferenced ones', () => {
  const document = legacyFixture();
  const plan = planPublicationSweep({slug:'legacy-slug',revision:7,document});
  assert.ok(plan, 'A v1 publication must produce a sweep plan.');
  assert.deepEqual(plan.keptAssetIds, ['kept-asset']);
  assert.deepEqual(plan.prunedAssetIds, ['orphan-asset']);
});

test('the corrected snapshot validates and drops exactly the pruned assets', () => {
  const document = legacyFixture();
  const plan = planPublicationSweep({slug:'legacy-slug',revision:7,document});
  assert.ok(plan);
  assert.ok(documentSchema.parse(plan.document), 'The corrected document must validate.');
  assert.equal(plan.document.schemaVersion, 2);
  assert.equal(plan.document.assets.length, document.assets.length - plan.prunedAssetIds.length);
  assert.deepEqual(plan.document.assets.map((entry) => entry.id), ['kept-asset']);
  assert.deepEqual(document.assets.map((entry) => entry.id), ['kept-asset','orphan-asset'], 'Planning must not mutate the stored document.');
});

test('a v2 publication is skipped without statements', () => {
  const plan = planPublicationSweep({slug:'current-slug',revision:3,document:upgradeDocument(createDocument('slides'))});
  assert.equal(plan, null);
});

test('delete statements target exactly the pruned asset ids for the slug', () => {
  const statements = buildDeleteStatements('legacy-slug', ['orphan-asset','second-orphan']);
  assert.equal(statements.length, 2);
  for (const statement of statements) assert.equal(statement.params[0], 'legacy-slug');
  assert.deepEqual(statements.map((statement) => statement.params[1]), ['orphan-asset','second-orphan']);
  const plan = planPublicationSweep({slug:'legacy-slug',revision:7,document:legacyFixture()});
  assert.ok(plan);
  assert.deepEqual(plan.deleteStatements.map((statement) => statement.params[1]), plan.prunedAssetIds);
  assert.ok(plan.deleteStatements.every((statement) => statement.params[0] === 'legacy-slug'));
});
