---
title: "Phase 6: Constraints, physics và pose controls"
status: todo
---

# Phase 6: Constraints, physics và pose controls

## Overview

Priority: P1. Status: pending. Depends on: Phase 5.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [src/shared/scene-runtime.ts](../../src/shared/scene-runtime.ts)
- [src/shared/easing.ts](../../src/shared/easing.ts)
- [src/shared/design-checks.ts](../../src/shared/design-checks.ts)
- [src/app/inspector.tsx](../../src/app/inspector.tsx)

## Requirements

- IK 1–2 bone với bend direction/mix/stretch, FK posing và tùy chọn multi-bone pose tool; target unreachable có giới hạn hữu hạn.
- Transform constraints có offset/mix/local-world mapping; Bézier path constraints và animatable path; squash/stretch giữ thể tích theo tham số.
- Secondary motion có stiffness/damping/mass/gravity/wind; slider điều khiển pose clip/biểu cảm; constraint graph có thứ tự xác định.

## Files and ownership

Modify: Character schema/runtime/editor và operations đã tạo; integrate diagnostics vào design checks. Giữ nguyên solver/rig 3D hiện tại.

Create: `src/shared/character-constraints.ts`, `character-physics.ts`, `character-pose-controls.ts`, `src/app/character-constraint-editor.tsx`; `tests/character-constraints.test.ts`, `tests/character-physics.test.ts`, `tests/character-constraints-ui.spec.ts`.

Delete: none. Các file Create là dự kiến; check repository trước khi thêm. Một owner sửa các shared files mỗi lần.

## Implementation checklist

- [ ] Compile dependencies để controls và constraints được evaluate đúng thứ tự; reject cycles và unsupported references. Chốt xử lý nonuniform/negative scale và singular parent transform.
- [ ] Implement IK/transform/path solvers có bounded iteration; target trùng gốc, bone zero-length, path degenerate không được sinh NaN hoặc loop vô hạn.
- [ ] Expose control handles trên canvas và numeric alternatives; animate mix/target/slider parameters qua shared channels.
- [ ] Implement pose sliders sample clip ở giá trị control; cấm recursive clip↔slider references; pose clip không phát side-effect events.
- [ ] Implement physics fixed-step, seed, setup reset/checkpoint; seek từ trạng thái bất kỳ cho cùng kết quả như replay từ zero. Reset cache khi revision, skin geometry hoặc parameters đổi.
- [ ] Thêm bake constraints/physics thành sampled keys với preview, nguyên tử và undo; lưu provenance cơ bản nhưng không tham chiếu plan IDs trong code.
- [ ] Thêm diagnostics chọn bone/constraint lỗi; expose inspect/sample/bake operations cho agent. Trường vượt limits trả structured error thay vì silently clamp.

## Validation

`npm run typecheck`; `npx tsx --test tests/character-constraints.test.ts tests/character-physics.test.ts`; `npm run build`; `npm run test:e2e -- tests/character-constraints-ui.spec.ts --project=desktop` và `--project=mobile`.

Tests mới chỉ chạy sau khi được tạo. Public capability, validation và documentation phải đồng bộ trong phase, không chờ đợt cuối.

## Acceptance

Kéo tay giải đúng IK; tóc/đuôi physics chuyển động thực; slider phối biểu cảm; random seeks khớp replay trong tolerance. Constraint cycle/degenerate data fail hữu ích; source setup pose không bị đổi khi playback.

## Risks, security and rollback

Physics có state; không tuyên bố evaluator thuần time nếu chưa replay/reset đúng. Baking có budget samples; không bake vô hạn để né solver lỗi.
