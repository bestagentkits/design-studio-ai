#!/usr/bin/env node
/**
 * Change-based E2E test selection and lane partitioning for CI.
 *
 * Fails open: any path that is not classified, any CI-critical path, or any internal error
 * selects the FULL suite. Selection only ever narrows the E2E lane; `npm test` (typecheck and
 * the unit/integration suite) always runs in full.
 *
 * Usage:
 *   node scripts/test-plan.mjs --files-from=changed.txt --lanes=3
 *   node scripts/test-plan.mjs --files=src/app/community.tsx,server/community-routes.ts
 *   node scripts/test-plan.mjs --mode=full
 *
 * Output (stdout JSON):
 *   {"mode":"full|selected|docs-only","specs":[...],"matrix":{"include":[{"lane":"lane-1","files":"..."}]}}
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve relative to the script so the plan is identical from any working directory.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const ALL_SPECS = readdirSync(new URL('../tests', import.meta.url)).filter(name => name.endsWith('.spec.ts')).sort().map(name => `tests/${name}`);

// Browser specs that gate public exposure, authorization and delegation. They run on every
// code-touching diff regardless of which area changed; the unit suite covers the same contracts
// at the API level.
const SAFETY_SPECS = ['account-ui.spec.ts', 'oauth-browser.spec.ts', 'community-publish-ui.spec.ts', 'community-moderation-ui.spec.ts', 'workspace.spec.ts'];
// Paths that invalidate area scoping: a change here can affect any spec, so the full suite runs.
const CORE_PATHS = [
  /^server\/(index|security|types|projects|providers|mcp|exports|node|node-adapters|operation-worker|published-html|snapshot-export|asset-lifecycle|conversations|google-slides|discovery)\.ts$/,
  /^src\/shared\/(schema|catalog|catalog-presets|render|operations|document-|public-creative-projection|api-reference|export-contract|frame-export-budget|export-|react-export|motion-export|font-loading|document-asset-references|brief|collaboration-contract)\.?/,
  /^src\/app\/(app|editor|api|canvas-gestures|api-request-body|component-icons|styles|main)\./,
  /^src\/main\.tsx$/, /^src\/styles\.css$/, /^src\/vite-env\.d\.ts$/,
  /^index\.html$/, /^package\.json$/, /^package-lock\.json$/, /^tsconfig\.json$/, /^vite\.config\.ts$/, /^playwright\.config\.ts$/,
  /^scripts\/(run-e2e|build-renderer|build-public-docs|export-renderer|board-probe-shell|package-skill)\.mjs$/,
  /^scripts\/.*worker\.ts$/, /^scripts\/scene-angle-export\.ts$/, /^scripts\/motion-frame-export\.ts$/, /^scripts\/published-viewer\.ts$/,
  /^tests\/(authenticated-browser|built-static-assets)\.ts$/, /^tests\/helpers\//,
  /^migrations\//, /^\.github\//, /^wrangler\.jsonc$/, /^Dockerfile$/, /^compose\.yaml$/,
];

// Hand-written prose and skill packaging: no spec reads these (the public docs surface is generated
// from src/app/documentation.tsx and src/app/guide.tsx into dist/), so the E2E lane is skipped.
const DOCS_PATHS = [/^docs\//, /^README\.md$/, /^(AGENTS|CLAUDE)\.md$/, /^skills\//, /^LICENSE$/, /^plans\//];

const AREAS = [
  {
    name: 'community',
    paths: [/^src\/app\/community/, /^src\/app\/browser-community-tools/, /^src\/shared\/community/, /^src\/shared\/public-metadata/, /^server\/community-/, /^migrations\/00(13|14)-community/],
    specs: ['community-ui.spec.ts', 'community-publish-ui.spec.ts', 'community-moderation-ui.spec.ts', 'community-engagement-ui.spec.ts', 'community-profile-generation.spec.ts', 'community-metadata-generation.spec.ts', 'community-publication-completion.spec.ts'],
  },
  {
    name: 'visual-inspection',
    paths: [/^server\/visual-inspection/, /^src\/shared\/visual-inspection/, /^src\/app\/browser-visual-inspection/, /^src\/app\/visual-inspection/],
    specs: ['visual-inspection-ui.spec.ts'],
  },
  {
    name: 'providers',
    paths: [/^server\/provider-connections\.ts$/, /^server\/text-provider-request\.ts$/, /^server\/image-providers\.ts$/, /^src\/shared\/providers\.ts$/, /^src\/shared\/provider-requests\.ts$/, /^src\/shared\/discovery\.ts$/, /^src\/app\/provider/],
    specs: ['provider-settings.spec.ts', 'community-profile-generation.spec.ts', 'onboarding-ui.spec.ts'],
  },
  { name: 'briefs', paths: [/^src\/app\/design-brief/, /^src\/shared\/brief\//], specs: ['onboarding-ui.spec.ts'] },
  { name: 'accounts', paths: [/^server\/oauth\.ts$/, /^server\/github-login\.ts$/, /^server\/community-admin-grants\.ts$/, /^src\/app\/settings/, /^src\/app\/account/], specs: ['account-ui.spec.ts', 'oauth-browser.spec.ts'] },
  { name: 'observability', paths: [/^server\/observability-/, /^src\/app\/analytics\.ts$/, /^src\/app\/activity/, /^src\/shared\/observability/], specs: ['observability-ui.spec.ts'] },
  {
    name: 'painting',
    paths: [/^src\/shared\/paint/, /^src\/shared\/painting-/, /^src\/shared\/ink-/, /^src\/shared\/creative-/, /^src\/shared\/gif/, /^src\/shared\/board-/, /^src\/app\/paint/, /^src\/app\/creative-/, /^src\/app\/board-/, /^server\/painting-/, /^server\/creative-save-receipts\.ts$/],
    // diagram-quality-ui builds its golden SVG through src/shared/board-render.ts, so board changes run it too.
    specs: ['painting-advanced-ui.spec.ts', 'creative-editor-ui.spec.ts', 'creative-board-ui.spec.ts', 'board-engine-ui.spec.ts', 'board-gif-input-ui.spec.ts', 'diagram-quality-ui.spec.ts'],
  },
  { name: 'character', paths: [/^src\/shared\/character-/, /^src\/app\/character-/, /^src\/shared\/motion-/, /^src\/app\/motion-/, /^src\/shared\/bake/], specs: ['character-editor-ui.spec.ts', 'motion-sync-ui.spec.ts', 'scene-authoring.spec.ts'] },
  { name: 'scene3d', paths: [/^src\/shared\/scene-/, /^src\/shared\/mesh-/, /^src\/app\/mesh-/, /^src\/app\/scene-/, /^src\/shared\/three/], specs: ['scene-authoring.spec.ts', 'structured-editor-ui.spec.ts', 'advanced-editor-ui.spec.ts'] },
  { name: 'diagrams', paths: [/^src\/shared\/diagram-/, /^src\/shared\/diagram\./, /^src\/app\/diagram/, /^scripts\/build-diagram-font\.mjs$/], specs: ['diagram-quality-ui.spec.ts'] },
  { name: 'board-probes', paths: [/^scripts\/board-/, /^tests\/helpers\/gif-fixture\.ts$/], specs: ['board-engine-ui.spec.ts', 'board-gif-input-ui.spec.ts', 'creative-board-ui.spec.ts'] },
  { name: 'design-systems', paths: [/^server\/design-systems\.ts$/, /^server\/design-system-tools\.ts$/, /^src\/shared\/design-systems/, /^src\/app\/design-system/], specs: ['advanced-editor-ui.spec.ts', 'structured-editor-ui.spec.ts'] },
  { name: 'thumbnails', paths: [/^server\/thumbnails\.ts$/, /^src\/shared\/thumbnail/], specs: ['project-thumbnails.spec.ts', 'studio-feedback.spec.ts'] },
  {
    name: 'docs-ui',
    paths: [/^src\/app\/documentation/, /^src\/app\/guide/, /^src\/app\/api-playground/, /^src\/app\/public-navigation/, /^src\/app\/theme-toggle/, /^src\/app\/documentation\.css$/, /^public\/guide\//],
    specs: ['public-docs.spec.ts', 'studio-feedback.spec.ts', 'contextual-search.spec.ts', 'navigation-overlays.spec.ts', 'structured-editor-ui.spec.ts'],
  },
  { name: 'sync', paths: [/^server\/collaboration\.ts$/, /^src\/shared\/document-merge/, /^src\/app\/board-history/], specs: ['structured-editor-ui.spec.ts', 'creative-editor-ui.spec.ts'] },
  { name: 'cli', paths: [/^packages\/cli\//], specs: [] },
  {
    name: 'editor-shell-ui',
    paths: [/^src\/app\/keyboard-navigation/, /^src\/app\/inline-text-editor/, /^src\/app\/slide-player/, /^src\/shared\/transform\.ts$/, /^src\/app\/motion-clip-panel/],
    specs: ['keyboard-ux.spec.ts', 'navigation-overlays.spec.ts', 'editor-ergonomics.spec.ts', 'slide-navigation.spec.ts', 'structured-editor-ui.spec.ts', 'sidebar-preview.spec.ts'],
  },
  { name: 'workspace-shell', paths: [/^src\/app\/workspace/, /^src\/app\/templates/, /^src\/app\/design-library/], specs: ['workspace.spec.ts', 'studio-feedback.spec.ts'] },
];

// Any spec that no area maps is always selected, so adding a spec (or a new area) can never be
// silently under-covered by a source-path change.
const MAPPED_SPECS = new Set(AREAS.flatMap(area => area.specs));
const ALWAYS_SPECS = [...SAFETY_SPECS, ...ALL_SPECS.map(spec => spec.replace('tests/', '')).filter(spec => !MAPPED_SPECS.has(spec))];

// Coarse per-spec cost in seconds (both Playwright projects, measured locally) used only to
// balance lanes. Unknown specs count as 1.
const WEIGHTS = {
  'motion-sync-ui.spec.ts': 48,
  'structured-editor-ui.spec.ts': 41,
  'studio-feedback.spec.ts': 40,
  'painting-advanced-ui.spec.ts': 39,
  'advanced-editor-ui.spec.ts': 38,
  'creative-board-ui.spec.ts': 35,
  'community-publish-ui.spec.ts': 32,
  'project-thumbnails.spec.ts': 29,
  'creative-editor-ui.spec.ts': 26,
  'editor-ergonomics.spec.ts': 24,
  'keyboard-ux.spec.ts': 24,
  'workspace.spec.ts': 22,
  'provider-settings.spec.ts': 20,
  'scene-authoring.spec.ts': 20,
  'onboarding-ui.spec.ts': 18,
  'character-editor-ui.spec.ts': 17,
  'community-profile-generation.spec.ts': 14,
  'diagram-quality-ui.spec.ts': 14,
  'navigation-overlays.spec.ts': 14,
  'community-moderation-ui.spec.ts': 12,
  'observability-ui.spec.ts': 12,
  'public-docs.spec.ts': 12,
  'sidebar-preview.spec.ts': 10,
  'board-engine-ui.spec.ts': 9,
  'community-engagement-ui.spec.ts': 9,
  'contextual-search.spec.ts': 9,
  'slide-navigation.spec.ts': 9,
  'account-ui.spec.ts': 8,
  'community-ui.spec.ts': 8,
  'oauth-browser.spec.ts': 7,
  'board-gif-input-ui.spec.ts': 6,
};

function parseArgs(argv) {
  const options = { mode: 'auto', lanes: 0, files: [], format: 'json' };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) options.mode = arg.slice(7);
    else if (arg.startsWith('--lanes=')) options.lanes = Number(arg.slice(8)) || 0;
    else if (arg.startsWith('--files-from=')) options.files.push(...readFileSync(arg.slice(13), 'utf8').split(/\r?\n/));
    else if (arg.startsWith('--files=')) options.files.push(...arg.slice(8).split(','));
    else if (arg.startsWith('--format=')) options.format = arg.slice(9);
  }
  return options;
}

/** Fail open: an unusable diff, an unclassified path or a core path selects every spec. */
function classify(files) {
  const changed = files.map(file => file.trim()).filter(Boolean);
  if (changed.length === 0) return { mode: 'full', specs: ALL_SPECS, reasons: ['empty change list'] };
  if (changed.every(file => DOCS_PATHS.some(pattern => pattern.test(file))))
    return { mode: 'docs-only', specs: [], reasons: ['documentation-only change'] };
  const core = changed.filter(file => CORE_PATHS.some(pattern => pattern.test(file)));
  if (core.length) return { mode: 'full', specs: ALL_SPECS, reasons: [`CI-critical path changed: ${core.slice(0, 3).join(', ')}`] };
  const reasons = [], selected = new Set(), unclassified = [];
  for (const file of changed) {
    // A changed spec runs itself; a changed unit file is covered by the always-full unit lane.
    const specFile = /^tests\/(.+)\.spec\.ts$/.exec(file);
    if (specFile) { reasons.push(`${file} -> itself`); selected.add(`tests/${specFile[1]}.spec.ts`); continue; }
    if (/^tests\/.+\.test\.ts$/.test(file)) { reasons.push(`${file} -> unit lane`); continue; }
    if (DOCS_PATHS.some(pattern => pattern.test(file))) continue; // inert prose alongside code changes
    const area = AREAS.find(candidate => candidate.paths.some(pattern => pattern.test(file)));
    if (!area) { unclassified.push(file); continue; }
    reasons.push(`${file} -> ${area.name}`);
    for (const spec of area.specs) selected.add(`tests/${spec}`);
  }
  if (unclassified.length) return { mode: 'full', specs: ALL_SPECS, reasons: [`unclassified path: ${unclassified.slice(0, 3).join(', ')}`] };
  for (const spec of ALWAYS_SPECS) selected.add(`tests/${spec}`);
  reasons.push(`always-run specs: ${ALWAYS_SPECS.join(', ')}`);
  return { mode: 'selected', specs: [...selected].sort(), reasons };
}

// WEIGHTS are measured end-to-end seconds for one spec on both Playwright projects. Lane setup
// (install, browser, artifact download) costs roughly a minute of runner time, so sharding only pays
// off for a large selection: one lane below ~2.5 min of test time, two up to ~5.5 min, three above.
function laneCount(specs, requested) {
  if (requested > 0) return requested;
  const seconds = specs.reduce((total, spec) => total + (WEIGHTS[spec.split('/').pop()] ?? 1), 0);
  if (seconds <= 150) return 1;
  if (seconds <= 330) return 2;
  return 3;
}

/** Deterministic, weight-balanced lanes: heaviest first into the lightest lane. */
function partition(specs, lanes) {
  // A non-empty matrix keeps `strategy.matrix` valid even when the plan selects nothing; the job
  // itself is skipped by its `if` condition.
  if (specs.length === 0) return [{ lane: 'skipped', files: '' }];
  if (lanes <= 1) return [{ lane: 'all', files: specs.join(' ') }];
  const buckets = Array.from({ length: Math.min(lanes, Math.max(specs.length, 1)) }, (_, index) => ({ lane: `lane-${index + 1}`, specs: [], weight: 0 }));
  for (const spec of [...specs].sort((a, b) => (WEIGHTS[b.split('/').pop()] ?? 1) - (WEIGHTS[a.split('/').pop()] ?? 1) || a.localeCompare(b))) {
    const target = buckets.reduce((best, bucket) => (bucket.weight < best.weight ? bucket : best), buckets[0]);
    target.specs.push(spec);
    target.weight += WEIGHTS[spec.split('/').pop()] ?? 1;
  }
  return buckets.filter(bucket => bucket.specs.length).map(bucket => ({ lane: bucket.lane, files: bucket.specs.sort().join(' ') }));
}

function main() {
  let options = { mode: 'auto', lanes: 0, files: [], format: 'json' };
  let plan;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.mode === 'full') plan = { mode: 'full', specs: ALL_SPECS, reasons: ['forced full run'] };
    else if (options.mode === 'none') plan = { mode: 'docs-only', specs: [], reasons: ['forced skip'] };
    else {
      const files = options.files.length ? options.files : execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).split('\n');
      plan = classify(files);
    }
    plan.matrix = { include: partition(plan.specs, laneCount(plan.specs, options.lanes)) };
    // Diagnostics for tests/CI logs: a spec on disk that no area lists runs on every code change.
    plan.coverage = { mapped: MAPPED_SPECS.size, unmapped: ALL_SPECS.map(spec => spec.replace('tests/', '')).filter(spec => !MAPPED_SPECS.has(spec)) };
  } catch (error) {
    // Fail open: never let a selector problem silently reduce coverage.
    plan = { mode: 'full', specs: ALL_SPECS, reasons: [`selector error, running everything: ${error instanceof Error ? error.message : String(error)}`] };
    plan.matrix = { include: partition(plan.specs, 3) };
    plan.coverage = { mapped: MAPPED_SPECS.size, unmapped: [] };
  }
  if (options.format === 'args') console.log(plan.specs.join(' '));
  else console.log(JSON.stringify(plan, null, 2));
}

main();
