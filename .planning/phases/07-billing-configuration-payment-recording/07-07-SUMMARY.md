---
phase: 07-billing-configuration-payment-recording
plan: "07"
subsystem: telegram-billing
status: complete
tags: [gap-closure, ux, telegram, billing, keyboard]
dependency_graph:
  requires: [07-04, 07-05]
  provides: [G-07-2-closed]
  affects: [src/webhooks/telegram.ts]
tech_stack:
  added: []
  patterns: [optional-chain-guard, editMessageReplyMarkup-keyboard-clear]
key_files:
  created: []
  modified:
    - src/webhooks/telegram.ts
    - .planning/phases/07-billing-configuration-payment-recording/COVERAGE.md
decisions:
  - "TelegramCallbackQuery.message is optional per Telegram spec — guarded with optional-chain before message_id access; keyboard clear is best-effort and never throws"
  - "Intermediate billing branches (billing:client, billing:package) do NOT clear keyboard — they send a new keyboard message as the next UX step; clearing the prior one is not required"
metrics:
  duration: 2
  completed_date: "2026-07-21"
  tasks_completed: 1
  files_modified: 2
requirements: [BILL-01, PAY-01]
gap_ids: [G-07-2]
---

# Phase 07 Plan 07: G-07-2 Billing Keyboard Clear Summary

**One-liner:** Extended TelegramCallbackQuery with `message?: { message_id: number }` and wired `editTelegramMessageReplyMarkup` into all 4 terminal billing branches to dismiss the Ναι/Όχι keyboard after owner tap.

## Objective

Close UAT gap G-07-2: the inline Ναι/Όχι keyboard buttons remained visible after the owner tapped either button on billing confirmation flows (package creation and membership recording). Root cause was a missing `message` field on the `TelegramCallbackQuery` interface, preventing the handler from accessing `message_id` needed to call `editTelegramMessageReplyMarkup`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | G-07-2 — Extend TelegramCallbackQuery and clear billing keyboard after terminal branches | 1d78acd | src/webhooks/telegram.ts, COVERAGE.md |

## What Was Built

### Interface Extension

`TelegramCallbackQuery` interface (lines 46-52 in `src/webhooks/telegram.ts`) gained a fourth optional field:

```typescript
message?: { message_id: number };
```

This matches the Telegram Bot API spec (message is present for inline keyboard taps on regular messages, absent for inline-mode queries). The field uses a minimal nested type — only `message_id` is needed for `editMessageReplyMarkup`.

### Keyboard-Clearing Calls

Four guarded `editTelegramMessageReplyMarkup` calls were added to `handleCallbackQuery`, one after each terminal billing branch:

- **billing:mem_confirm** — after `handleConfirmMembership(...)` returns
- **billing:mem_cancel** — after `sendTelegramMessage(senderTelegramId, '❌ Ακυρώθηκε η πληρωμή.')` returns
- **billing:pkg_confirm** — after `handleConfirmPackage(...)` returns
- **billing:pkg_cancel** — after `handleCancelPackage(...)` returns

Each call uses the optional-chain guard pattern:
```typescript
if (callbackQuery.message?.message_id) {
  await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
}
```

The guard ensures silence when `message` is absent (per Telegram spec for inline-mode callbacks) — no throw, no side effect.

### COVERAGE.md Update

`editMessageReplyMarkup` row in Table 1 updated from `OPT-OUT` to `INTEGRATE` with an accurate reason explaining the terminal-step-only scope and the G-07-2 rationale.

## Verification Results

- `npx tsc --noEmit` exits 0 — interface extension is type-safe throughout
- `grep -c 'message?.message_id' src/webhooks/telegram.ts` returns 4 — one guard per terminal branch
- COVERAGE.md `editMessageReplyMarkup` row shows INTEGRATE with G-07-2 attribution

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

| Threat ID | Status |
|-----------|--------|
| T-07-GC-04 (Tampering via payload message_id) | Accepted — keyboard-clear is best-effort; a Telegram API error on editMessageReplyMarkup does not affect the underlying business operation |
| T-07-GC-05 (Non-owner calling billing terminal callbacks) | Already mitigated upstream by `findBusinessByOwnerTelegramId` guard before any terminal branch is reached |

## Self-Check: PASSED

- src/webhooks/telegram.ts: FOUND
- COVERAGE.md: FOUND
- 07-07-SUMMARY.md: FOUND
- commit 1d78acd: FOUND
