import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedConnectorJson, connectorPrincipalSchema } from '../src/shared/connector-values';
import { connectionCreateSchema, connectionMetadataSchema, connectorToolSchema, connectorSelectionSchema, sourceSnapshotSchema } from '../src/shared/connectors';
import { canTransitionConnectorOperation, connectorOperationPrepareSchema, connectorOperationSchema } from '../src/shared/connector-operations';
import { agentRunAdvanceSchema, agentRunSchema, agentRunStartSchema } from '../src/shared/agent-runs';

const timestamp = '2026-09-10T12:00:00.000Z';
const fingerprint = 'a'.repeat(64);
const pins = { connectionRevision: 1, credentialVersion: 1, policyRevision: 1, documentRevision: 4, briefRevision: 2, sourceSnapshotIds: ['source-1'] };
const principal = { kind: 'api', userId: 'owner', tokenId: 'token-1' };
const operation = {
  id: 'op-1', projectId: 'project-1', connectionId: 'connection-1', principal, revision: 1,
  status: 'pending', action: 'write', effect: 'write', argumentsHash: fingerprint,
  actionFingerprint: fingerprint, destinationHash: fingerprint, versions: pins, approvalId: null,
  leaseId: null, leaseExpiresAt: null, remoteIds: [], createdAt: timestamp, updatedAt: timestamp,
};

test('connection metadata rejects secret fields and unsafe endpoint syntax', () => {
  const config = { adapter: 'mcp', authMode: 'anonymous', endpoint: 'https://example.com/mcp' };
  const create = { displayName: 'My tools', config };
  assert.ok(connectionCreateSchema.safeParse(create).success);
  assert.ok(connectionCreateSchema.safeParse({ ...create, config: { ...config, endpoint: 'https://example.com/mcp?tenant=one' } }).success);
  for (const endpoint of ['not a URL', '', 'http://example.com/mcp', 'https://user:pass@example.com', 'https://example.com/?token=secret', 'https://example.com/#token', 'https://example.com/#', 'https://example.com/?code_verifier=private', 'https://example.com/?jwt=private'])
    assert.equal(connectionCreateSchema.safeParse({ ...create, config: { ...config, endpoint } }).success, false);
  assert.equal(connectionCreateSchema.safeParse({ ...create, accessToken: 'never serialize' }).success, false);
  const metadata = { ...create, id: 'c-1', revision: 1, status: 'connected', remoteIdentity: null, scopes: [], capabilityFingerprint: fingerprint, updatedAt: timestamp };
  assert.ok(connectionMetadataSchema.safeParse(metadata).success);
  assert.equal(connectionMetadataSchema.safeParse({ ...metadata, config: { ...config, authMode: 'oauth' } }).success, true);
  assert.equal(connectionMetadataSchema.safeParse({ ...metadata, config: { adapter: 'github', authMode: 'oauth' } }).success, false);
  assert.equal(connectionMetadataSchema.safeParse({ ...metadata, encryptedCredential: 'private' }).success, false);
});

test('agent identities require exact token or OAuth family rather than owner alone', () => {
  assert.ok(connectorPrincipalSchema.safeParse(principal).success);
  assert.equal(connectorPrincipalSchema.safeParse({ kind: 'api', userId: 'owner' }).success, false);
  assert.equal(connectorPrincipalSchema.safeParse({ kind: 'oauth', userId: 'owner', clientId: 'client' }).success, false);
  assert.ok(connectorPrincipalSchema.safeParse({ kind: 'oauth', userId: 'owner', clientId: 'client', familyId: 'family' }).success);
  assert.equal(connectorPrincipalSchema.safeParse({ ...principal, approved: true }).success, false);
});

test('JSON budgets count UTF-8 bytes and reject cycles, deep input and non-JSON objects', () => {
  const schema = boundedConnectorJson(10);
  assert.ok(schema.safeParse('abc').success);
  assert.equal(schema.safeParse('😀😀😀').success, false);
  for (const input of [undefined, NaN, Infinity, new Date(), { x: undefined }, { constructor: 'pollution' }])
    assert.equal(schema.safeParse(input).success, false);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.equal(schema.safeParse(cyclic).success, false);
  let deep: unknown = null;
  for (let i = 0; i < 40; i++) deep = [deep];
  assert.equal(boundedConnectorJson(1000).safeParse(deep).success, false);
});

test('tool schemas reject remote references including indirect base-URI resolution', () => {
  const tool = { connectionId: 'c-1', remoteName: 'read', description: '', fingerprint, effect: 'unknown', inputSchema: { type: 'object', properties: { item: { $ref: '#/$defs/item' } }, $defs: { item: { type: 'string' } } } };
  assert.ok(connectorToolSchema.safeParse(tool).success);
  for (const key of ['$ref', '$dynamicRef', '$recursiveRef', '$id'])
    assert.equal(connectorToolSchema.safeParse({ ...tool, inputSchema: { [key]: 'https://internal.example/schema' } }).success, false);
  assert.equal(connectorToolSchema.safeParse({ ...tool, inputSchema: { description: 'x'.repeat(65536) } }).success, false);
});

test('GitHub sources require commit pin and relative non-traversing paths', () => {
  const selection = { adapter: 'github', repositoryId: '123', commit: 'b'.repeat(40), paths: ['src/index.ts'] };
  assert.ok(connectorSelectionSchema.safeParse(selection).success);
  assert.equal(connectorSelectionSchema.safeParse({ ...selection, commit: 'main' }).success, false);
  for (const path of ['../secret', '/absolute', 'a/../secret', 'a\\secret', './file'])
    assert.equal(connectorSelectionSchema.safeParse({ ...selection, paths: [path] }).success, false);
});

test('immutable source metadata carries provenance without private object storage addresses', () => {
  const source = { id: 's-1', projectId: 'p-1', bindingId: 'b-1', adapter: 'mcp', remoteIdentity: 'resource://readme', remoteVersion: '1', contentHash: fingerprint, mimeType: 'text/plain', bytes: 20, extractionVersion: 'text-v1', fetchedAt: timestamp, status: 'available' };
  assert.ok(sourceSnapshotSchema.safeParse(source).success);
  assert.equal(sourceSnapshotSchema.safeParse({ ...source, objectKey: 'private/object' }).success, false);
  assert.equal(sourceSnapshotSchema.safeParse({ ...source, contentHash: '' }).success, false);
});

test('preparation rejects self-approval and requires independently pinned revisions', () => {
  const prepare = { bindingId: 'b-1', action: 'write', arguments: { name: 'file' }, idempotencyKey: '1234567890abcdef', expectedVersions: pins };
  assert.ok(connectorOperationPrepareSchema.safeParse(prepare).success);
  assert.equal(connectorOperationPrepareSchema.safeParse({ ...prepare, approved: true }).success, false);
  assert.equal(connectorOperationPrepareSchema.safeParse({ ...prepare, expectedVersions: { ...pins, briefRevision: -1 } }).success, false);
});

test('operation lifecycle prevents blind replay of uncertain external effects', () => {
  assert.ok(connectorOperationSchema.safeParse(operation).success);
  const running = { ...operation, status: 'running', leaseId: 'lease-1', leaseExpiresAt: timestamp };
  assert.equal(connectorOperationSchema.safeParse(running).success, false);
  assert.ok(connectorOperationSchema.safeParse({ ...running, approvalId: 'approval-1' }).success);
  assert.equal(connectorOperationSchema.safeParse({ ...operation, leaseId: 'lease-1' }).success, false);
  assert.equal(canTransitionConnectorOperation('outcome_unknown', 'running'), false);
  assert.equal(canTransitionConnectorOperation('running', 'cancelled'), false);
  assert.equal(canTransitionConnectorOperation('succeeded', 'pending'), false);
  assert.ok(canTransitionConnectorOperation('running', 'outcome_unknown'));
  assert.ok(canTransitionConnectorOperation('outcome_unknown', 'succeeded'));
});

test('run continuation cannot approve tools; paused and completed runs need durable references', () => {
  assert.equal(agentRunAdvanceSchema.safeParse({ expectedRevision: 1, approved: true }).success, false);
  const run = { id: 'r-1', projectId: 'p-1', principal, revision: 1, status: 'ready_to_continue', provider: 'openai', model: 'model', pins: [{ bindingId: 'b-1', versions: pins }], modelTurns: 0, toolCalls: 0, activeMs: 0, pendingOperationId: null, proposalId: null, leaseId: null, leaseExpiresAt: null, createdAt: timestamp, updatedAt: timestamp };
  assert.ok(agentRunSchema.safeParse(run).success);
  const start = { prompt: 'Use the selected sources', provider: 'openai', bindingIds: ['b-1'], sourceSnapshotIds: [], expectedDocumentRevision: 1, expectedBriefRevision: 1, idempotencyKey: '1234567890abcdef' };
  for (const provider of ['deepseek', 'custom-private-model']) {
    assert.ok(agentRunStartSchema.safeParse({ ...start, provider }).success);
    assert.ok(agentRunSchema.safeParse({ ...run, provider }).success);
  }
  for (const provider of ['fal', 'leonardo', 'grok', 'custom-', 'unknown']) {
    assert.equal(agentRunStartSchema.safeParse({ ...start, provider }).success, false);
    assert.equal(agentRunSchema.safeParse({ ...run, provider }).success, false);
  }
  assert.equal(agentRunSchema.safeParse({ ...run, status: 'awaiting_approval' }).success, false);
  assert.equal(agentRunSchema.safeParse({ ...run, status: 'succeeded' }).success, false);
  assert.equal(agentRunSchema.safeParse({ ...run, toolCalls: 13 }).success, false);
  assert.ok(agentRunSchema.safeParse({ ...run, status: 'awaiting_approval', pendingOperationId: 'op-1' }).success);
});
