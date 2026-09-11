# Connector release readiness — 2026-09-11

Target authorized: isolated `dev` → `beta.studio.agentkit.best`. Production/main is outside this delivery authorization. The existing beta workflow verifies source, applies forward migrations and deploys that same dev revision; deployment evidence must include its exact SHA and terminal CI result.

## Configuration and acceptance

Current beta secret-name inspection found ENCRYPTION_KEY only. Keep it unchanged. Native GitHub/Google app settings are documented in [deployment](../../../docs/deployment.md); no secret values belong in source, test traces or reports. A selected GitHub test repository, selected Drive folder, OAuth registrations and authorized model are still needed for live acceptance. Public anonymous MCP documentation search has passed, including the browser approval workflow; it does not substitute for the native account and model tests.

Keep CONNECTORS_ENABLED absent/false until the acceptance gates pass. Deploying disabled code makes it available for subsequent configured testing but does not mean connectors are generally usable or the plan is complete.

## Migration / rollback

Migrations 0014–0017 are additive. Local workerd/D1 migration execution preserved the existing project and verified foreign keys. Beta storage is isolated from production. Follow the owning [backup and rollback procedure](../../../docs/deployment.md#backups-and-rollback) before remote persistence changes; preserve the encryption key and current deployment identity.

To contain execution, disable the server feature flag and redeploy a compatible revision only within authorized scope. Retain additive tables, pending/unknown operation records, snapshots and prepared files for their existing retention lifecycle. Code rollback cannot undo a remote PR, uploaded file, native Slides presentation or provider token; inspect recorded remote IDs and revoke provider credentials separately if required. Never delete user artifacts automatically or replay uncertain writes.

## Outstanding limits

- Real GitHub/Google/model acceptance is blocked on designated configuration and authorization.
- Request and operation budgets are bounded. A partially completed GitHub export or native Slides creation remains visible as uncertain with IDs; no automatic retry claims.
- Remote Workers PDF CPU envelope has not been measured. Local workerd functionality and bundle success are narrower evidence.
- Eight high dependency audit findings were reported during installation; no audit-clean claim or unrelated forced upgrade.

## Verified beta deployment

Code `e1c57dd68f0398f69240cabb622f1e2f92c8a353` passed [CI 34572237146](https://github.com/bestagentkits/design-studio-ai/actions/runs/34572237146) and deployed on 2026-09-11 at 07:03 UTC. Cloudflare lists 100% active version `fec10669-bfa1-46eb-a63f-c8d6a5665fca` with that exact SHA as its message. Migrations 0014–0017 each completed successfully on isolated beta D1. A private local D1 export was taken before migration (48,235 bytes, mode 0600); it was not committed or uploaded as a report.

Post-deployment checks passed health, beta OAuth resource discovery and current `/api/openapi` GitHub/binding-edit contracts. `/api/config` confirms connectorsEnabled=false. Production was untouched. This is deployed disabled code, not a completed live connector rollout.
