---
title: "Phase 7: Clip mixing và scene composition"
status: todo
---

# Phase 7: Clip mixing và scene composition

## Overview

Priority: P1. Status: pending. Depends on: Phase 6.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [src/app/editor.tsx](../../src/app/editor.tsx)
- [src/app/timeline-editor.tsx](../../src/app/timeline-editor.tsx)
- [src/app/slide-player.tsx](../../src/app/slide-player.tsx)
- [src/app/document-view.tsx](../../src/app/document-view.tsx)
- [scripts/published-viewer.ts](../../scripts/published-viewer.ts)

## Requirements

- Place clip trên timeline scene với trim, start offset, speed, repeat, overlap; clip local time không lẫn scene time.
- Crossfade, override/additive blending, bone subtree masks và priority; nhiều instance dùng cùng rig/clip có state độc lập.
- Native interactive playback API có play/pause/seek/setSkin/setControl và typed events; trigger click/hover để chuyển clip trong website, không cần game engine.

## Files and ownership

Modify: Editor/timeline/document-view/slide-player/published-viewer; shared composition schema và evaluator; character clip library của Phase 4.

Create: `src/shared/motion-composition.ts`, `src/shared/character-playback.ts`, `src/app/motion-composition-editor.tsx`; `tests/motion-composition.test.ts`, `tests/motion-composition-ui.spec.ts`.

Delete: none. Các file Create là dự kiến; check repository trước khi thêm. Một owner sửa các shared files mỗi lần.

## Implementation checklist

- [ ] Định nghĩa composition placements theo instance ID và clip ID; reject source range sai, speed zero/không hỗ trợ, timing overflow. Dùng root instance transform cho di chuyển trên scene để tránh nhân đôi root motion.
- [ ] Chốt setup fallback, missing channels, angle wrap, normalized weights, additive reference pose và mask precedence; sample/mix xong mới solve constraint schedule.
- [ ] Làm Compose UI với clip blocks, trim/retime/loop; thao tác cancel/undo và numeric equivalents. Chọn block mở đúng clip nhưng không đổi composition.
- [ ] Tách runtime state từng instance; caches rig read-only dùng chung, physics/events state không dùng chung.
- [ ] Implement event interval semantics: forward playback mỗi crossing phát đúng một lần; loop có cycle index; seek/preview không phát side effects. Không dùng arbitrary JS hay URL từ event payload.
- [ ] Implement typed playback interactions với feature detection; slide đổi trang pause/resume/reset theo policy đã ghi, reduced-motion poster/manual play; không autoplay audio trái browser policy.
- [ ] Update agent operations và docs cho placements, masks, controls và event inspection.

## Validation

`npm run typecheck`; `npx tsx --test tests/motion-composition.test.ts tests/published-viewer.test.ts`; `npm run build`; `npm run test:e2e -- tests/motion-composition-ui.spec.ts --project=desktop` và `--project=mobile`.

Tests mới chỉ chạy sau khi được tạo. Public capability, validation và documentation phải đồng bộ trong phase, không chờ đợt cuối.

## Acceptance

Cùng rig có hai instance khác skin/clip/time; walk + wave phối đúng vùng xương; crossfade không snap về setup. Clip đặt giây 8 không đổi clip source; loop/events/reduced motion và slide navigation có tests.

## Risks, security and rollback

State machine cho game engine chưa nằm trong native interaction API. Không tự thêm callbacks có quyền network, write hoặc thực thi code trong published content.
