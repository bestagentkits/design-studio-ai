# Test matrix và acceptance evidence

Status: planned; chưa có implementation tests được chạy trong lượt lập kế hoạch. Các file `character-*`/`motion-*` dưới đây là tests sẽ tạo trong phase tương ứng. Existing commands được kiểm tra từ package.json, playwright.config.ts và scripts/run-e2e.mjs.

## Fixtures và reference project

Dùng một nhân vật tự tạo hoặc có quyền phân phối: PNG nhiều lớp, hai skins, một weighted mesh, một clipping polygon, tóc/đuôi có physics, IK arm/leg, pose slider và `idle/walk/wave` clips. Đây là dữ liệu test hợp lệ cho runtime thật, không thay provider response/export bằng fixture để giả success. Không sao chép sample asset Spine khi chưa xác nhận quyền.

Thêm regression documents v1 thuộc web/slides/video/3D. Giữ các file v1 không qua migration tự động; ghi expected poses/exports trước thay đổi. Test persistence dùng temp DB/asset store và account test, không real accounts.

## Matrix

| Area | Cases cần kiểm | Pass condition |
| --- | --- | --- |
| Versions | v1 read/save/export; v2 round-trip; old client; wrong version; downgrade | Không mất fields, giữ legacy interpolation; không chấp nhận v2 write từ client không hỗ trợ |
| Identity | reorder/reparent/clone/import/delete bones, skins, clips, assets | References đúng ID; deletion conflict rõ; clone không phụ thuộc source |
| Validation | cycle, missing IDs, NaN/infinity, bad UV/indices, weights, excessive vertices/keys | Reject atomically trước mutation/render allocation |
| Curves | per-property easing; step/discrete; exact key time; loop edge; multi-turn rotation | Pose expected trong tolerance; không thay semantics v1 |
| Mesh/skins | bind identity, multi-bone deformation, linked mesh, FFD + topology change | Bind đúng ảnh gốc; invalid topology không reinterpret keys; đổi skin giữ motion |
| Constraints | IK unreachable/zero-length/flipped parent; paths degenerate; driver cycle | Finite poses hoặc typed error; không loop vô hạn |
| Physics | same seed; repeated seek; backward seek; pause/resume; config changed | Replay/checkpoint nhất quán; không dùng cache revision cũ |
| Mixing | masked walk+wave; additive/override; interrupted crossfade; two instances | Vùng mask đúng, setup fallback rõ, không share mutable playback state |
| Events | loops; speed changes; time discontinuity; seek/preview; frame drops | Mỗi crossing theo contract; không phát side effects khi chỉ sample |
| Editor | touch/keyboard/numeric drag alternative; auto-key; undo; IME; modal focus | Workflow hoàn thành ở mobile/desktop, không ghi setup pose từ preview |
| Collaboration | independent keys/bones; simultaneous same geometry; remote deletion | Merge theo ID hoặc explicit conflict; undo không mất remote edits |
| Agent parity | same operation through REST/MCP/CLI/WebMCP; local dirty state | Chung validator/revision/error codes; UI tool không tự save ngoài contract |
| Provider | missing key, invalid proposal, timeout, changed brief/revision, valid live generation | Invalid cases không ghi saved state; live success có provider evidence riêng |
| Asset isolation | other owner/project; hidden skin assets; clone source deletion; publish snapshot | Không truy cập chéo; tất cả bytes cần thiết được resolve đúng scope |
| ZIP/package | traversal, zip bomb, duplicate path, missing images, remap IDs | Bounded import, reject safe, không partial document save |
| Export | PNG/alpha; frame sequence; spritesheet reconstruction; video decode; offline HTML/React | Actual content khớp, không chỉ extension/HTTP200 |
| Unsupported outputs | no encoder/WebGL; Google Slides auth; complex SVG; GLB character | Fallback có thông báo hoặc lỗi rõ; không bỏ character im lặng |
| Lifecycle | repeated mount/unmount, context loss, aborted worker, object URL cleanup | Không tăng resource liên tục, worker stale result không apply |

## Performance targets đề xuất

Đây là budget để đo và điều chỉnh bằng evidence ở Phase 1, chưa phải kết quả hay cam kết người dùng:

- Profile chuẩn: 2 character instances, mỗi rig 64 bones, 32 attachments, tổng 5.000 mesh vertices đang visible, 10.000 keys/document; textures không quá 2048² mỗi ảnh. Đây là benchmark workload, không tự biến thành product limit.
- Desktop Chromium/Firefox: p95 frame work ≤16,7 ms; mobile viewport/WebKit: p95 ≤33,3 ms trên thiết bị được ghi rõ. Emulation viewport không thay số đo thiết bị thật.
- Numeric/drag feedback p95 ≤100 ms; seek deterministic trong clip 10 giây ≤250 ms trên máy benchmark. Seek 60 giây có checkpoint, cancel và budget; Phase 1 đo trước khi chốt ngưỡng.
- Sample same time/config/seed: transforms sai khác ≤1e-4 pixel/degree trong cùng runtime build; physics cross-browser có tolerance riêng nếu sai số float cần thiết.
- PNG comparison cùng renderer/device: ≥99% non-edge pixels lệch mỗi channel ≤2/255; silhouette ≤1 px tại điểm kiểm. Dùng reference expected độc lập, không so output với chính nó.
- Video: decoded duration lệch ≤1 frame ở fps mục tiêu; không thiếu key event/marker; timestamps tăng; audio sync lệch ≤1 frame cho test media đồng bộ. Codec lossy kiểm landmark/timing, không dùng PNG byte equality.
- Resource lifecycle: lặp 20 lần open/play/close sau warmup; kiểm worker/RAF/GPU resource counters trở về baseline, heap sau GC không tăng đơn điệu. Ghi measurement limitations.

Nếu vượt budget: profile/cache/worker/renderer fix; không tự giảm ảnh hoặc bỏ physics khi export. Nếu đổi scope/quality target cần user decision, ghi rõ trước khi đổi.

## Commands khi thực hiện

Node >=24. Fresh checkout cần cả hai dependency trees; các lệnh dưới đây chưa được chạy ở planning turn.

```sh
npm ci
npm ci --prefix packages/cli
npx playwright install chromium firefox webkit
npm run build:cli
npm run typecheck
npm test
npm run build
npm run pack:skill
```

Focused unit tests được ghi trong từng phase; renderer/export tests cần `node scripts/build-renderer.mjs` trước. CLI tests cần build CLI trước. Repo chưa có lint script riêng; không phát minh `npm run lint`.

```sh
npm run test:e2e -- tests/character-motion-acceptance.spec.ts --project=desktop
npm run test:e2e -- tests/character-motion-acceptance.spec.ts --project=mobile
STUDIO_CROSS_BROWSER=1 npm run test:e2e -- tests/character-motion-acceptance.spec.ts --project=firefox
STUDIO_CROSS_BROWSER=1 npm run test:e2e -- tests/character-motion-acceptance.spec.ts --project=webkit
npm run test:e2e
```

Các browser command chạy tuần tự. `STUDIO_CROSS_BROWSER=1` chỉ thêm projects vào config; runner không chọn Firefox/WebKit nếu thiếu `--project` tương ứng. E2E harness dùng port 8791 và DB tạm; không chạy review server cạnh tranh port. Không kill listener không thuộc task. Linux/CI cần browser system dependencies tương ứng.

Đóng gói CLI bằng `npm pack` với working directory là `packages/cli`, không dùng `npm pack --prefix`. React ZIP cần được giải nén/install/build trong temp directory, phục vụ bằng owned process trên port xác định rồi dừng. Không chạy production smoke routine.

## Parity checklist cho từng phase

- [ ] Shared schema/semantic validator và typed operations có positive + negative cases.
- [ ] Server owner/project asset checks, revision và OAuth scope giữ nguyên.
- [ ] Browser UI và browser WebMCP local-state/save semantics được mô tả.
- [ ] REST + network MCP + CLI cùng operation/result/error; machine schema discoverable.
- [ ] API reference/OpenAPI, docs/CLI/MCP/WebMCP, guide và design skill cập nhật theo feature.
- [ ] Renderer/viewer/source-export dependencies đồng bộ; build generated output từ sources.
- [ ] Public HTML/Markdown/llms.txt/llms-full.txt đã regenerate, không sửa generated files tay.

## Evidence khi kết thúc implementation

Lưu exact source SHA, commands/exit codes, browser versions, benchmark conditions, decoded export inspection và actual provider outcomes trong reports. Build/CI/merge/deploy/live readiness là trạng thái riêng. Chưa có credentials hoặc browser thì ghi đúng blocker; không đánh dấu full acceptance bằng unit tests thay thế.
