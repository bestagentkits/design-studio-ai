---
title: "Phase 1: Contract, UX và runtime spike"
status: todo
---

# Phase 1: Contract, UX và runtime spike

## Overview

Priority: P1. Status: pending. Depends on: Không; đọc baseline và architecture đề xuất.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [src/shared/schema.ts](../../src/shared/schema.ts)
- [src/shared/design-capabilities.ts](../../src/shared/design-capabilities.ts)
- [src/shared/scene-runtime.ts](../../src/shared/scene-runtime.ts)
- [src/shared/render.ts](../../src/shared/render.ts)
- [src/app/document-view.tsx](../../src/app/document-view.tsx)
- [scripts/export-renderer.ts](../../scripts/export-renderer.ts)
- [scripts/run-e2e.mjs](../../scripts/run-e2e.mjs)

## Requirements

- Chốt một rig 2D có bones, region + weighted mesh, skin swap, clipping; đặt giữa layer text/image và cảnh 3D để kiểm tra thứ tự composite.
- Đo backend Three.js orthographic với cùng đầu vào thực ở Chromium, Firefox, WebKit; đánh giá Canvas2D fallback và context loss.
- Chốt UX Setup/Animate/Compose, document v2/capabilities và test budgets trước khi sửa persistent contracts; không cần ép chọn engine game để làm native.

## Files and ownership

Modify: Chỉ prototype/benchmark có thể bỏ dưới thư mục plan và báo cáo ở `reports/`; chưa đổi public schema.

Create: `reports/runtime-spike.md`, `reports/contract-decisions.md`, `reports/performance-baseline.md`; asset thử nghiệm tự tạo/có quyền sử dụng.

Delete: none. Các file Create là dự kiến, chưa tồn tại tại baseline. Một owner tích hợp sửa các shared files; không chạy parallel writers trên cùng file.

## Implementation checklist

- [ ] Refresh git HEAD/status, README, docs navigation; kiểm tra port trước khi khởi động harness. Ghi command/PID/port/worktree và dừng process sau thử nghiệm.
- [ ] Dựng spike native từ ảnh chia lớp có quyền dùng; tách evaluator khỏi renderer. Kiểm chứng UV, bind transform, negative scale, alpha edge và nested clipping.
- [ ] Đo startup/playback/seek/weights trên profile ở test matrix. Tài liệu hóa device/browser/version, warmup, scene size; không dùng số fps trung bình che p95.
- [ ] Chốt renderer backend bằng kết quả. Nếu Three.js không đáp ứng composite/clipping/performance, trình bày bằng chứng và lựa chọn backend trước khi thêm dependency; không tự chọn Spine runtime.
- [ ] Viết contract-decision record: schema fields, transform origin, curve interpolation, loop boundary, constraint order, asset manifest, version/write guard và limits; cập nhật các phase chịu ảnh hưởng.
- [ ] Ghi rõ game/Spine/PSD chưa được xác nhận. Ước lượng effort theo kết quả spike, không đưa ngày ship giả định.

## Validation

Prototype checks có thể thực hiện qua harness đã có; các browser commands và budgets xem [test matrix](test-matrix.md). Chưa có script spike ở baseline: khai báo command cụ thể trong báo cáo khi tạo, không đánh dấu kiểm chứng trước khi chạy.

Commands cho tests mới chỉ chạy sau khi tạo test files; đây là kế hoạch, chưa phải kết quả kiểm thử. Contract mới phải có UI/REST/MCP/CLI/WebMCP/discovery/docs parity trong cùng phase, theo [test matrix](test-matrix.md).

## Acceptance

Có ảnh/video thử nghiệm thực, số đo và quyết định backend; coordinate/alpha/draw order và write compatibility được xác định; mọi process đã dừng. Phase 2 chỉ bắt đầu sau khi các quyết định kỹ thuật này có evidence.

## Risks, security and rollback

Fallback poster không đạt animation parity. Nếu runtime không đạt tiêu chí, đổi phương án ở spike; không tạo dữ liệu v2 trước khi có reader/rollback strategy.

Giữ owner/asset isolation, explicit brief approval và expected revision. Không ghi credentials vào document/log/artifact; không dùng dữ liệu tài khoản thực cho test.

## Execution record (2026-09-10)

Native implementation is present. See [contract decisions](reports/contract-decisions.md) for final technical choices and [implementation review](reports/implementation-review.md) for executed checks and explicit limitations. Original checklists above are the planning audit trail; measured performance targets and live-provider acceptance are not claimed complete.
