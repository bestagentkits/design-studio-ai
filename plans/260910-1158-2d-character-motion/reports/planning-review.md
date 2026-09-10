# Planning evidence và self-review

Date: 2026-09-10. Baseline: `3545d18d06215c6c4e5e188761818bba98a2e688`, detached HEAD. Scope: lập kế hoạch implementation; application code chưa thay đổi.

## Source evidence đã kiểm

| Evidence | Finding / tác động tới kế hoạch |
| --- | --- |
| [design-capabilities.ts](../../../src/shared/design-capabilities.ts), lines 25–27 | Keys gom properties, chung easing, một timeline; cần channel/clip contract rõ |
| [timeline-editor.tsx](../../../src/app/timeline-editor.tsx), lines 23–42, 91–93 | Atomic key move, collision check, cùng timestamp chung easing; cần giữ safety khi nâng graph editor |
| [schema.ts](../../../src/shared/schema.ts), lines 23–42, 54–55 | V1 literal, scene bones theo index, chưa có character entities; phải có version rollout |
| [scene-runtime.ts](../../../src/shared/scene-runtime.ts), lines 39–54, 70–84 | Skinning phục vụ model3d/group; không phải 2D cutout renderer |
| [document-merge.ts](../../../src/shared/document-merge.ts), keyed-array branch | Merge ID arrays được, geometry arrays conflict; thiết kế ID cho bones/keys |
| [projects.ts](../../../server/projects.ts), validateAssets/clone/createPublication | Asset URLs và node src đang được traverse/remap; thêm attachment asset-ID graph không được bỏ sót |
| [providers.ts](../../../server/providers.ts), generation system prompt | Hiện yêu cầu Document v1; phải đổi prompt/validation trước khi bật v2 |
| [build-renderer.mjs](../../../scripts/build-renderer.mjs), sourceFiles/dependencies | React ZIP chỉ include allowlist sources/dependencies; runtime mới phải thêm vào |
| [export-renderer.ts](../../../scripts/export-renderer.ts), record loop | Capture theo wall-clock; pose deterministic chưa chứng minh encoded frame fidelity |
| [playwright.config.ts](../../../playwright.config.ts) + [run-e2e.mjs](../../../scripts/run-e2e.mjs) | Firefox/WebKit conditional; runner default desktop/mobile, phải chọn project explicit |
| [package.json](../../../package.json) + [CI](../../../.github/workflows/ci.yml) | Node24, 2 dependency trees, CLI build trước tests, renderer build và generated docs |
| [docs navigation](../../../docs/README.md) + [web docs owner](../../../docs/web-documentation.md) | Docs nguồn thuộc app components/API reference; llms artifacts được build vào dist |

## Self-review qua bốn góc nhìn

Đây là controller self-review, không tuyên bố có independent reviewer/subagent hay user confirmation. Những sửa đổi dưới đây là bổ sung correctness/safety cho bản nháp, không đảo quyết định người dùng.

| Lens | Rủi ro tìm thấy | Xử lý trong plan |
| --- | --- | --- |
| Assumptions | Coi bones 3D hiện tại đã đủ cho 2D | Runtime spike thực + evaluator/renderer riêng, Phase 1–2 |
| Assumptions | Hiểu “giống Spine” thành phải tương thích mọi format/engine | Native scope đầy đủ; game/Spine/PSD decision branches rõ, không gắn nhãn hỗ trợ |
| Failure | Old client lưu lại v1 làm mất rig mới | Dual-reader, raw-version/write-capability checks, reject downgrade, giữ v2 reader khi rollback |
| Failure | Reorder bone hoặc topology change làm keys/weights trỏ sai | Stable IDs, topology version, atomic remap/reject, Phase 2/5 |
| Failure | Random seek dùng state physics còn sót | Fixed-step/checkpoints/reset theo revision và tests replay, Phase 6 |
| Failure | Hai instances chia sẻ physics state | Compiled rig immutable; playback state riêng, Phase 7 |
| Failure | Export frame khác preview hoặc React thiếu module | Shared samples + actual decode tests + build allowlist, Phase 9 |
| Security | Attachment skin ẩn mang asset project khác / ZIP traversal | Traverse toàn graph, canonical asset IDs, import budgets và ownership tests |
| Security | AI tự cập nhật revision/brief approval | Base revision proposal + before/after approval checks, explicit apply |
| Complexity | Đợi cuối mới làm agent parity/docs | Mỗi phase bao gồm public surfaces và docs, Phase 8 chỉ thêm AI orchestration |
| Complexity | Ép tạo game state machine khi chỉ cần mascot | Native typed playback/interaction API; engine adapter cần yêu cầu cụ thể |
| Verification | Ghi cả Firefox/WebKit đã test vì config có tên | Commands explicit, evidence pending, WebKit không đồng nghĩa iPhone thực |

## Validation decisions

- User yêu cầu lập kế hoạch, chưa chọn đầu ra game/Studio/cả hai trong câu hỏi trước. Plan dùng native Studio + portable player làm giả định và ghi nhánh chưa quyết định, không coi im lặng là approval.
- Document v2, renderer backend, budgets là đề xuất kỹ thuật; Phase 1 phải xác minh spike và propagate quyết định trước code foundation.
- Không tạo issue, PR, runtime task mới hoặc automation. Checklist plan là tracking source.
- CLI `ak` không nằm trên PATH của shell; tìm thấy binary tại `/Users/duynguyen/.local/bin/ak` và scaffold thành công qua absolute path. CLI dùng timestamp UTC trong folder slug; created date vẫn 2026-09-10.
- CLI scaffold/add-phase không tự cập nhật phase table; table trong plan được đồng bộ từ phase files sau khi scaffold. Không đánh dấu phase đã thực hiện.
- Native task hydration surface không được dùng để tạo task mới ngoài yêu cầu; plan store có thể index các phase, không thay trạng thái source.

## Whole-plan consistency sweep

Đã đọc và kiểm tra 14 Markdown files: 10 phase, index 69 lines, 71 implementation checklist items, không checkbox nào đánh dấu hoàn thành. Các phase được link đầy đủ; dependency tuyến tính không cycle; Create files được đánh dấu dự kiến. Không có relative link hỏng hoặc template placeholder sót.

- `ak plan validate <plan-dir> --json`: exit 0, `valid: true`, errors null.
- `ak plan status` / `parse`: 10 phases, 0 done, 71 tasks, progress 0%, status pending.
- Local Python link/required-section/placeholder/checkbox check: exit 0, errors empty.
- `git diff --check`: exit 0; `git status` chỉ có thư mục plan mới chưa tracked tại thời điểm kiểm tra.
- Không chạy application typecheck/tests/build/browser/provider generation vì lượt này chỉ tạo kế hoạch. Không có server/task background được khởi động.

## Remaining decisions

Game engine/Spine compatibility/PSD và thiết bị mục tiêu chưa được người dùng chốt. Chúng không chặn artifact kế hoạch; chặn việc tự triển khai các adapter tương ứng. Runtime spike là công việc implementation còn pending, không giả định đã đạt.
