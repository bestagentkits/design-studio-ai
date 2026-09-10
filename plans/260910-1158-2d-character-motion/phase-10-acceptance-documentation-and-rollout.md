---
title: "Phase 10: Acceptance, documentation và rollout handoff"
status: todo
---

# Phase 10: Acceptance, documentation và rollout handoff

## Overview

Priority: P1. Status: pending. Depends on: Phases 1–9, tất cả phase gates đạt hoặc blocker được ghi đúng.

## Context

[Thiết kế](architecture.md) · [Test matrix](test-matrix.md) · [Plan](plan.md)

- [docs/README.md](../../docs/README.md)
- [docs/architecture.md](../../docs/architecture.md)
- [docs/agents.md](../../docs/agents.md)
- [docs/providers.md](../../docs/providers.md)
- [docs/web-documentation.md](../../docs/web-documentation.md)
- [src/app/documentation.tsx](../../src/app/documentation.tsx)
- [src/app/guide.tsx](../../src/app/guide.tsx)
- [src/shared/api-reference.ts](../../src/shared/api-reference.ts)
- [skills/design-studio-ai/SKILL.md](../../skills/design-studio-ai/SKILL.md)
- [scripts/build-public-docs.mjs](../../scripts/build-public-docs.mjs)
- [playwright.config.ts](../../playwright.config.ts)
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

## Requirements

- Một acceptance project từ asset có quyền dùng, chạy manual và agent workflows đầy đủ; không dùng tài khoản/project production làm test fixture.
- Đo browser/performance/export parity theo test matrix; documentation/llms output phản ánh capability thực.
- Handoff tách implementation/local checks/PR/CI/merge/deploy/runtime/provider proof. Việc lập plan không tự cấp quyền ship.

## Files and ownership

Modify: Smallest owning docs/guide/reference/agent skill đã được cập nhật từng phase; bổ sung navigation/examples và public-doc build tests. Chỉ sửa CI nếu cần gates mới thực tế.

Create: `skills/design-studio-ai/references/character-motion.md` nếu navigation hiện tại cần; `tests/character-motion-acceptance.spec.ts`; báo cáo dưới `reports/` của plan.

Delete: none. Các file Create là dự kiến; check repository trước khi thêm. Một owner sửa các shared files mỗi lần.

## Implementation checklist

- [ ] Chạy acceptance: import→rig→mesh→skins→idle/walk/wave→IK/physics/slider→mix trong scene→AI preview/apply→publish/export→clone/reopen.
- [ ] Kiểm REST/MCP/CLI/WebMCP parity từ public schema, including auth/scope/stale/version/oversized input; screenshots/traces không chứa credentials.
- [ ] Chạy checks/full build/browser matrix và performance budgets; ghi chính xác OS/browser/version/profile, chưa chạy ghi pending. WebKit không tự là Safari trên iPhone thật.
- [ ] Hoàn thiện beginner guide + installable skill có ví dụ đúng executable schema; update architecture/provider/agent docs; regenerate public HTML/Markdown/OpenAPI/llms qua owning build, không sửa dist/public bundles tay.
- [ ] Review cross-module/public contract bằng reviewer hoặc review skill khi execution được yêu cầu; validate findings against source/tests, không cắt explicit scope theo abstract concern.
- [ ] Đối chiếu mọi checkbox với evidence. Dừng process đã khởi động; lưu báo cáo acceptance/limitations và diff review.
- [ ] Nếu sau đó có yêu cầu ship: fresh branch/head checks, focused conventional commits, exact-head CI, deployment revision và read-only live readiness. Giữ ENCRYPTION_KEY, applied migrations và v2 readers; production smoke destructive không chạy routine.
- [ ] Nếu không có ship authorization: bàn giao local verified changes và steps/blockers cụ thể, không tự merge/deploy.

## Validation

Toàn bộ commands và thứ tự trong [test matrix](test-matrix.md); kiểm link/build public docs và `npm run pack:skill`; đóng gói CLI bằng `npm pack` chạy trong `packages/cli`.

Tests mới chỉ chạy sau khi được tạo. Public capability, validation và documentation phải đồng bộ trong phase, không chờ đợt cuối.

## Acceptance

Tất cả requested native capability có evidence hoặc blocker chính xác; không gọi shipped khi chỉ build/CI pass. Có kiểm thử desktop/mobile Chromium, Firefox và WebKit hoặc nêu giới hạn thực tế. Docs không mô tả game/Spine/PSD như đã có nếu chưa làm.

## Risks, security and rollback

Nếu đang lưu v2 thì rollback phải giữ reader-compatible deployment. Không reset DB/rotate encryption key để sửa test. Plan/report chỉ là lịch sử, không thay evergreen product authority.
