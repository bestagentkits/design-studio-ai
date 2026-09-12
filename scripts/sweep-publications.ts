#!/usr/bin/env node
// Sweep legacy (schemaVersion 1) publications so unreferenced assets stop being retrievable.
//
// Legacy publishes registered every asset of a document in `publication_assets`, so a v1
// publication kept serving assets it never referenced through `/published/<slug>/assets/<id>`.
// The publish-time fix only protects future rows; this script repairs existing ones by
// re-deriving the public snapshot (`upgradeDocument` -> `publicCreativeProjection`) and deleting
// the `publication_assets` rows for assets the document no longer references.
//
// Already-exported downloads keep the bytes they left the system with: the sweep rewrites the
// stored database snapshot, but it cannot recall or rewrite files that were exported before it ran.
//
// Usage:
//   node --import tsx scripts/sweep-publications.ts           # dry run (default, no writes)
//   node --import tsx scripts/sweep-publications.ts --apply   # delete pruned rows + rewrite documents
// Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; the D1 database id comes from wrangler.jsonc.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { publicCreativeProjection } from '../src/shared/public-creative-projection.ts';
import { upgradeDocument } from '../src/shared/document-upgrade.ts';
import { documentSchema, type DesignDocument } from '../src/shared/schema.ts';

export const DELETE_PUBLICATION_ASSET_SQL = 'DELETE FROM publication_assets WHERE slug = ? AND asset_id = ?';
export const UPDATE_PUBLICATION_DOCUMENT_SQL = 'UPDATE publications SET document = ? WHERE slug = ?';

const assetRowSchema = z.object({ slug: z.string(), asset_id: z.string() });
const publicationRowSchema = z.object({ slug: z.string(), revision: z.number(), document: z.string() });
const d1ResponseSchema = z.object({
  success: z.boolean().optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
  result: z.array(z.object({ results: z.array(z.record(z.string(), z.unknown())).optional() })).optional(),
});

export interface SqlStatement { sql: string; params: unknown[] }
export interface SweepPlan {
  slug: string;
  revision: number;
  keptAssetIds: string[];
  prunedAssetIds: string[];
  document: DesignDocument;
  deleteStatements: SqlStatement[];
  updateStatement: SqlStatement;
}

/** Rows removed for one publication: one statement per pruned asset id. */
export function buildDeleteStatements(slug: string, assetIds: string[]): SqlStatement[] {
  return assetIds.map(assetId => ({ sql: DELETE_PUBLICATION_ASSET_SQL, params: [slug, assetId] }));
}

/**
 * Pure planning for one publication row. Returns null when the document is already
 * schemaVersion 2 (nothing to sweep); otherwise the corrected snapshot and the statements
 * that would repair the row. Never touches the network.
 */
export function planPublicationSweep(row: { slug: string; revision: number; document: unknown }): SweepPlan | null {
  assert.equal(typeof row.slug, 'string', 'A publication slug is required.');
  const stored = documentSchema.parse(row.document);
  if (stored.schemaVersion === 2) return null;
  const corrected = documentSchema.parse(publicCreativeProjection(upgradeDocument(stored)));
  const keptAssetIds = corrected.assets.map(asset => asset.id);
  const kept = new Set(keptAssetIds);
  const prunedAssetIds = stored.assets.map(asset => asset.id).filter(id => !kept.has(id));
  return {
    slug: row.slug,
    revision: row.revision,
    keptAssetIds,
    prunedAssetIds,
    document: corrected,
    deleteStatements: buildDeleteStatements(row.slug, prunedAssetIds),
    updateStatement: { sql: UPDATE_PUBLICATION_DOCUMENT_SQL, params: [JSON.stringify(corrected), row.slug] },
  };
}

/** One operator-facing line per legacy row: mode, slug, revision, asset ids and delete count. */
export function formatSweepLine(plan: SweepPlan, rowsToDelete: number, apply: boolean) {
  return `${apply ? 'APPLY' : 'DRY-RUN'} ${plan.slug} revision ${plan.revision}: keep [${plan.keptAssetIds.join(', ')}]; prune [${plan.prunedAssetIds.join(', ')}]; publication_assets rows to delete ${rowsToDelete}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  assert.ok(token && account, 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required to sweep publications.');
  const config = z.object({ d1_databases: z.array(z.object({ binding: z.string(), database_id: z.string() })) }).parse(JSON.parse(await readFile('wrangler.jsonc', 'utf8')));
  const database = config.d1_databases.find(entry => entry.binding === 'DB')?.database_id;
  assert.ok(database, 'wrangler.jsonc must declare the DB D1 database binding.');

  const d1 = async (sql: string, params: unknown[] = []) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(30000),
    });
    const body = d1ResponseSchema.parse(await response.json());
    assert.ok(response.ok && body.success, `D1 query failed (${response.status}): ${body.errors?.map(error => error.message).join('; ') || sql}`);
    return body.result?.[0]?.results ?? [];
  };

  const registered = new Map<string, Set<string>>();
  for (const row of (await d1('SELECT slug, asset_id FROM publication_assets')).map(row => assetRowSchema.parse(row))) {
    const ids = registered.get(row.slug) ?? new Set<string>();
    ids.add(row.asset_id);
    registered.set(row.slug, ids);
  }

  const publications = await d1('SELECT slug, revision, document FROM publications ORDER BY slug');
  let v1Rows = 0;
  let v2Rows = 0;
  let assetsPruned = 0;
  let statementsApplied = 0;

  for (const publication of publications.map(row => publicationRowSchema.parse(row))) {
    const plan = planPublicationSweep({ slug: publication.slug, revision: publication.revision, document: JSON.parse(publication.document) });
    if (!plan) {
      v2Rows += 1;
      console.log(`SKIP  ${publication.slug} revision ${publication.revision}: already schemaVersion 2`);
      continue;
    }
    v1Rows += 1;
    const assetIds = registered.get(publication.slug) ?? new Set<string>();
    const rowsToDelete = plan.prunedAssetIds.filter(id => assetIds.has(id));
    assetsPruned += plan.prunedAssetIds.length;
    console.log(formatSweepLine(plan, rowsToDelete.length, apply));
    if (apply) {
      for (const statement of plan.deleteStatements) {
        await d1(statement.sql, statement.params);
        statementsApplied += 1;
      }
      await d1(plan.updateStatement.sql, plan.updateStatement.params);
      statementsApplied += 1;
    }
  }

  console.log(
    `\n${apply ? 'Applied' : 'Dry run'}: ${publications.length} publications scanned, ${v1Rows} legacy v1 rows, ` +
      `${v2Rows} v2 rows skipped, ${assetsPruned} asset ids pruned, ${statementsApplied} statements applied.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
