---
title: "Phase 4: Clip, dopesheet và graph editor"
status: todo
---

# Phase 4: Clip, dopesheet và graph editor

## Overview

Priority: P1. Status: pending. Depends on: Phase 3.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [src/app/timeline-editor.tsx](../../src/app/timeline-editor.tsx)
- [src/shared/easing.ts](../../src/shared/easing.ts)
- [src/shared/render.ts](../../src/shared/render.ts)
- [src/shared/operations.ts](../../src/shared/operations.ts)
- [src/app/editor.tsx](../../src/app/editor.tsx)
- [tests/advanced-editor-ui.spec.ts](../../tests/advanced-editor-ui.spec.ts)

## Requirements

- Clip CRUD/duplicate/loop/source duration, property channels độc lập; graph editor kéo Bézier handles và nhập số.
- Dopesheet chọn/box-select/copy/paste/move/retime, frame snapping, lock/mute; ghost poses và motion paths.
- Curve editing áp dụng được cho nhân vật và motion thuộc tính chung trong document v2; legacy v1 vẫn giữ hành vi cũ.

## Files and ownership

Modify: `src/app/timeline-editor.tsx`, `editor.tsx`, `src/shared/easing.ts`; mở rộng typed clip channels/operations của Phase 2 và thêm v2 property-channel adapter cho motion layer hiện có.

Create: `src/app/motion-graph-editor.tsx`, `motion-clip-library.tsx`, `motion-key-selection.ts`, `src/shared/motion-channels.ts`; `tests/motion-channels.test.ts`, `tests/motion-editor-ui.spec.ts`.

Delete: none. Các file Create là dự kiến, chưa tồn tại tại baseline. Một owner tích hợp sửa các shared files; không chạy parallel writers trên cùng file.

## Implementation checklist

- [ ] Tách clip local time khỏi scene time; khi edit clip hiển thị đúng rig và scrubber, không đổi placement start của video.
- [ ] Định nghĩa easing nằm trên outgoing segment riêng mỗi property; khóa quy tắc tangents, step/discrete, sparse channels, angle wrap/multiple turns và exact loop endpoint.
- [ ] Thêm adapter bảo toàn legacy bundled keys; hành động dùng per-channel curves nâng document qua version guard, không lặng lẽ sửa cách phát v1.
- [ ] Triển khai chọn keys, collision policy và atomic retime; báo collision/duration overflow, không overwrite ngầm. Group copy/paste giữ offsets và curves.
- [ ] Implement auto-key indicator, pose preview/apply, undo transaction và drag cancel; thao tác numeric đồng nghĩa pointer.
- [ ] Ghosting/motion paths lấy sample evaluator có budget/cache; timeline rows virtualize nếu benchmark cần. Giữ IME/text focus khỏi bị shortcut xóa key.
- [ ] Thêm schema discovery, docs/UI hints và tests cho parity key-edit operations.

## Validation

`npm run typecheck`; `npx tsx --test tests/motion-channels.test.ts tests/structured-design.test.ts`; `npm run build`; `npm run test:e2e -- tests/motion-editor-ui.spec.ts --project=desktop` và `--project=mobile`.

Commands cho tests mới chỉ chạy sau khi tạo test files; đây là kế hoạch, chưa phải kết quả kiểm thử. Contract mới phải có UI/REST/MCP/CLI/WebMCP/discovery/docs parity trong cùng phase, theo [test matrix](test-matrix.md).

## Acceptance

Hai thuộc tính cùng timestamp có curves khác nhau; retime nhiều key không mất dữ liệu; auto-key/undo và reload chính xác; clip loop kiểm tra endpoint. V1 motion tests vẫn pass.

## Risks, security and rollback

Không reuse Selection chỉ dựa timestamp khi keys đã có ID. Ghost sampling không bắn events hoặc mutate physics state đang phát.

Giữ owner/asset isolation, explicit brief approval và expected revision. Không ghi credentials vào document/log/artifact; không dùng dữ liệu tài khoản thực cho test.

## Execution record (2026-09-10)

Native implementation is present. See [contract decisions](reports/contract-decisions.md) for final technical choices and [implementation review](reports/implementation-review.md) for executed checks and explicit limitations. Original checklists above are the planning audit trail; measured performance targets and live-provider acceptance are not claimed complete.
