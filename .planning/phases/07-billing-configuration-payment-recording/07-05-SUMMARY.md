---
phase: "07"
plan: "05"
subsystem: billing
tags:
  - gemini-tools
  - nlu-integration
  - webhook-routing
  - billing-callback
  - client-name
dependency_graph:
  requires:
    - "07-04"  # billing/tools.ts and payment-flow.ts handlers imported here
    - "07-03"  # billing/queries.ts used via tools.ts
  provides:
    - src/onboarding/ai-owner-agent.ts (5 billing tool definitions + executeOwnerTool cases)
    - src/webhooks/telegram.ts (billing callback routing + clientName upsert)
  affects:
    - Phase 7 complete — all 6 requirements wired end-to-end
tech_stack:
  added: []
  patterns:
    - OWNER_TOOLS array extended with 5 FunctionDeclaration objects
    - executeOwnerTool switch extended with 5 billing cases
    - parseCallbackData union type handles booking + billing action shapes
    - Billing callback discriminant: 'firstId' in parsed → BillingCallbackResult
    - clientName upsert after handleFoundBusiness for all client messages (D-04)
key_files:
  modified:
    - src/onboarding/ai-owner-agent.ts
    - src/webhooks/telegram.ts
    - tests/billing-package-creation.test.ts
    - tests/billing-nlu-parsing.test.ts
commits:
  - sha: f34998d
    message: "test(07-05): add failing tests for billing NLU tool definitions"
  - sha: d7cd86a
    message: "feat(07-05): add 5 billing tools to OWNER_TOOLS and executeOwnerTool"
  - sha: d256a23
    message: "feat(07-05): extend telegram.ts with billing callback routing and clientName upsert"
self_check: PASSED
---

## What Was Built

**Task 1 — `src/onboarding/ai-owner-agent.ts`:** Added 5 `FunctionDeclaration` objects to `OWNER_TOOLS` (`create_package`, `list_packages`, `deactivate_package`, `record_payment`, `view_client_membership`) with typed parameters matching Zod schemas in billing/tools.ts. Extended `executeOwnerTool` switch with 5 billing cases: `create_package` detects the `pendingPackageId` result shape and sends the D-03 confirmation keyboard inline; `record_payment` calls `showClientSelection` (keyboard mode, D-08) instead of returning a string; remaining 3 cases return formatted Greek strings directly.

**Task 2 — `src/webhooks/telegram.ts`:** Extended `parseCallbackData` with a union return type (`BookingCallbackResult | BillingCallbackResult | null`) using discriminant `'firstId' in result` for type-safe narrowing. Added 6 billing action patterns (`billing:client`, `billing:package`, `billing:mem_confirm`, `billing:mem_cancel`, `billing:pkg_confirm`, `billing:pkg_cancel`) to the regex. Added billing callback routing block in `handleCallbackQuery` that resolves the owner business via `findBusinessByOwnerTelegramId` (T-07-01 ownership check, T-07-06 multi-tenant isolation) before any mutation. Added `insertClientBusinessRelationship` call after `handleFoundBusiness` for client messages to upsert `client_name` from `from.first_name` (D-04); owners are excluded.

## Test Results

- billing-package-creation.test.ts: BILL-01 suite — 5 passing
- billing-nlu-parsing.test.ts: NLU edge case suite — 7 passing
- Full suite: 278 passing, 1 skipped, 0 failures

## Deviations

None. All plan tasks executed as specified.

## Phase 7 Completion

All 6 requirements now fully integrated:
- **BILL-01** — `create_package` Gemini tool → `handleCreatePackage` → DB insert with D-03 confirmation keyboard
- **BILL-02** — `list_packages` Gemini tool → `handleListPackages` → Greek-formatted active package list
- **BILL-03** — `deactivate_package` Gemini tool → `handleDeactivatePackage` → soft-delete
- **PAY-01** — `record_payment` Gemini tool → `showClientSelection` → keyboard flow → `handleConfirmMembership`
- **PAY-02** — `createMembership` with DST-safe expiry and idempotency_key (T-07-04)
- **PAY-03** — `view_client_membership` Gemini tool → `getClientActiveMembership` → Greek reply
