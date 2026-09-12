import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// The selector decides which browser specs CI runs, so a bug here silently drops coverage. These
// checks run inside the always-full unit lane.
const SPECS_ON_DISK = readdirSync(new URL('../tests', import.meta.url)).filter(name => name.endsWith('.spec.ts')).sort();
const plan = (args: string[]) => JSON.parse(execFileSync(process.execPath, ['scripts/test-plan.mjs', ...args], { encoding: 'utf8' }));

test('the E2E selector fails open and never loses a spec', () => {
  const full = plan(['--mode=full', '--lanes=3']);
  assert.equal(full.mode, 'full');
  assert.deepEqual(full.specs.map((spec: string) => spec.replace('tests/', '')).sort(), SPECS_ON_DISK);
  assert.deepEqual(full.coverage.unmapped, [], 'every spec on disk must be mapped to an area or always-run');

  // Partition completeness: a "full" run whose lanes dropped a spec would silently shrink the gate.
  const lanes = full.matrix.include.flatMap((lane: { files: string }) => lane.files.split(' '));
  assert.deepEqual([...lanes].sort(), [...full.specs].sort(), 'lanes must cover every selected spec');
  assert.equal(new Set(lanes).size, lanes.length, 'lanes must be disjoint');

  // Fail-open paths: an unusable or unclassifiable change must select everything.
  for (const args of [
    ['--files='], // empty change list
    ['--files=src/shared/schema.ts'], // CI-critical path
    ['--files=src/app/some-new-module.ts'], // unclassified path
    ['--files-from=.definitely-missing.txt'], // selector input error
  ]) {
    const failed = plan(args);
    assert.equal(failed.mode, 'full', args.join(' '));
    assert.equal(failed.specs.length, SPECS_ON_DISK.length, args.join(' '));
  }
});

test('a scoped change selects its mapped specs and always runs the safety set', () => {
  const selected = plan(['--files=src/app/community.tsx,server/community-routes.ts,src/shared/community.ts']);
  assert.equal(selected.mode, 'selected');
  for (const spec of ['community-ui.spec.ts', 'community-publish-ui.spec.ts', 'community-moderation-ui.spec.ts', 'community-engagement-ui.spec.ts', 'community-profile-generation.spec.ts', 'account-ui.spec.ts', 'oauth-browser.spec.ts', 'workspace.spec.ts'])
    assert.ok(selected.specs.includes(`tests/${spec}`), `${spec} must be selected`);
  assert.ok(selected.specs.length < SPECS_ON_DISK.length, 'a scoped change must not run every spec');
  const lanes = selected.matrix.include.flatMap((lane: { files: string }) => lane.files.split(' '));
  assert.deepEqual([...lanes].sort(), [...selected.specs].sort(), 'lanes must cover every selected spec');

  // A changed spec runs itself; a changed unit file is covered by this always-full lane.
  assert.deepEqual(plan(['--files=tests/slide-navigation.spec.ts']).specs, ['tests/account-ui.spec.ts', 'tests/community-moderation-ui.spec.ts', 'tests/community-publish-ui.spec.ts', 'tests/oauth-browser.spec.ts', 'tests/slide-navigation.spec.ts', 'tests/workspace.spec.ts']);
  assert.equal(plan(['--files=tests/briefs.test.ts']).mode, 'selected');

  // Documentation-only changes are inert for the browser lane (the public docs surface is generated
  // from src/app sources, so no spec reads docs/**), and mixed docs+code changes stay scoped.
  const docs = plan(['--files=docs/providers.md,README.md,AGENTS.md']);
  assert.equal(docs.mode, 'docs-only');
  assert.deepEqual(docs.specs, []);
  assert.equal(plan(['--files=docs/providers.md,src/app/community.tsx']).mode, 'selected');
});
