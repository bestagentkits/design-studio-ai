---
title: "Phase 5: Mesh, skins, attachments và deformation"
status: todo
---

# Phase 5: Mesh, skins, attachments và deformation

## Overview

Priority: P1. Status: pending. Depends on: Phase 4.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [src/shared/mesh-editing.ts](../../src/shared/mesh-editing.ts)
- [scripts/geometry-worker.ts](../../scripts/geometry-worker.ts)
- [src/app/mesh-tools.tsx](../../src/app/mesh-tools.tsx)
- [src/app/document-view.tsx](../../src/app/document-view.tsx)
- [scripts/build-renderer.mjs](../../scripts/build-renderer.mjs)
- [server/projects.ts](../../server/projects.ts)

## Requirements

- Tạo/chỉnh mesh region, auto triangulation và manual vertex/edge edit, UV giữ mapping, bind/unbind, weight paint/smooth/normalize.
- Auto weights là đề xuất có preview; mỗi vertex có tối đa số influence đã chốt, normalize và orphan detection.
- Skin library và attachment swaps, linked meshes, FFD keys, draw-order animation, clipping/bounds và image sequence.

## Files and ownership

Modify: Character schema/runtime/editor từ phase trước; chỉ tái sử dụng helper phù hợp từ mesh-editing/geometry-worker, không thay semantics rig 3D.

Create: `src/shared/character-mesh.ts`, `character-skins.ts`, `src/app/character-mesh-tools.tsx`, `character-skin-editor.tsx`; `tests/character-mesh.test.ts`, `tests/character-skins.test.ts`, `tests/character-mesh-ui.spec.ts`.

Delete: none. Các file Create là dự kiến, chưa tồn tại tại baseline. Một owner tích hợp sửa các shared files; không chạy parallel writers trên cùng file.

## Implementation checklist

- [ ] Dùng worker cho triangulation/weights nặng với job ID + base revision; kết quả cũ không được apply sau khi topology/rig đã đổi.
- [ ] Validate topology, indices/UV và finite geometry; kiểm soát số vertices/influences/texture pixels; normalize weights có báo thay đổi và undo.
- [ ] Tạo mesh editor selection, numeric vertex edits, paint brush và fallback không dùng drag; visualize weights/isolated bone influence.
- [ ] Implement linked geometry với skin attachment identity; đổi trang phục giữ clips, missing slot fallback rõ ràng; kiểm tra reimport size/UV.
- [ ] FFD channels tham chiếu mesh ID và topology version; thay topology phải remap có kiểm chứng hoặc từ chối khi còn deformation keys, không reinterpret index ngầm.
- [ ] Implement discrete attachment/image-sequence keys, deterministic draw-order folders và clipping scope/stack; unsupported blend modes báo rõ.
- [ ] Asset graph traversal phải bao gồm tất cả skins, linked mesh sources và sequence frames kể cả hiện không visible. Cập nhật agent operations và docs.

## Validation

`npm run typecheck`; `npx tsx --test tests/character-mesh.test.ts tests/character-skins.test.ts tests/character-assets.test.ts`; `npm run build`; `npm run test:e2e -- tests/character-mesh-ui.spec.ts --project=desktop` và `--project=mobile`.

Commands cho tests mới chỉ chạy sau khi tạo test files; đây là kế hoạch, chưa phải kết quả kiểm thử. Contract mới phải có UI/REST/MCP/CLI/WebMCP/discovery/docs parity trong cùng phase, theo [test matrix](test-matrix.md).

## Acceptance

Một ảnh mesh uốn theo nhiều bones; thay skin và linked mesh không mất deformation; pose tại bind đúng ảnh gốc; weight sums đúng tolerance; clipping và thứ tự lớp khớp sample ở preview/export. Topology conflict có recovery không mất keys.

## Risks, security and rollback

Texture/alpha seams cần kiểm tra visual thật; không coi serialized weights là proof skinning chạy. Revert UI entry nếu lỗi nhưng giữ reader/document data và không sửa 3D exports.

Giữ owner/asset isolation, explicit brief approval và expected revision. Không ghi credentials vào document/log/artifact; không dùng dữ liệu tài khoản thực cho test.

## Execution record (2026-09-10)

Native implementation is present. See [contract decisions](reports/contract-decisions.md) for final technical choices and [implementation review](reports/implementation-review.md) for executed checks and explicit limitations. Original checklists above are the planning audit trail; measured performance targets and live-provider acceptance are not claimed complete.
