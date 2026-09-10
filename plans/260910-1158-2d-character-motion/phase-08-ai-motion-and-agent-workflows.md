---
title: "Phase 8: AI motion và agent workflows"
status: todo
---

# Phase 8: AI motion và agent workflows

## Overview

Priority: P1. Status: pending. Depends on: Phase 7; các public operations đã được expose theo từng phase trước.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [server/providers.ts](../../server/providers.ts)
- [server/briefs.ts](../../server/briefs.ts)
- [server/projects.ts](../../server/projects.ts)
- [server/mcp.ts](../../server/mcp.ts)
- [src/app/editor.tsx](../../src/app/editor.tsx)
- [src/app/browser-design-tools.ts](../../src/app/browser-design-tools.ts)
- [src/shared/api-reference.ts](../../src/shared/api-reference.ts)
- [packages/cli/src/dsa.ts](../../packages/cli/src/dsa.ts)
- [tests/agent-capability-parity.test.ts](../../tests/agent-capability-parity.test.ts)
- [tests/provider-capabilities.test.ts](../../tests/provider-capabilities.test.ts)

## Requirements

- Prompt tạo/chỉnh idle/breath/wave, timing/loop/secondary motion; preserve selected rig/clip và constraints ngoài scope.
- Gợi ý bones/weights cho ảnh nhiều lớp có preview; tự động tách ảnh bị che khuất không được hứa là sẵn có.
- Một proposal chứa base document revision, brief revision, selected entities, typed operations và tóm tắt ảnh hưởng; apply luôn explicit.

## Files and ownership

Modify: Provider system/context assembly, proposal UI, server validators/services, REST/MCP/WebMCP/CLI orchestration và typed API reference.

Create: `src/shared/motion-proposals.ts`, `server/motion-generation.ts`, `src/app/motion-proposal-preview.tsx`; CLI motion module nếu cần theo pattern hiện có; `tests/motion-proposals.test.ts`, `tests/motion-agent-parity.test.ts`, `tests/motion-proposals-ui.spec.ts`.

Delete: none. Các file Create là dự kiến; check repository trước khi thêm. Một owner sửa các shared files mỗi lần.

## Implementation checklist

- [ ] Reuse approved-brief checks trước và sau provider call; subset context có IDs/type/schema và assets metadata cần thiết, không gửi document/private media không liên quan.
- [ ] Yêu cầu provider trả bounded typed operation proposal; kiểm schema, references, operation allowlist và resource budget. Kết quả invalid phải fail rõ; không thay bằng fixture animation.
- [ ] Chạy proposal trên bản clone document để tạo before/after pose/clip preview; dirty local edits phải được giữ. Khóa apply nếu base revision hoặc brief approval thay đổi.
- [ ] Apply proposal một transaction revision-checked; lỗi 409 yêu cầu re-read/diff, không tự nâng revision rồi retry; rejection/cancel không chạm document saved.
- [ ] Cung cấp inspection nhỏ gọn, sample poses, diagnostics và named operations qua REST/MCP/CLI/WebMCP; cùng lỗi/path/details, không yêu cầu agent tự sửa cả JSON document.
- [ ] Record usage/outcome theo telemetry owner hiện có; không log prompt, keys, images hay animation payload. Missing cost giữ unknown.
- [ ] Thử prompt thật trên provider được cấu hình với account/test data được cho phép; ghi provider/model/request outcome riêng. Không cần credentials để tests schema/invalid proposal hoạt động.

## Validation

`npm run build:cli`; `npm run typecheck`; `npx tsx --test tests/motion-proposals.test.ts tests/motion-agent-parity.test.ts tests/agent-capability-parity.test.ts tests/briefs.test.ts tests/provider-capabilities.test.ts tests/cli.test.ts`; `npm run build`; `npm run test:e2e -- tests/motion-proposals-ui.spec.ts --project=desktop` và `--project=mobile`.

Tests mới chỉ chạy sau khi được tạo. Public capability, validation và documentation phải đồng bộ trong phase, không chờ đợt cuối.

## Acceptance

Các prompt mẫu tạo proposal có keyframes thật và preview; apply/reject/stale/brief-changed được kiểm chứng. Manual và external agent workflows vẫn dùng được khi BYOK chưa cấu hình. Live provider success chỉ báo khi đã thực thi thật.

## Risks, security and rollback

LLM không được điều khiển trực tiếp state runtime hoặc viết executable code. Không gửi credential/user asset trong docs/traces; giữ transport redirect:'manual' trên Workers.

## Execution record (2026-09-10)

Native implementation is present. See [contract decisions](reports/contract-decisions.md) for final technical choices and [implementation review](reports/implementation-review.md) for executed checks and explicit limitations. Original checklists above are the planning audit trail; measured performance targets and live-provider acceptance are not claimed complete.
