---
phase: 28-admin-menu-discoverability
plan: 2
subsystem: telegram-webhook
tags: [telegram, escalation, reply-relay, pending-state, greek-messages]

# Dependency graph
requires:
  - phase: 20-escalation-flow
    provides: escl:approve / escl:reply escalation callback pattern, buildEscalationKeyboard, sendEscalationToAdmin
  - phase: 26-confirmation-approval-policy
    provides: pendingServicePriceChanges in-memory Map precedent (WR-01 overwrite-clears-old-timer, .unref() Jest-safety pattern)
provides:
  - Working end-to-end reply-to-client relay for the escalation "Απάντηση πελάτη" button (ADMIN-01)
  - pendingReplies in-memory staging Map + stage/consume/clear API, reusable by any future owner-navigation-cancellable relay flow
affects: [future escalation/owner-messaging phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-process Map keyed by ownerTelegramId for cross-request state, mirroring pendingServicePriceChanges (10min TTL, .unref()'d timer, overwrite-clears-old-timer)"
    - "Free-text intercept placed before the unconditional AI-agent call in handleFoundBusiness's owner branch — same insertion point pattern usable for future owner-scoped staged actions"

key-files:
  created:
    - src/telegram/handlers/pending-reply.ts
    - tests/pending-reply.test.ts
  modified:
    - src/webhooks/telegram.ts
    - tests/telegram-webhook.test.ts

key-decisions:
  - "Pending-reply state lives only in an in-memory Map (D-02) — process-restart data loss is an accepted, documented tradeoff; owner's recourse is to re-tap the escalation reply button"
  - "Relay intercept sits in handleFoundBusiness's owner branch, between the /menu pre-emption and the unconditional aiOwnerAgent call — a staged reply is always consumed before the AI agent ever sees the message (D-01)"
  - "Relay forwards text only, via botTokenStore.run(business.botToken, ...) wrapping sendTelegramMessage — no media forwarding (D-05)"
  - "A relay send failure is caught and degrades to a Greek error message to the owner instead of throwing or leaving the request unhandled"
  - "/menu and /start both call clearPendingReply defensively (D-03) — /start's call is currently unreachable for owners (the owner branch always returns earlier) but included per D-03's literal wording and as a guard against future restructuring"
  - "Per D-13, no Phase 26 Ναι/Όχι confirmation gate was added — the relay send is non-destructive/reversible and out of CONF-01's locked 5-action scope"

patterns-established:
  - "pendingReplies Map + stagePendingReply/consumePendingReply/clearPendingReply trio — a reusable template for any future owner-scoped, navigation-cancellable pending action"

requirements-completed: [ADMIN-01]

coverage:
  - id: D1
    description: "Owner taps 'Απάντηση πελάτη' on an escalation, then sends a free-text message — that message relays verbatim to the escalating client via the business's own bot token, and the owner receives 'Η απάντηση στάλθηκε.'"
    requirement: "ADMIN-01"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#POST /webhooks/telegram/:webhookId — reply-relay flow (ADMIN-01) > Test 28-01"
        status: pass
    human_judgment: false
  - id: D2
    description: "A staged reply is consumed before aiOwnerAgent is ever called — the relay does not compete with or get swallowed by the AI owner agent"
    requirement: "ADMIN-01"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 28-01 — asserts mockedAiOwnerAgent not called"
        status: pass
      - kind: static
        ref: "grep line-number check: consumePendingReply(senderTelegramId) call precedes the aiOwnerAgent(...) call in src/webhooks/telegram.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "/menu clears a pending reply — a subsequent free-text message routes to aiOwnerAgent as normal, not to relay"
    requirement: "ADMIN-01 (D-03)"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 28-02"
        status: pass
    human_judgment: false
  - id: D4
    description: "A relay send failure to the client degrades to a Greek error message to the owner; the handler does not throw and the request still returns 200"
    requirement: "ADMIN-01"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 28-03"
        status: pass
    human_judgment: false
  - id: D5
    description: "Pending-reply state module behaves like the pendingServicePriceChanges precedent: stage/consume-once/clear/overwrite-safe/timer-safe"
    requirement: "ADMIN-01 (D-02)"
    verification:
      - kind: unit
        ref: "tests/pending-reply.test.ts (5 cases: stage+consume, empty consume, clear, no-op clear, overwrite-no-leak)"
        status: pass
    human_judgment: false

metrics:
  duration: "~35 minutes"
  completed: "2026-07-28"
---

# Phase 28 Plan 2: Escalation Reply Relay Summary

Wired the escalation "Απάντηση πελάτη" button into a real, working message relay: an in-memory `pendingReplies` staging Map (mirroring the `pendingServicePriceChanges` precedent) keyed by owner Telegram ID, consumed on the owner's very next free-text message to forward that text verbatim to the escalating client via the business's own bot token — closing a gap where the button previously only prompted the owner and silently dropped their actual reply.

## What Was Built

**`src/telegram/handlers/pending-reply.ts` (new)** — `pendingReplies` Map plus `stagePendingReply`, `consumePendingReply`, and `clearPendingReply`. Staging overwrites any existing entry for the same owner and clears its timer first (mirrors the `pendingServicePriceChanges` WR-01 pattern), each entry self-expires after 10 minutes via a `.unref()`'d timer (Jest-safe), and the module header documents the accepted process-restart data-loss tradeoff (D-02).

**`src/webhooks/telegram.ts`** — three wiring points:
1. The `escl:reply` branch of `handleCallbackQuery` now calls `stagePendingReply(senderTelegramId, escl.clientTelegramId)` before sending its existing (unchanged) prompt text.
2. `handleFoundBusiness`'s owner branch now calls `consumePendingReply(senderTelegramId)` immediately after the `/menu` pre-emption and before the unconditional `aiOwnerAgent(...)` call. If a reply is staged, the branch relays `messageText` to the client via `botTokenStore.run(business.botToken, ...)` + `sendTelegramMessage`, confirms to the owner with `'Η απάντηση στάλθηκε.'`, and returns — never reaching `aiOwnerAgent`. A relay failure is caught and degrades to `'Σφάλμα: δεν ήταν δυνατή η αποστολή της απάντησης.'` instead of throwing.
3. Both the `/menu` and `/start` pre-emption blocks now call `clearPendingReply(senderTelegramId)` as their first statement (D-03), so navigating away before replying never lets a later, unrelated message accidentally relay to the wrong client.

## Deviations from Plan

None — plan executed exactly as written. One micro-adjustment made during Task 1 to satisfy the plan's own acceptance-criteria grep (`grep -c ".unref()"` expected exactly 1 match): reworded a comment that had literally contained the substring `.unref()` so the regex only matches the real call site.

## Known Stubs

None.

## Threat Flags

None — all new surface (the `pendingReplies` Map, the relay's `botTokenStore.run`/`sendTelegramMessage` calls, and the `clearPendingReply` navigation hooks) is already covered by this plan's own `<threat_model>` (T-28-04 through T-28-08), all dispositioned `accept` or `mitigate` with mitigations already implemented as described (owner-only guard reused unchanged from the pre-existing `escalationAction` branch; Map keyed by `ownerTelegramId` so cross-owner reads are structurally impossible; bounded Map growth via auto-expiring, overwrite-only entries).

## Self-Check: PASSED

- FOUND: src/telegram/handlers/pending-reply.ts
- FOUND: tests/pending-reply.test.ts
- FOUND: src/webhooks/telegram.ts (modified, relay wiring present)
- FOUND: tests/telegram-webhook.test.ts (modified, 3 new tests present)
- FOUND commit 0b2f579 (Task 1: pending-reply state module)
- FOUND commit 5d889ef (Task 2: webhook wiring + tests)
