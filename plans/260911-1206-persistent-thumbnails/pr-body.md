## Tóm tắt công việc end-to-end

Lưu thumbnail PNG trên server theo revision để project cards dùng lại ảnh sau reload/restart. Khi sửa design, giữ cover cũ trong lúc render revision mới. Phát hành CLI và skill v0.3.3 cùng contract mới.

## Ủy thác subagent

Không. Triển khai, kiểm thử và review trực tiếp trong task này.

## Quyết định kỹ thuật

- Dùng chung isolated export renderer và asset bucket hiện có; không tải toàn bộ design vào trình duyệt để tạo cover.
- Lease trong SQLite/D1 chống render trùng; giữ hai revision hoàn tất gần nhất. Kiểm tra ownership trước khi trả ảnh, browser cache private.
- Đóng publication trước khi xoá project; worker đến muộn tự xoá ảnh. Kiểm thử bao gồm race này.
- REST, MCP, WebMCP, CLI và tài liệu dùng chung endpoint; lượt đầu có thể render hoặc trả 202 khi bận.

## Lệch so với plan

Không thay đổi phạm vi tính năng. Bổ sung patch release 0.3.3 để CLI tải thumbnail có sẵn trong archive được phát hành.

## Bằng chứng hoàn thành

- Typecheck, 181 tests, build app/renderer/docs, build CLI và đóng gói skill đạt.
- 8 thumbnail E2E đạt trên desktop/mobile Chromium, Firefox, WebKit.
- Real SQLite/FileBucket/Chromium: byte reuse trong tiến trình mới không có renderer, dedup, ownership, retention, cooldown và deletion race đạt. MCP và CLI trả cùng PNG.
- Review trực tiếp: đã xử lý deletion publication race; không còn phát hiện correctness cần sửa.
- CI/deploy: chờ pipeline của PR và main.
- Screenshots: `plans/260911-1206-persistent-thumbnails/projects-{desktop,mobile,firefox,webkit}.png`.
- Thay đổi chính: migration, thumbnail service, shared renderer, project cards, agent/client discovery và docs.

## Checklist

- [x] Implementation và kiểm thử local hoàn tất.
- [x] Tài liệu và client đồng bộ.
- [ ] CI, merge, production verification và release archives — thực hiện sau PR.

## Việc cần người xử lý

Không. Lần đầu mở revision chưa có cover vẫn cần render một lần; ảnh external tuân theo giới hạn cloud export hiện có.

## Issues liên quan

Không có issue đang mở phù hợp; theo yêu cầu trực tiếp của người dùng.

## Chế độ ship

- Mode: official
- Target: main
- Writing language: vi (source: ngôn ngữ yêu cầu; fallback: không có project language resolver).
