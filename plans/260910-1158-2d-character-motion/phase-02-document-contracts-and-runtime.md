---
title: "Phase 2: Document, compatibility và evaluator chung"
status: todo
---

# Phase 2: Document, compatibility và evaluator chung

## Overview

Priority: P1. Status: pending. Depends on: Phase 1.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [src/shared/schema.ts](../../src/shared/schema.ts)
- [src/shared/design-capabilities.ts](../../src/shared/design-capabilities.ts)
- [src/shared/operations.ts](../../src/shared/operations.ts)
- [src/shared/document-merge.ts](../../src/shared/document-merge.ts)
- [src/shared/render.ts](../../src/shared/render.ts)
- [server/projects.ts](../../server/projects.ts)
- [server/providers.ts](../../server/providers.ts)
- [server/mcp.ts](../../server/mcp.ts)
- [packages/cli/src/dsa.ts](../../packages/cli/src/dsa.ts)

## Requirements

- Một canonical v2 document chứa characters/clips/instances; reader dual-version và explicit upgrade; giữ v1 interpolation/easing như cũ.
- Stable IDs cho bone/slot/clip/channel/key, references và cycle checks; numeric geometry arrays là một conflict unit.
- Skeleton evaluation thuần dữ liệu và region renderer tối thiểu; validation/write gates được server thực thi trước khi bất kỳ client nào có thể tạo v2.

## Files and ownership

Modify: `src/shared/schema.ts`, `design-capabilities.ts`, `operations.ts`, `document-merge.ts`, `server/projects.ts`, `server/providers.ts`; reader/discovery integration trong CLI, MCP, browser, exports và docs theo checklist parity.

Create: `src/shared/character-schema.ts`, `character-operations.ts`, `character-runtime.ts`, `document-version.ts`; `tests/character-contract.test.ts`, `tests/character-runtime.test.ts` (đường dẫn dự kiến).

Delete: none. Các file Create là dự kiến, chưa tồn tại tại baseline. Một owner tích hợp sửa các shared files; không chạy parallel writers trên cùng file.

## Implementation checklist

- [ ] Viết tests bảo toàn v1 round-trip trước khi thay schema; thêm v2 parser với discriminator rõ ràng, không strip mất unknown motion fields.
- [ ] Thêm semantic checks: ID uniqueness/scope, bones DAG, assetId tồn tại, slot ownership, finite transforms, bounds, duration và giới hạn tổng document. Enforce cả decoded workload lẫn JSON byte limit.
- [ ] Thêm operations atomic cho rig/clip/key/instance cùng typed targets; batch validation trước save, fail không để lại nửa thay đổi.
- [ ] Chặn v2→v1 downgrade và client không khai báo khả năng ghi v2 trước parse; propagate read version/capability qua REST, MCP, WebMCP, CLI, provider proposal và export. Giữ expectedRevision/briefRevision riêng.
- [ ] Implement compiled rig + setup/world pose evaluation; cache theo revision, renderer adapter chỉ tiêu thụ draw data; sample tại thời điểm không sửa source.
- [ ] Nâng merge/clone/group/duplicate/remove traversal cho character graph. Geometry edits concurrent phải conflict; independent bone/key edits merge theo ID; undo rebase không làm mất remote edits.
- [ ] Cập nhật reader trong mọi export/viewer và provider system prompt v1 trước khi mở capability; unsupported format từ chối rõ ràng. Cập nhật schema docs/discovery trong cùng phase.

## Validation

`npm run build:cli`; `npm run typecheck`; `npx tsx --test tests/character-contract.test.ts tests/character-runtime.test.ts tests/document.test.ts tests/collaboration.test.ts tests/cli.test.ts`; shared contract gate: `npm test` và `npm run build`.

Commands cho tests mới chỉ chạy sau khi tạo test files; đây là kế hoạch, chưa phải kết quả kiểm thử. Contract mới phải có UI/REST/MCP/CLI/WebMCP/discovery/docs parity trong cùng phase, theo [test matrix](test-matrix.md).

## Acceptance

V1 fixtures giữ semantics; v2 round-trip không mất entities; obsolete client bị từ chối; atomic operations, ownership, version, stale revision, cycles và concurrent edits có tests. Region pose sample khớp editor/export adapter ở cùng time.

## Risks, security and rollback

Không rollback về reader chỉ hiểu v1 sau khi đã lưu v2. Disable new creation thay vì downgrade dữ liệu; thêm SQL migration chỉ khi cần relational state, không sửa migration cũ.

Giữ owner/asset isolation, explicit brief approval và expected revision. Không ghi credentials vào document/log/artifact; không dùng dữ liệu tài khoản thực cho test.

## Execution record (2026-09-10)

Native implementation is present. See [contract decisions](reports/contract-decisions.md) for final technical choices and [implementation review](reports/implementation-review.md) for executed checks and explicit limitations. Original checklists above are the planning audit trail; measured performance targets and live-provider acceptance are not claimed complete.
