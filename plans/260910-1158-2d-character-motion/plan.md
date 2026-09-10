---
title: "2D Character Motion — implementation plan"
description: "Rig và diễn hoạt nhân vật 2D dùng chung cho người, AI agent, scene và export."
status: in-progress
priority: P1
effort: "Ước lượng sau spike Phase 1; chưa cam kết lịch"
tags: [feature, frontend, api, animation]
blockedBy: []
blocks: []
created: 2026-09-10
---

# 2D Character Motion

## Overview

Nâng motion thành workspace tạo nhân vật 2D: import ảnh, rig, slots/skins, mesh/weights, clip/keyframe/graph, IK/path/transform constraints, physics, pose sliders, blending, AI đề xuất chỉnh sửa và xuất bản thực tế.

Implementation authorized, including PR and merge into main. Execution baseline: `ee7ab1b8e8b5cb1152139afd0d618ec9520a560e`; branch `codex/2d-character-motion`. Application changes and verification are in progress.

Giả định để lập kế hoạch: ưu tiên mascot cho video/web/slide; chuẩn bị native portable player. Game-engine integration, nhập/xuất Spine và PSD là nhánh cần xác nhận, không được tự nhận là đã hỗ trợ hoặc tự bỏ nếu người dùng chọn. Xem [thiết kế và quyết định](architecture.md).

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Tạo một nhân vật, nhiều clip/skin, dùng lại trên nhiều scene | P1 |
| 2 | Người dùng và agent sửa cùng dữ liệu có validation/revision | P1 |
| 3 | Preview, publish và export thống nhất chuyển động | P1 |
| 4 | Giữ project v1, 3D, ownership và brief approval hoạt động | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Chốt contract và runtime spike](phase-01-start.md) | Implemented; acceptance in progress |
| 2 | [Document, compatibility và runtime](phase-02-document-contracts-and-runtime.md) | Implemented; acceptance in progress |
| 3 | [Assets và rig editor](phase-03-character-assets-and-rig-editor.md) | Implemented; acceptance in progress |
| 4 | [Clip, dopesheet và graph editor](phase-04-animation-clips-and-graph-editor.md) | Implemented; acceptance in progress |
| 5 | [Mesh, skins và deformation](phase-05-meshes-skins-and-deformation.md) | Implemented; acceptance in progress |
| 6 | [Constraints, physics và pose controls](phase-06-constraints-physics-and-pose-controls.md) | Implemented; acceptance in progress |
| 7 | [Blending và scene composition](phase-07-clip-mixing-and-scene-composition.md) | Implemented; acceptance in progress |
| 8 | [AI motion và agent workflows](phase-08-ai-motion-and-agent-workflows.md) | Implemented; acceptance in progress |
| 9 | [Export và portable playback](phase-09-exports-and-portable-playback.md) | Implemented; acceptance in progress |
| 10 | [Acceptance, docs và rollout handoff](phase-10-acceptance-documentation-and-rollout.md) | Implemented; acceptance in progress |

## Dependencies and ownership

Thực hiện tuần tự 1→2→3→4→5→6→7→8→9→10. Mỗi phase là một đơn vị tích hợp, có tests và docs của contract mới ngay trong phase; Phase 10 kiểm tra tổng thể. Không chờ Phase 8 mới làm API, hoặc Phase 10 mới cập nhật docs.

Người tích hợp sở hữu `schema`, `operations`, `editor`, renderer, server routes và public contract. Chỉ một người sửa các điểm chung mỗi lần. Module mới trong phase có ranh giới riêng; không ép tách module chỉ theo số dòng. Không tạo agent/task mới từ plan này nếu chưa có yêu cầu.

## Success Criteria

- [ ] Import ảnh → rig → `idle/walk/wave` → đổi skin → lưu/mở lại không mất dữ liệu.
- [ ] Graph riêng từng thuộc tính, IK, mesh/weights, clipping, physics và slider hoạt động, undo được.
- [ ] Hai instance dùng chung rig nhưng playback độc lập; phối walk + wave và đặt clip trong video.
- [ ] AI trả proposal có preview/diff; stale revision hoặc brief hết approval không ghi đè.
- [ ] REST/MCP/CLI/WebMCP truy cập cùng operations; assets/clone/publish không vượt ownership.
- [ ] Native package, HTML/React, PNG sequence/spritesheet và video được kiểm tra nội dung thực tế.
- [ ] Preview/export, tương thích v1, browser matrix và performance đạt [test matrix](test-matrix.md).

## Review and handoff

[Evidence và self-review](reports/planning-review.md) ghi baseline, rủi ro, validation; không phải independent multi-agent audit. Implementation evidence is being collected in reports. Checklist trong các phase là nguồn trạng thái; không có task tracker riêng được tạo.

Execution was authorized on 2026-09-10. Các lựa chọn kỹ thuật trong plan là đề xuất, không phải business decision đã được người dùng xác nhận. Nhánh game/Spine cần quyết định trước khi làm adapter; không chặn lập kế hoạch phần native.

<!-- slug: 2d-character-motion -->
