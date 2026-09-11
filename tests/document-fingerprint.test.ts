import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../src/shared/catalog';
import {mergeDocuments} from '../src/shared/document-merge';
import {documentFingerprint} from '../src/shared/document-fingerprint';

test('saved content remains clean after schema normalization and timestamps',()=>{
 const doc=createDocument('web','Saved document');
 const merged=mergeDocuments(doc,doc,doc);
 assert.equal(documentFingerprint(doc),documentFingerprint(merged));
 merged.metadata.updatedAt=new Date().toISOString();
 merged.theme.colors=Object.fromEntries(Object.entries(merged.theme.colors).reverse());
 assert.equal(documentFingerprint(doc),documentFingerprint(merged));
 merged.pages[0].nodes[0].x+=1;
 assert.notEqual(documentFingerprint(doc),documentFingerprint(merged));
});
test('schema defaults compare equally but layer order remains significant',()=>{
 const doc=createDocument('video','Mesh');doc.schemaVersion=2;
 const parsed=mergeDocuments(doc,doc,doc);
 assert.equal(documentFingerprint(doc),documentFingerprint(parsed));
 parsed.pages[0].nodes.reverse();
 assert.notEqual(documentFingerprint(doc),documentFingerprint(parsed));
});
