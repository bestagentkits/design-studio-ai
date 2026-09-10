---
title: "Phase 3: Chuẩn bị assets và rig editor"
status: todo
---

# Phase 3: Chuẩn bị assets và rig editor

## Overview

Priority: P1. Status: pending. Depends on: Phase 2.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [src/app/editor.tsx](../../src/app/editor.tsx)
- [src/app/layer-tree.tsx](../../src/app/layer-tree.tsx)
- [src/app/inspector.tsx](../../src/app/inspector.tsx)
- [src/app/canvas-gestures.ts](../../src/app/canvas-gestures.ts)
- [src/app/keyboard-navigation.ts](../../src/app/keyboard-navigation.ts)
- [src/app/api.ts](../../src/app/api.ts)
- [server/projects.ts](../../server/projects.ts)
- [tests/editor-ergonomics.spec.ts](../../tests/editor-ergonomics.spec.ts)

## Requirements

- Import PNG nhiều lớp, xếp vị trí theo manifest nếu có, sửa pivot và bind pose; replace ảnh giữ identity của attachment.
- Thêm/reparent/rename/delete bones có kiểm tra references; slots/region attachments và tree selection.
- Setup/Animate rõ ràng; zoom/pan/select/pose, pointer capture/cancel, touch và keyboard; một gesture = một undo step.

## Files and ownership

Modify: `src/app/editor.tsx`, `layer-tree.tsx`, `inspector.tsx`, `canvas-gestures.ts`, `server/projects.ts`; integrate character renderer vào `document-view.tsx` và static render adapter.

Create: `src/app/character-editor.tsx`, `character-rig-tools.tsx`, `character-asset-import.tsx`, `character-editor.css`; `tests/character-rig-ui.spec.ts`, `tests/character-assets.test.ts`.

Delete: none. Các file Create là dự kiến, chưa tồn tại tại baseline. Một owner tích hợp sửa các shared files; không chạy parallel writers trên cùng file.

## Implementation checklist

- [ ] Thêm lối vào Character Motion từ project motion và thao tác insert vào web/slide; không đổi project kind của bản đã lưu.
- [ ] Chuẩn bị màn hình import có preview ảnh, offset, kích thước, pivot; ảnh crop không có tọa độ phải hiển thị cần sắp lại. Giữ PNG + manifest là luồng baseline; PSD là adapter chưa chốt.
- [ ] Gắn ảnh bằng owned asset ID; validate signature/size trên server. Xử lý upload thành công nhưng apply thất bại bằng retry có ownership; không xóa asset đang dùng.
- [ ] Tạo rig bằng canvas hoặc numeric form; reparent giữ world pose khi chọn tùy chọn tương ứng; báo hậu quả delete bone/slot trước operation.
- [ ] Thêm mode indicator và auto-key off mặc định; animation pose không chảy ngược vào setup pose. Dùng operation transaction cho undo/redo và conflict recovery.
- [ ] Clone/import project remap đầy đủ rig/clip/instance/asset IDs; publish snapshot resolver dùng asset table đúng scope.
- [ ] Expose cùng rig operations cho các agent surfaces và hướng dẫn cơ bản ngay trong thay đổi.

## Validation

`npm run typecheck`; `npx tsx --test tests/character-assets.test.ts tests/character-contract.test.ts tests/collaboration.test.ts`; `npm run build`; `npm run test:e2e -- tests/character-rig-ui.spec.ts --project=desktop`; chạy lại với `--project=mobile`.

Commands cho tests mới chỉ chạy sau khi tạo test files; đây là kế hoạch, chưa phải kết quả kiểm thử. Contract mới phải có UI/REST/MCP/CLI/WebMCP/discovery/docs parity trong cùng phase, theo [test matrix](test-matrix.md).

## Acceptance

Người dùng tạo rig từ ảnh thực, pose/undo/save/reload; clone vẫn hiển thị sau khi xóa project nguồn trong DB test. Tenant khác không đọc được ảnh, public snapshot không đòi private auth. Touch/numeric alternative hoàn thành được luồng rig.

## Risks, security and rollback

Reimport kích thước ảnh có thể đổi silhouette/UV; hiển thị preview và quyết định giữ coordinate mapping. Không làm mới mọi attachment chỉ vì tên file trùng.

Giữ owner/asset isolation, explicit brief approval và expected revision. Không ghi credentials vào document/log/artifact; không dùng dữ liệu tài khoản thực cho test.
