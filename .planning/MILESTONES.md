# Milestones

## v1.7 UX & Trust Polish (Shipped: 2026-07-29)

**Phases completed:** 5 phases, 14 plans, 34 tasks

**Key accomplishments:**

- Client session-booking reschedules now route through the same Έγκριση/Απόρριψη owner-approval cascade as new bookings — a rejected reschedule leaves the client's original booking fully intact, via a new rescheduledFromBookingId link consumed by a cascade-cancel added to sbk:approve.
- 1. [Rule 3 - Blocking] Moved pendingServicePriceChanges Map + setter from Task 2 into Task 1's commit
- Repurposed `client_business_relationships.consent_given` from implied-consent-by-default (true) to explicit-opt-in-required (false), shipped migration 0013 to the live Neon DB, and added `updateClientConsentGiven` for Plan 27-02's consent gate.
- Wired the hard Ναι/Όχι consent gate into both client entry points — `/start` and free-form chat — so a client only reaches the menu or an AI reply after explicitly accepting, replacing the old soft/prepended consent notice with a real blocking gate (COMP-01/COMP-02, D-01/D-02/D-03).
- Wired the existing payment-recording flow and Gemini NLU setup guidance into `/menu` via a new root-level "Καταχώρηση Πληρωμής" button and 3 new Settings-submenu example-phrase buttons, and upgraded the "Νέο μάθημα (chat)" prompt to the same multi-example style.
- `src/telegram/handlers/pending-reply.ts` (new)
- Consolidated hoursUntilSession into timezone.ts, gave listSessions() a backward-compatible excludePastToday filter, added a businessId-scoped findSessionInstanceById lookup, and centralized back-menu button labels — the three foundational primitives every other Phase 29 plan imports.
- All 4 client-facing `listSessions()` calls in `function-executor.ts` (the Gemini tool-call layer) now pass `excludePastToday=true`, and the file's duplicate hours-until-session algorithm is gone in favor of Wave 1's shared `timezone.ts` export — completing UX-01 for every free-chat booking path.
- Closed both remaining D-05 silent-drop gaps in handleCallbackQuery (unparseable callback_data and the legacy approve_/reject_ "booking not found" branch) with Greek back-menu recovery messages, and swapped escl:approve's ad-hoc unscoped Drizzle join for the businessId-scoped findSessionInstanceById helper.
- showCancelClassConfirm now renders the real session date/time/service name instead of a raw `#42` id; showClassesMenu and showCancelClassList show the service name via a batched (non-N+1) lookup; an unrecognized admin menu tap gets a working back-to-menu button instead of a dead end; all 12 back-menu button renders in admin-menu.ts now source from one shared BACK_MENU_LABELS.ADMIN constant.
- client-menu.ts's `/menu` → "Κράτηση μαθήματος" flow now excludes already-started same-day classes, labels its root-menu button and redirect text correctly for open-slot businesses with a working back button, shows service names next to each date/time, and resolves session data through the shared businessId-scoped `findSessionInstanceById` helper instead of an unscoped inline Drizzle join.
- showClientBookings/showCancelBookingList now show service names via a batched lookup, showCancelConfirm gained a mandatory ownership guard (previously had none) before rendering real date/service context with anti-enumeration on failure, and handleCancelExecute's 3 named early-returns plus the dispatcher's default case all offer a working back-to-menu button — closing out client-menu.ts's Phase 29 work.
- Converted 4 raw-Telegram-ID owner tools (view_client_membership, assign_client_to_session, send_renewal_reminder, list_slotless_requests) to name-based lookup via a shared `resolveClientByName` helper with text-based disambiguation and RLS-scoped cross-business isolation.
- Bounded retry-with-backoff for `finish_onboarding`'s one-shot Telegram menu/command setup, plus a fire-and-forget `reassertMenuButtonAndCommands()` re-assertion on every `/menu` tap via `showAdminRootMenu`.

---

## v1.6 Telegram Bot UX/Ops Improvements (Shipped: 2026-07-27)

**Phases completed:** 4 phases, 4 plans, 11 tasks

**Key accomplishments:**

- Session-class bookings now default to `pending_owner_approval` with a real Έγκριση/Απόρριψη Telegram keyboard, atomic capacity-release + credit-restore on reject/expiry, and ownership/cross-tenant/idempotency guards on the new `sbk:` webhook callback route.
- cascadeCancelSessionBookings shared service function wired into both admin-menu and free-chat lesson cancellation, restoring credit, releasing capacity, and sending Greek business-initiated notifications for every active booking on a cancelled session instance
- Persistent Telegram menu button/commands for owner+client (BOT-06) plus best-effort owner diagnostics on both confirmed client-facing Gemini/routing fallback catch sites (DIAG-01)
- QR + text-into-pixels business invite generator (qrcode + sharp SVG composition) wired into both the admin menu and free-chat Gemini tool-calling, sharing one orchestration function and a new multipart sendTelegramPhoto client helper.

---

## v1.5 AI-Driven Owner Onboarding (Shipped: 2026-07-25)

**Phases completed:** 1 phases, 3 plans, 6 tasks

**Key accomplishments:**

- A standalone, fully unit-tested Gemini tool-calling onboarding agent (10 tools, stateless DB-derived system prompt, MAX_TOOL_ROUNDS=5 loop) that replaces the old regex-based hours parser — not yet wired into the live Telegram webhook.
- Both Telegram entry points that reach an onboarding-incomplete owner (typed message and inline-keyboard tap) now call the new stateless `aiOnboardingAgent` instead of the deleted deterministic step machine, with zero remaining references to `dispatchOnboardingStep`/`onboarding/router`.
- Deleted `src/onboarding/steps.ts`/`router.ts` and the dead session-lifecycle functions in `queries.ts`, completing the migration to `aiOnboardingAgent`; also fixed two test files whose stale `jest.mock('.../onboarding/router')` calls would have broken module resolution after the deletion.

---

## v1.4 Single-Bot UX Overhaul (Shipped: 2026-07-24)

**Phases completed:** 5 phases, 16 plans, 11 tasks

**Key accomplishments:**

- Platform bot fully removed — a single per-business bot now handles both admin and client traffic, routed purely by Telegram-ID match against `business.ownerTelegramId` (no password/PIN)
- Owner onboarding auto-starts: an owner with `onboarding_completed=false` messaging their bot is routed straight into the onboarding state machine (resume or fresh session), no manual trigger
- Admin `/menu` command: Settings/Classes/Clients/Today's-Agenda sub-menus, all binary decisions (cancel class, confirm) via Ναι/Όχι inline keyboards, no free-text ambiguity
- Client `/start` welcome menu (Book a class / My Bookings / Cancel / Balance) with full inline-button flows, while free Greek chat remains available at any point (CMENU-05)
- Class-schedule setup added directly into owner onboarding (recurrence + capacity via 6 new `class_setup_*` steps), plus a terminology sweep replacing σεζόν→μάθημα across 45 Greek string literals with zero TypeScript identifier changes
- Blocked-client escalation: client gets a graceful Greek apology, admin gets an inline notification (client name, attempted action, failure reason) with an "approve exception" button that re-attempts the booking under capacity lock
- **Verification sweep caught and fixed 3 real bugs before shipping** (phases 16/17/19 had been executed but never code-reviewed or goal-verified until milestone close): dead onboarding-routing code silently dropped by a merge conflict (Phase 16), an ambiguous cross-tenant business lookup in admin-menu/escalation callback routing that could route actions against the wrong tenant (Phase 17), and an accidental Gemini model-id swap (`2.5`→`3.5`) hidden inside an unrelated i18n commit that would have broken every AI call in the app (Phase 19)
- Known gap accepted and deferred: the escalation "reply to client" button prompts the admin but doesn't yet relay the message (ESCL-03 partial — tracked as ROADMAP.md Backlog Phase 999.1)

---

## v1.2 Billing & Membership System (Shipped: 2026-07-22)

**Phases completed:** 3 phases, 16 plans, 19 tasks

**Key accomplishments:**

- 8 Jest it.todo() stub files covering all BILL-01..03 and PAY-01..03 requirements, plus a Telegram/Gemini API coverage matrix for Phase 7.
- Drizzle schema extended with billingPackages, memberships, membershipLedger tables and clientName column on clientBusinessRelationships; SQL reference migration created; schema pushed to live Neon DB with 235 tests passing.
- Billing CRUD query layer with DST-safe membership creation, atomic ledger writes, and idempotency-enforced replay protection.
- Zod-validated billing tool handlers (tools.ts) and multi-step inline keyboard payment flow (payment-flow.ts) with ownership validation and price-safe callback_data.
- Added 5 `FunctionDeclaration` objects to `OWNER_TOOLS` (`create_package`, `list_packages`, `deactivate_package`, `record_payment`, `view_client_membership`) with typed parameters matching Zod schemas in billing/tools.ts. Extended `executeOwnerTool` switch with 5 billing cases: `create_package` detects the `pendingPackageId` result shape and sends the D-03 confirmation keyboard inline; `record_payment` calls `showClientSelection` (keyboard mode, D-08) instead of returning a string; remaining 3 cases return formatted Greek strings directly.
- Fixed two UAT gaps — all-time client fallback in payment flow + name-based package deactivation eliminating hallucinated IDs.
- Extended TelegramCallbackQuery with `message?: { message_id: number }` and wired `editTelegramMessageReplyMarkup` into all 4 terminal billing branches to dismiss the Ναι/Όχι keyboard after owner tap.
- Three test files with 14 it.todo stubs scaffold SESS-01..04 and ENFC-01..03 without importing unbuilt functions, keeping ts-jest compilation green across Phase 8
- `migrations/0007_enforcement_policy.sql`
- 1. [Rule 3 - Blocking] Add billing/queries mock to telegram-webhook.test.ts
- 1. [Rule 2 - Auto-add] Created src/billing/enforcement.ts
- UNIQUE dedup table for membership expiry notifications, DD/MM/YYYY Athens date formatter, and 10 it.todo stubs covering NOTF-01 through NOTF-04.
- DST-safe 7-day expiry window query + idempotent dedup insert for the Plan 03 sweep, plus the complete check_membership_balance Gemini tool with three Greek D-08 message scenarios and 4 passing unit tests.
- 6-hour in-process membership expiry sweep with per-business/per-membership isolation, botTokenStore.run() wrapping, UNIQUE dedup gating, and 6 passing NOTF-01/02/03 tests — poller registered in server.ts after live Neon DB migration confirmed.

---

## v1.1 Per-Bot Infrastructure & Owner Onboarding (Shipped: 2026-07-17)

**Phases completed:** 2 phases, 13 plans, 25 tasks  
**Code:** +3,571 / -654 lines TypeScript/SQL across 47 files (5,162 total src/ LOC)  
**Timeline:** 2026-07-10 → 2026-07-17 (7 days)

**Key accomplishments:**

- Telegraf migration + per-bot UUID-keyed webhook routing: each business runs its own Telegram bot with a dedicated `/webhooks/telegram/:webhookId` entry point (BOT-04/BOT-05)
- PostgreSQL RLS enforcement via AsyncLocalStorage context threading: per-request botTokenStore dispatches tenant context into every Drizzle transaction, enforced at the DB layer not just application layer (BOT-03)
- HMAC constant-time webhook verification per bot with `crypto.timingSafeEqual` replacing string equality (BOT-02)
- 25-step DB-backed owner onboarding state machine via Telegram chat: TIME_REGEX validation, incremental business_hours writes, service collection loop (ONB-01/ONB-02)
- Platform bot 3-path routing (new/resume/re-registration) with HMAC-verified webhook handler + automatic `setWebhook`/`deleteWebhook` sequencing (BOT-01)
- Owner edit flows post-onboarding (ONB-03) + fixture seed removal replacing all hardcoded businesses with real onboarded ones (ONB-04)
- AI-powered owner agent (Gemini NLU replacing keyword matching), inline keyboard buttons UX, and streamlined hours entry (3 quick-task improvements)
- 25-test suite (8 integration + 17 unit) with full mock isolation — no real Telegram API or DB in CI

---

## v1.0 MVP (Shipped: 2026-07-09)

**Phases completed:** 3 phases, 19 plans, 32 tasks

**Key accomplishments:**

- Drizzle/Postgres schema live on Neon (businesses, messages, client_business_relationships) with zod-validated config, Pino logging, and two idempotently-seeded fixture businesses
- Task 1 — WhatsApp Cloud API client
- Task 1 — Idempotent message dedup
- Drizzle schema for services/business_hours/bookings/conversation_turns/telegram_updates with a partial unique index preventing double-booking while releasing slots immediately on cancellation, a 16-function typed query layer, and idempotently-seeded Greek fixture data (3 distinct-duration services + full weekly hours per business)
- Telegram Bot API client (4 primitives) + inbound webhook at /webhooks/telegram reusing Phase 1's business resolver and consent checker unchanged, proving the full Telegram round trip before any AI/booking logic exists
- checkAvailability (1-hour slots, per-booking duration correctness, closed-day/stale-sweep handling) and resolveGreekTemporalExpressions (20-phrase validated Greek colloquial date/time corpus), both pure Athens-timezone-correct modules with zero new date-library dependency
- Direct @google/genai sequential function-calling loop (aiBookingAgent) + guardrailed tool executor (executeTool) + channel-agnostic conversation router, wired into the Telegram webhook in place of Plan 02-02's static greeting — the load-bearing vertical slice that makes double-booking-proof, idempotent, cross-tenant-safe Greek booking conversations real
- Owner Telegram callback_query taps now drive real approve/reject/reschedule-cascade state transitions with identity verification and idempotent re-tap handling, plus a plain in-process poller that proactively expires and notifies clients on stale pending bookings — closing Phase 2's booking lifecycle end-to-end.
- Closed 4 CRITICAL gaps in the Gemini booking agent loop and tool executor: bounded MAX_TOOL_ROUNDS loop (CR-01), null-not-empty-string interactionId on rate-limit fallback (CR-06), per-call idempotency keys preventing double-booking merges (CR-02), and notification-failure isolation so cancel/reschedule never falsely report an error after the DB mutation already succeeded (CR-03a/CR-03b).
- Fixed `resolveHourToTime` in greek-preprocessor.ts to short-circuit on already-unambiguous 24-hour input (13-23), closing the code-review finding that let ordinary Greek phrasing like "στις 20" produce invalid clock times like "32:00" flowing into the Gemini-trusted system hint.
- Nested per-booking try/catch inside runExpirySweep's inner loop so one Telegram send failure no longer permanently silences notification for the rest of an already-expired batch
- Replaced the owner-approval callback_query handler's read-then-write race with a single atomic `UPDATE...WHERE bookingStatus='pending_owner_approval'...RETURNING` compare-and-swap, closing WR-05.
- 5 additive Neon columns (Google OAuth token, calendar-sync status/retry, agenda/reminder sent-state) plus a 9-function typed query layer with atomic UPDATE...WHERE...RETURNING claim guards preventing double-send/double-sync races.
- OAuth 2.0 consent flow + best-effort, non-blocking Google Calendar CRUD (googleapis SDK) wired into booking confirm/cancel/reschedule, with a 10-attempt in-process retry poller and a CSRF-guarded one-time fixture-setup CLI.
- Human-action checkpoint deferred — OAuth CLI tooling built and ready; tokens to be provisioned before end-to-end Calendar sync can be demonstrated live
- In-process 10-minute poller sending a Greek daily Telegram agenda to each business owner once per Athens calendar day, guarded by Plan 03-01's atomic `claimAgendaSlot` and DST-safe `isoDateInAthens` date arithmetic.
- DST-safe 24h/1h Telegram reminder sweep with permanent D-14 eligibility gates and noon-UTC-anchor calendar arithmetic, implemented as the 4th in-process Phase 3 poller alongside the expiry, calendar-sync, and agenda sweeps.

---
