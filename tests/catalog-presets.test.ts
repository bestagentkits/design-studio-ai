import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, templates, themes } from '../src/shared/catalog';
import { extraTemplates, systemThemes } from '../src/shared/catalog-presets';
import { documentSchema } from '../src/shared/schema';
import { resolveLayout } from '../src/shared/layout';

test('new use-case templates validate and stay inside their page canvas', () => {
  for (const template of extraTemplates) {
    const doc = documentSchema.parse(createDocument(template.kind, template.name, undefined, template.id));
    assert.equal(doc.theme.id, template.themeId);
    for (const page of doc.pages) for (const node of resolveLayout(page).nodes) {
      if (node.type === 'model3d') continue;
      assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.width <= page.width && node.y + node.height <= page.height, `${template.id}: ${node.name} overflows`);
    }
  }
  assert.equal(new Set(templates.map(t => t.id)).size, templates.length);
  assert.equal(new Set(themes.map(t => t.id)).size, themes.length);
  assert.equal(createDocument('web').theme.id, 'atelier');
});
test('system-inspired presets can be applied through the ordinary document contract', () => {
  for (const theme of systemThemes) {
    const doc = documentSchema.parse(createDocument('web', 'Theme sample', theme.id));
    assert.deepEqual(doc.theme, theme);
    assert.ok(doc.theme.name.includes('inspired'));
  }
});
