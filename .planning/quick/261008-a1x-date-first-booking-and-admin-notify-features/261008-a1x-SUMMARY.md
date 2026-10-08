---
phase: quick-261008-a1x
plan: 01
subsystem: telegram-bot
tags: [client-menu, admin-menu, booking, membership, telegram]

requires:
  - phase: 29-booking-list-clarity
    provides: showBookSessionList / showCancelClassList flat-list patterns this work replaces with a date-first picker
  - phase: 09-expiry-notifications-client-balance (v1.2)
    provides: getClientActiveMembership / membership expiry-date fields reused for the booking date-cap
provides:
  - "Date-first two-step booking picker (client /book, and the admin class-cancel flow) replacing a flat 10-slot cap that silently hid dates beyond the first ~2 days of availability"
  - "Client booking window widened 14 -> 30 days; membership-status preview (remaining sessions / unlimited / no-subscription warning) shown before the date list; bookable dates capped to the client's own membership expiresAt"
  - "Admin clients list shows remaining session slots inline (N / ∞ / ⚠️ 0) via one batched query (getActiveMembershipsForBusiness), no N+1"
  - "Hidden /testrole <code> owner|client|clear dev command — code-gated via TEST_ROLE_SECRET fly secret, lets one Telegram account impersonate either role for end-to-end testing without a second account"
  - "Admin Ειδοποίηση Πελατών menu: bulk-notify all clients expiring within 7 days, or select-one-client notify, each gated by a Naι/Όχι confirmation before sending, independent of the automatic 6h expiry sweep's dedup"
affects: [client-menu, admin-menu, billing/queries, session/manager, webhooks/telegram]

tech-stack:
  added: []
  patterns:
    - "Date-first two-step picker (pick date, then pick time/instance for that date) as the fix for any flat N-item cap that silently truncates a wider date window — reusable for future lists with the same shape"
    - "Batched per-business lookup map (Map<phone, summary>) instead of one query per list row, established by getActiveMembershipsForBusiness and reused by the notify-clients feature"

key-files:
  created:
    - src/utils/date-picker.ts
  modified:
    - src/telegram/handlers/client-menu.ts
    - src/telegram/handlers/admin-menu.ts
    - src/webhooks/telegram.ts
    - src/billing/queries.ts

key-decisions:
  - "Booking window widened from 14 to 30 days to actually deliver on-screen the 'whole month' visibility the flat list implied but couldn't show past its 10-row cap"
  - "Membership date-cap applies regardless of the business's enforcement policy (block/flag/allow) — a membership only ever covers slots up to its own expiresAt, independent of whether the business enforces payment at all"
  - "Exhausted session pack (sessionsRemaining=0) is treated identically to no membership at all (CR-04 precedent) — same warning/refusal path, no separate copy"
  - "/testrole is entirely inert unless the TEST_ROLE_SECRET fly secret is explicitly set — business.ownerTelegramId itself is never mutated (only routing decisions respect the override), so owner-bound side effects like approval alerts always reach the real owner even while a tester impersonates the client role"
  - "Admin notify-clients bulk/single sends deliberately bypass the automatic sweep's per-day dedup table — an explicit owner-confirmed send should always send, not be silently suppressed by the scheduler having already notified that client today"

requirements-completed: []

coverage:
  - id: Q1
    description: "Date-first picker shows the full configured booking window (30 days) without a flat per-message item cap hiding later dates"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts, tests/admin-menu.test.ts — date-list + per-date instance-list suites"
        status: pass
    human_judgment: false
  - id: Q2
    description: "Membership preview banner and expiresAt date-cap are applied before the client can pick a date beyond their subscription"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts — 'membership preview and expiry-date cap (D-11)' suite"
        status: pass
    human_judgment: false
  - id: Q3
    description: "Admin clients list annotates each client with remaining-slots/unlimited/warning suffix via a single batched query"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts — 'showClientsList — remaining-slots annotation' suite"
        status: pass
    human_judgment: false
  - id: Q4
    description: "/testrole override is honored consistently across every owner/client routing decision (menu, sbk, otc, escl callbacks) without ever mutating business.ownerTelegramId"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts — '/testrole — hidden role-override command' suite"
        status: pass
    human_judgment: true
  - id: Q5
    description: "Notify-clients bulk and single-client paths each require an explicit Naι/Όχι confirmation before sending, and report a delivery count back to the owner"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts — showNotifyExpiringList / handleNotifyExpiringExecute / showNotifyClientList / showNotifyClientConfirm / handleNotifyClientExecute suites"
        status: pass
    human_judgment: false

duration: unknown (single continuous session, not separately timed per feature)
completed: 2026-10-08
status: complete
---

# Quick Task 261008-a1x: Date-First Booking Picker, Membership Date-Cap, Admin Clients-List Slots, /testrole, and Notify-Clients Menu — Summary

**Retroactive documentation.** These five features were implemented and deployed in direct response to live conversational requests during one continuous session, without pre-written PLAN.md files — this summary (written after the fact, during a GSD reconciliation pass) exists to bring `.planning/` into sync with what the codebase and git history already show as shipped. No new code was written to produce this document; it only documents commits `11211cd`, `53b0d07`, `e37b711`, `ff05899`, and `d8390b4` (all already merged and pushed to `origin/main` prior to this summary).

## Accomplishments

1. **Date-first picker** (`11211cd`) — client `/book` and the admin class-cancel flow both replaced a flat, 10-row-capped session/date list (which silently hid all but the first ~2 days of a wider window) with a two-step picker: pick a date, then pick a time/instance for that date. Client booking window widened 14 → 30 days to match the "whole month" the old flat list implied but never actually showed.
2. **Membership preview + date-cap** (`53b0d07`) — before showing the date list, the client sees their own standing (sessions remaining / unlimited / no-active-subscription warning) and the date list itself is capped to their membership's `expiresAt`, regardless of the business's enforcement policy.
3. **Admin clients-list remaining-slots** (`e37b711`) — each client in the admin `/clients` list now shows `(N)` remaining sessions, `∞` for unlimited, or `⚠️ 0` for none/exhausted, via one new batched query (`getActiveMembershipsForBusiness`) instead of one query per client.
4. **Hidden `/testrole` command** (`ff05899`) — lets one Telegram account impersonate either the owner or client role for end-to-end testing, gated by the `TEST_ROLE_SECRET` fly secret and inert otherwise; centralizes every owner/client routing decision in `webhooks/telegram.ts` behind one `isSenderOwner()` helper so the override is honored everywhere consistently.
5. **Admin notify-clients menu** (`d8390b4`) — new "Ειδοποίηση Πελατών" root-menu option: bulk-notify everyone expiring within 7 days, or select one client, each behind its own confirmation, independent of the automatic sweep's dedup.

## Task Commits
- `11211cd` feat: date-first picker for client booking and admin class cancellation
- `53b0d07` feat: preview membership status and cap bookable dates to subscription expiry
- `e37b711` feat: show remaining session slots next to each client in admin clients list
- `ff05899` feat: hidden /testrole command for testing both owner and client sides from one account
- `d8390b4` feat: admin "Ειδοποίηση Πελατών" menu for manual renewal notifications

## Files Created/Modified
- `src/utils/date-picker.ts` (new) — shared date-button formatting/encoding helpers, reused by both the client booking flow and the admin class-cancel flow
- `src/telegram/handlers/client-menu.ts` — date-first picker, membership preview/cap
- `src/telegram/handlers/admin-menu.ts` — date-first class-cancel, clients-list slots, notify-clients menu
- `src/webhooks/telegram.ts` — `/testrole`, `isSenderOwner()` centralization, `/notify` command
- `src/billing/queries.ts` — `getActiveMembershipsForBusiness` batched lookup

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan
No PLAN.md existed — each feature was scoped conversationally and implemented directly, consistent with `/gsd-quick`-style execution but without the command's formal planning step.

## Issues Encountered
None blocking. One pre-existing, unrelated broken test file (`tests/scheduler-expiry.test.ts`, stale `Business` fixture missing newer fields) was discovered and confirmed to predate this work (same failure with these changes stashed out) — left untouched, out of scope.

## User Setup Required
- `TEST_ROLE_SECRET` fly secret must be set for `/testrole` to do anything (`fly secrets set TEST_ROLE_SECRET=<value>`); already done during this session.

## Next Phase Readiness
No blockers. Deferred, not done: hardening `/testrole`'s and the booking date-cap's defense against a hand-crafted `callback_data` bypassing the UI-level cap at booking-execute time (flagged to the user as low-value/no action requested).

---
*Phase: quick-261008-a1x*
*Completed: 2026-10-08*
