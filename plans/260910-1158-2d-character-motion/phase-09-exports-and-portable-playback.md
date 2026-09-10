---
title: "Phase 9: Export và portable playback"
status: todo
---

# Phase 9: Export và portable playback

## Overview

Priority: P1. Status: pending. Depends on: Phase 7 cho runtime, Phase 8 cho discovery/proposal integration cuối.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [server/exports.ts](../../server/exports.ts)
- [server/export-node.ts](../../server/export-node.ts)
- [scripts/export-renderer.ts](../../scripts/export-renderer.ts)
- [scripts/published-viewer.ts](../../scripts/published-viewer.ts)
- [scripts/build-renderer.mjs](../../scripts/build-renderer.mjs)
- [src/app/export-page.ts](../../src/app/export-page.ts)
- [src/app/file-formats.ts](../../src/app/file-formats.ts)
- [src/shared/react-export.ts](../../src/shared/react-export.ts)
- [src/shared/render.ts](../../src/shared/render.ts)
- [server/google-slides.ts](../../server/google-slides.ts)
- [packages/cli/src/dsa.ts](../../packages/cli/src/dsa.ts)

## Requirements

- Native package chứa canonical character/clip data + assets + manifest; import package giữ ID remap và ownership; không gọi là Spine-compatible.
- PNG sequence và spritesheet ZIP có alpha, frame/timing/trim/pivot metadata; HTML/React giữ interactive playback.
- Cloud WebM/MP4 (nếu encoder hỗ trợ), mixed 2D/text/media/3D ordering và audio composition; không thay cap 60 giây hiện hành.

## Files and ownership

Modify: Các export owners trên; shared format schemas và CLI/MCP/WebMCP/public reference; build source/dependency allowlist cho exported React runtime.

Create: `src/shared/character-package.ts`, `src/shared/motion-frame-sequence.ts`; `tests/character-package.test.ts`, `tests/motion-export.test.ts`, `tests/motion-export-ui.spec.ts`.

Delete: none. Các file Create là dự kiến; check repository trước khi thêm. Một owner sửa các shared files mỗi lần.

## Implementation checklist

- [ ] Unify render adapters vào shared frame evaluation cho editor/publish/export; embed owned assets và chặn network fetch không được phép trong export browser.
- [ ] Làm package importer/exporter có signature/path normalization, zip-bomb/file-count/decoded bytes limits, duplicate path handling; resolve all skins/sequence/linked-mesh assets và import qua server ownership flow.
- [ ] Render frame sequence tại t=frame/fps theo count đã chốt (không duplicate loop end frame); atlas metadata khôi phục original canvas/pivot/trim. Kiểm pixels alpha ở rìa mesh.
- [ ] Export HTML/React có player assets/modules thực; cập nhật scripts/build-renderer.mjs dependency allowlist. Giải nén React ZIP, install/build/run offline assets để kiểm không thiếu import runtime.
- [ ] Giữ video encode transport hiện có khi đạt tests; nếu capture wall-clock drop frames thì bổ sung bounded offline encoding hoặc lỗi rõ, không ghi nhãn frame-perfect chỉ vì evaluator deterministic.
- [ ] Xác định static sample time/poster policy; PNG/PDF/PPTX/SVG complex mesh phải rasterize rõ. Google Slides dùng path authorized image hoặc unsupported error; GLB/glTF không silently bỏ character.
- [ ] Native player đóng gói typed controls/events. Nhánh engine/Spine chỉ triển khai khi chốt mục tiêu/version/license; trước đó báo capability unsupported cụ thể.
- [ ] Cập nhật mọi export format enum/service/client/docs trong một thay đổi, đọc schema để tránh danh sách format riêng rẽ.

## Validation

`node scripts/build-renderer.mjs`; `npm run build:cli`; `npm run typecheck`; `npx tsx --test tests/character-package.test.ts tests/motion-export.test.ts tests/exports-agent-formats.test.ts tests/structured-export.test.ts tests/published-viewer.test.ts tests/cli.test.ts`; `npm run build`; `npm run test:e2e -- tests/motion-export-ui.spec.ts --project=desktop` và `--project=mobile`.

Tests mới chỉ chạy sau khi được tạo. Public capability, validation và documentation phải đồng bộ trong phase, không chờ đợt cuối.

## Acceptance

Mở package ở project mới; đổi skin vẫn đủ assets sau khi source project bị xóa trong test DB. PNG sequence/frame metadata, decoded video timestamps/audio, HTML offline và built React ZIP được kiểm tra thực. Unsupported encoder/format trả lỗi có thể phục hồi.

## Risks, security and rollback

Filename/HTTP200 không chứng minh export đúng. Browser recording fallback vẫn silent nếu chưa có audio support; thiếu capability phải hiện rõ. Không tải hoặc publish private assets ra URL công khai chỉ để export thành công.

## Execution record (2026-09-10)

Native implementation is present. See [contract decisions](reports/contract-decisions.md) for final technical choices and [implementation review](reports/implementation-review.md) for executed checks and explicit limitations. Original checklists above are the planning audit trail; measured performance targets and live-provider acceptance are not claimed complete.
