import type { Context } from 'hono';
import type { Env } from './types';
import type { DesignDocument, Project } from '../src/shared/schema';
import { paintHash } from '../src/shared/paint-png';
import { fail, owner } from './security';

export async function creativeSaveIdentity(document: DesignDocument, expectedRevision: number, operationId?: string, expectedBriefRevision?: number) {
  if (!operationId && (document.schemaVersion !== 2 || !document.paintings.length)) return undefined;
  const hash = await paintHash(new TextEncoder().encode(JSON.stringify({ document, expectedRevision, expectedBriefRevision })));
  return { key: operationId ?? hash, hash };
}
export async function readCreativeReceipt(c: Context<Env>, projectId: string, identity: { key: string; hash: string }) {
  const receipt = await c.env.DB.prepare('SELECT payload_hash,response FROM creative_save_receipts WHERE project_id=? AND user_id=? AND operation_id=?')
    .bind(projectId, owner(c), identity.key).first<{ payload_hash: string; response: string }>();
  if (!receipt) return undefined;
  if (receipt.payload_hash !== identity.hash) fail(409, 'operation_id_conflict', 'This operation ID already committed a different payload. Read its result before starting a new operation.');
  return JSON.parse(receipt.response) as Project;
}
