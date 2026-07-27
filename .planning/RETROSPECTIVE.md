# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-07-09
**Phases:** 3 | **Plans:** 19 | **Tasks:** 32

### What Was Built

- Node/TypeScript webhook server on fly.io with Neon/Drizzle Postgres, Express, Pino logging, zod env validation — full project scaffold from zero
- WhatsApp Cloud API client + Telegram Bot API client + business-slug resolver enabling a single shared number to route clients to the right business
- Gemini 2.5 Flash-Lite AI booking agent with sequential function-calling: book, cancel, reschedule, check availability, answer questions — all in Greek, double-booking-proof, cross-tenant-safe
- Owner Telegram alert flow: new booking notification → accept/reject callback_query → CAS-guarded state transition; expiry poller cancels stale pending bookings after 2 hours
- Google Calendar OAuth 2.0 flow + sync service: confirmed bookings create events, cancellations delete them, reschedules update — with 10-attempt retry poller
- Daily 8am Athens-time owner agenda + DST-safe 24h/1h client reminders, all via atomic once-per-day/per-booking claim guards

### What Worked

- **Telegram-first pivot (D-01):** Unblocked all Phase 2-3 work when Meta Business Verification stalled. WhatsApp code was already wired; switching test channel was one decision, not a rewrite.
- **In-process pollers:** Keeping all background sweeps as `setInterval` in the same Node process (no cron, no Redis, no Supercronic) kept the stack at near-$0 and eliminated infrastructure complexity for a 1-business PoC.
- **Sequential Gemini calls + DB UNIQUE constraint:** Two-layer double-booking prevention — app-level serialization plus database-level constraint — caught edge cases that one layer alone would miss.
- **Atomic UPDATE...WHERE...RETURNING pattern:** Once established for the CAS guard (owner approval), the same pattern became the template for agenda and reminder claim guards in Phase 3 — no double-send races.
- **Milestone audit before close:** Running `/gsd-audit-milestone` before `/gsd-complete-milestone` surfaced the 6 tech debt items explicitly, enabling a clean `override_closeout` with documented gaps rather than an opaque close.

### What Was Inefficient

- **Meta Business Verification not submitted on day 1:** Per the original ROADMAP note, this should have been kicked off with Phase 1. Delay means the WhatsApp delivery gap persists into v1.1.
- **OAuth credential provisioning deferred:** The calendar sync code is complete but the end-to-end flow can't be demonstrated live without running `npm run setup-calendar`. Should be done immediately rather than deferring to "post-PoC."
- **Plan-level SUMMARY.md one-liners:** Some summaries captured task-level detail ("Task 1 — WhatsApp Cloud API client") rather than plan-level value. Makes MILESTONES.md accomplishments list more granular than useful.

### Patterns Established

- Read-before-claim ordering for all pollers: `list*` → `claim*Slot` (atomic) → `send*Message` — prevents double-send even under concurrent boot
- `resolveConflictOrTaken` shared helper for idempotent-replay vs genuine `slot_taken` disambiguation — reuse if booking conflict semantics expand
- `jest.setSystemTime()` (not `jest.spyOn(Date)`) for time-controlled tests — spyOn caused recursive stack overflow
- All config env vars pulled forward into the plan that first references them (not deferred to a later plan) — avoids `tsc` failure mid-wave

### Key Lessons

1. Submit external approvals (Meta BV, OAuth credentials) on day 1 of the phase that needs them — approval SLAs are measured in weeks, not hours.
2. A Telegram channel as a drop-in test surface for WhatsApp logic is a valid PoC strategy — same code, different SDK call at the boundary.
3. In-process pollers at 5-15 minute intervals are sufficient for a 1-business PoC; introduce Supercronic or a job queue only when the business count or reliability requirements grow.
4. Atomic `UPDATE...WHERE status='pending'...RETURNING` is the right pattern for any idempotent claim operation — establish it once and clone it across all similar sweep/notify flows.

### Cost Observations

- Model mix: ~100% Sonnet 4.6 (budget profile, all phases)
- Notable: budget profile handled full Greek NLP + Gemini integration planning without needing Opus

---

## Milestone: v1.1 — Per-Bot Infrastructure & Owner Onboarding

**Shipped:** 2026-07-17
**Phases:** 2 | **Plans:** 13 | **Tasks:** 25
**Code:** +3,571 / -654 lines | 5,162 total src/ LOC | 7 days

### What Was Built

- Telegraf migration: each business gets its own bot token; UUID-keyed webhook routing at `/webhooks/telegram/:webhookId` with HMAC constant-time verification
- AsyncLocalStorage RLS context threading: `withBusinessContext` injects per-transaction tenant identity into every Drizzle call, enforced at the PostgreSQL layer
- 25-step DB-backed owner onboarding state machine: bot token registration, `getMe`/`setWebhook` automation, business hours (including split-hours), services + prices, all via guided Telegram chat
- Platform bot 3-path routing (new owner / resume / re-registration) with unregister-then-register sequencing
- Owner edit flows post-onboarding (hours, services, prices) + removal of all hardcoded seed fixtures
- AI-powered owner agent (Gemini NLU), inline keyboard buttons, streamlined hours entry (3 quick-task improvements post Phase 5)

### What Worked

- **AsyncLocalStorage for RLS context:** Threading tenant identity through async Drizzle calls without modifying every function signature was the right call. Zero cross-contamination in tests, clean isolation in prod.
- **UUID webhook IDs:** Keeping bot tokens out of URL paths and logs eliminated a whole class of accidental token exposure. The UUID lookup table adds one DB read but is the correct security tradeoff.
- **DB-backed resumable onboarding:** Storing step state in `onboarding_sessions` (not memory) meant an owner's dropout mid-flow is completely invisible to them on resume — no complex session management.
- **Unregister-before-register sequencing (handleActivate):** Pre-emptive `deleteWebhook` before `setWebhook` prevented the "another webhook active" conflict on re-registration; established as a hard invariant.
- **Quick-task UX improvements:** The AI owner agent + keyboard buttons were 3 quick tasks that dramatically improved the onboarding experience without entering the full plan/execute cycle. Good use of the quick-task track.

### What Was Inefficient

- **Phase 4/5 planning docs archived before milestone close:** Commit `8f2f3ec` deleted the SUMMARY.md files, requiring a git-restore step during milestone close. Archive should happen during `milestone.complete`, not manually before.
- **Phase 6 requirement drift:** COMP-02/03/04/RESIL-01 were in the ROADMAP as Phase 6 but had already been moved to v1.3 in REQUIREMENTS.md — the ROADMAP wasn't updated. Led to a planning conflict at close time.
- **Plan count in milestone.complete:** The gsd-tools CLI reported "0 plans" because phase directories were already empty. Archiving phases before running `milestone.complete` breaks the plan-count aggregation.

### Patterns Established

- `botTokenStore.run()` wrapping pattern: every handler that dispatches per-bot logic must enter the AsyncLocalStorage context explicitly — even in tests (Jest auto-mock of `AsyncLocalStorage.run` returns undefined and silently skips the inner body)
- Schema-push via Node.js script (not drizzle-kit push) for `UNIQUE` constraint additions in CI-like environments — drizzle-kit push requires a TTY prompt that isn't available in automated flows
- RLS GRANT CONNECT migrations need dynamic DB name substitution — never hardcode `neondb` when the live Neon DB name may differ from local test DBs
- `res.status(200).send('OK')` before `await botTokenStore.run()` in platform webhook handler — respond before processing to prevent Telegram retries on slow `getMeBotInfo` calls

### Key Lessons

1. Keep ROADMAP.md and REQUIREMENTS.md in sync whenever requirements are deferred — don't let the two documents diverge silently.
2. Run `milestone.complete` CLI before manually archiving phase directories — the CLI needs the SUMMARY.md files in place to generate accurate accomplishment lists and plan counts.
3. `botTokenStore.run` in tests requires an explicit call-through mock, not Jest's auto-mock — the async context doesn't propagate through mocked `AsyncLocalStorage.run`.
4. Schema push for UNIQUE constraints: always check if drizzle-kit requires a TTY before using it in automated scripts; have a Node.js fallback ready.

### Cost Observations

- Model mix: ~100% Sonnet 4.6
- Notable: per-bot RLS + Telegraf migration planned and executed entirely on Sonnet budget profile

---

## Milestone: v1.2 — Billing & Membership System

**Shipped:** 2026-07-22
**Phases:** 3 (07, 08, 09) | **Plans:** 16 | **Tests:** 320 (112 new)

### What Was Built

- Owner creates billing packages, records payments, and manages memberships entirely via Telegram chat
- Session ledger with SELECT FOR UPDATE atomic deduction and idempotency-key UNIQUE replay protection
- Per-business enforcement policies (block/flag) enforced before every booking; flag alert delivered before owner keyboard
- 6-hour in-process expiry sweep with per-recipient UNIQUE dedup; clients query own balance via chat

### What Worked

- Wave 0 scaffolding (it.todo stubs) kept ts-jest green across all phases before implementations existed — pattern proven across 3 phases
- Extracting enforcement.ts from bookAppointmentTool made ENFC-02/03 unit-testable in isolation without booking context wiring
- DST-safe date arithmetic (isoDateInAthens + addCalendarDays) validated by dedicated test file — no off-by-one surprises at October boundary
- Gap closure plans (07-06, 07-07) after UAT surfaced real UX issues (hallucinated IDs, stale keyboards) — UAT → gap → re-verify cycle proved valuable

### What Was Inefficient

- Phase 08 re-verification needed: previous verification written before Plan 06 (Nyquist compliance) completed — verification timing should trail plan execution, not run concurrently
- No phase-level SUMMARY.md files generated (only plan-level) — 3-source audit cross-reference degraded to 2 sources; investigate why gsd-verifier didn't generate them
- Live Neon DB migration confirmations (0007, 0008) required human action each phase — consider a migration-apply task as explicit Wave 0 step in plans that add tables

### Patterns Established

- `getConn()` exclusively for billing writes (not `db.transaction()`) — db.transaction opens a separate connection that breaks withBusinessContext atomicity
- `sendTelegramMessage` flag alert NOT in try/catch — D-11 critical-path pattern; failure must surface
- clientPhone always from context (never Gemini args) for balance queries — cross-client inspection guard
- UNIQUE INDEX on (membership_id, notification_type, expiry_date) — proven dedup pattern for any notification sweep

### Key Lessons

1. SELECT FOR UPDATE serializes concurrent DB writes; onConflictDoNothing handles the idempotency race — compose both for bulletproof atomic operations.
2. Extract business logic into testable units (enforcement.ts) before wiring into booking context — enables isolated unit tests without complex mocking.
3. UAT after code review (not before) catches real UX issues that code review misses — always complete code review first, then UAT, then re-verify.

### Cost Observations

- Sessions: 3 phases, 145 commits since v1.1
- Model: Claude Sonnet 4.6 throughout
- Notable: billing system shipped with zero production incidents in local test DB; live Neon migration the only manual action required

---

## Milestone: v1.3 — Studio Session Scheduling & Slotless Bookings

**Shipped:** 2026-07-23 (retroactive entry — v1.3 never got a proper `/gsd-complete-milestone` close; no archive files exist, no retrospective was written at the time. Reconstructed from ROADMAP.md phase descriptions and git history during the v1.4 close.)

**Phases:** 6 (10-15) | **Plans:** ~20 (exact count lost with the missing archive)

### What Was Built

Session catalog + RRule-based recurring class scheduling (Phase 10), client session booking with atomic capacity enforcement (Phase 11), opt-in cancellation cutoff policy (Phase 12), slotless booking requests with owner approve/reject (Phase 13), renewal notification extensions (Phase 14), onboarding extensions for the new optional features (Phase 15).

### Key Lesson (the one that matters)

**A milestone can silently skip its close.** v1.3 shipped real, working code (confirmed — all downstream v1.4 phases depend on it and function correctly) but the `/gsd-complete-milestone` archival step never ran: no `v1.3-ROADMAP.md`, no `v1.3-REQUIREMENTS.md`, no retrospective entry. When v1.4 started, its `/gsd-new-milestone` flow created a fresh `REQUIREMENTS.md` that overwrote v1.3's live requirements file without archiving it first — permanently losing v1.3's exact requirement IDs and completion evidence. The only reason this was caught at all was the v1.4 milestone-close verification sweep cross-checking `init.manager` against actual phase directories.

**Actionable fix for future milestones:** `/gsd-new-milestone` (or `/gsd-new-project`) should hard-block starting a new milestone's REQUIREMENTS.md if the current one has unshipped-but-marked-complete phases without a corresponding milestone archive — don't let a new milestone silently begin on top of an unclosed one.

---

## Milestone: v1.4 — Single-Bot UX Overhaul

**Shipped:** 2026-07-24

**Phases:** 5 (16-20) | **Plans:** 16

### What Was Built

Platform bot removed — single per-business bot handles both admin and client traffic, routed by Telegram-ID match (Phase 16). Admin `/menu` with Settings/Classes/Clients/Today's-Agenda sub-menus, all binary decisions via Ναι/Όχι inline keyboards (Phase 17). Client `/start` menu with Book/My-Bookings/Cancel/Balance inline flows, free Greek chat still available (Phase 18). Class-schedule setup wired into owner onboarding + σεζόν→μάθημα terminology fix across 45 strings (Phase 19). Blocked-client escalation: Greek apology to client, inline admin notification with approve-exception button (Phase 20, reply-relay half deferred).

### What Worked

- The user's decision to verify phases 16/17/19 retroactively (they'd been executed but never code-reviewed or goal-verified) before closing the milestone — caught 3 real bugs that would otherwise have shipped silently
- Parallel background code-review + verifier subagents across independent phases cut wall-clock time significantly versus running them sequentially
- Cross-checking `gsd-tools query init.manager`'s `ALL_PHASES_VERIFIED` computed field against what ROADMAP.md claimed surfaced the phase 16/17/19 verification gap that would otherwise have been invisible

### What Was Inefficient

- Phases 16, 17, 19 were marked "complete" in ROADMAP.md/STATE.md during execution without ever running code review or goal-backward verification — the gap sat undetected until milestone close, three phases and one full day later
- Discovered mid-close that v1.3 never got a proper milestone archive either (see v1.3 entry above) — doc-integrity debt compounds when one milestone's close is skipped

### Patterns Established

- Retroactive verification sweep at milestone close: for any phase with `disk_status: executed` but no `VERIFICATION.md`, spawn code-review + verify agents before allowing the milestone to close, not just checking the currently-active phase
- Cross-tenant guard pattern: callback_query handlers must reuse the webhook-scoped `business` param (HMAC-verified upstream) rather than re-deriving via `findBusinessByOwnerTelegramId(senderTelegramId)`, which has no uniqueness guarantee across multiple businesses per Telegram account
- When an accepted/deferred gap survives verification (like ESCL-03's reply-relay), record it as an `override` block in the phase's VERIFICATION.md frontmatter (decision, decided_by, decided_at, note) rather than silently flipping status to passed — keeps the deferral auditable

### Key Lessons

1. **Run code review + verify-work per phase during execution, not deferred to milestone close.** All 3 bugs found this session (dead onboarding-routing code, ambiguous cross-tenant lookup, wrong Gemini model id) would have been caught immediately after the phase that introduced them, with much smaller blast radius, if verification had run when the phase was actually executed instead of accumulating across 3 phases and surfacing all at once weeks... well, hours later.
2. A model-id or config-value change hidden inside an unrelated commit (the σεζόν→μάθημα i18n commit that also silently bumped `gemini-2.5-flash-lite` to `gemini-3.5-flash-lite`) is exactly the kind of thing a scoped code review catches and a "looks like a strings-only diff" skim does not.
3. `git log --all --grep` for phase-scoped commit ranges is unreliable for computing diff bases — prefer reading actual commit messages/timestamps over pattern-matching grep when precision matters for stats.

### Cost Observations

- Sessions: 1 session covering phases 19-20 execution, code review, verification, and full v1.4 milestone close
- Model: Claude Sonnet 5 throughout, with Haiku for verifier subagents
- Notable: 3 real production bugs found and fixed during the milestone-close verification sweep alone — none would have been caught by the standard "did the tests pass" check, since all 3 had passing tests around the broken behavior

---

## Milestone: v1.5 — AI-Driven Owner Onboarding

**Shipped:** 2026-07-25

**Phases:** 1 (21) | **Plans:** 3

### What Was Built

The deterministic step-machine onboarding flow (`steps.ts`, `router.ts`) was replaced with `ai-onboarding-agent.ts` — a Gemini tool-calling agent matching `aiOwnerAgent`'s existing pattern. Owners can now answer multiple fields in one free-text Greek message (name + hours + services in a single turn); the old regex-gated hours parser (`HH:MM-HH:MM` only) that rejected valid colloquial input like "9 το πρωι με 9 το βραδυ και ενα διαλυμα απο 1 μεχρι 5" is gone. Resume is now stateless — the agent re-derives what's configured from live DB state (`computeOnboardingCompleteness`) every turn instead of tracking a step index in `onboarding_sessions`. Both Telegram entry points (typed message + callback_query) route to the new agent; old step-machine files and dead session-lifecycle query functions deleted.

### What Worked

- Building the new agent as a fully isolated, unit-tested module (Wave 1) before touching any live wiring (Wave 2) meant the risky "does Gemini tool-calling actually replace this flow" question was answered with 24 unit tests before a single production entry point changed
- Mirroring `aiOwnerAgent`'s existing tool-calling shape (same `MAX_TOOL_ROUNDS=5` cap, same `GEMINI_MODEL` export reused rather than duplicated) meant no new architectural pattern had to be invented — just applied to a second domain
- Code review caught one CRITICAL (CR-01: cross-tenant slug-uniqueness lookup silently defeated by RLS scoping) and four WARNING-level findings before verification, all fixed in a single follow-up commit — none shipped

### What Was Inefficient

- STATE.md's `milestone`/`milestone_name` frontmatter fields were stale/wrong going into this close (`v1.4`, garbled name fragment `"architectural gap)"` copy-pasted from a backlog item title) — required manual correction before `/gsd-audit-milestone` and `/gsd-complete-milestone` could run against a coherent version. Phase 21 had been executed as an ad-hoc "backlog follow-up" without ever going through `/gsd-new-milestone`, so it never got a real version number until close time.
- No `REQUIREMENTS.md` traceability table existed for this milestone — D-01/D-02/D-03 were tracked only in `21-CONTEXT.md`. The 3-source cross-reference audit step had to fall back to CONTEXT-vs-VERIFICATION comparison instead of the normal REQUIREMENTS-vs-VERIFICATION-vs-SUMMARY matrix.

### Patterns Established

- A phase executed outside the formal milestone lifecycle (no `/gsd-new-milestone` → roadmap → requirements chain) can still be closed cleanly by minting a new version number at close time and pointing `STATE.md` at it — but the audit and archive steps degrade gracefully rather than fully (no REQUIREMENTS.md traceability, single-phase "integration check" is a no-op since there's nothing to cross-wire)
- When `STATE.md`'s milestone frontmatter looks wrong (name fragment doesn't match current phase, version doesn't match ROADMAP.md's shipped list), stop and fix it before running audit/close tooling — the tooling trusts STATE.md as the source of truth for "which milestone am I closing"

### Key Lessons

1. Ad-hoc single-phase fixes that grow into full phases (this one started as "fix a regex bug," became a full step-machine replacement) should get a version number assigned at the point they're scoped as a phase, not retroactively at close time — avoids the STATE.md drift seen here.
2. Reusing an existing agent's exact shape (tool schema style, round cap, model constant) for a second agent is cheap insurance against config drift between the two — enforced here by literally importing `GEMINI_MODEL` rather than redefining it.

### Cost Observations

- Sessions: 1 session covering phase 21 execution (3 plans) + milestone versioning correction + audit + close
- Model: Claude Sonnet 5 throughout
- Notable: single CRITICAL code-review finding (RLS-scoping bypass on cross-tenant lookup) caught and fixed before verification — same category of bug class as v1.4's CR-01, suggesting "does this query run before or after entering `withBusinessContext`" deserves a standing code-review checklist item

---

## Milestone: v1.6 — Telegram Bot UX/Ops Improvements

**Shipped:** 2026-07-28

**Phases:** 4 (22-25) | **Plans:** 4

### What Was Built

Session-class bookings switched from auto-confirm to a real owner approve/reject flow (Έγκριση/Απόρριψη keyboard) with atomic capacity soft-hold and release-on-reject/expiry, reusing the slotless-request approval pattern from v1.3. Admin gained the ability to delete a scheduled lesson, cascading a clean cancel + credit restore + Greek notification to every affected client via a new shared `cascadeCancelSessionBookings` function. Both admin and client got a persistent Telegram menu button, and the owner now gets a best-effort technical diagnostic in their own chat whenever the bot's generic Greek fallback fires for a client. Owners can generate a shareable QR + `t.me/<bot_username>` deep-link invite from either the admin menu or free chat, sharing one `sendBusinessInvite` orchestration function. Outside the planned scope, the dormant WhatsApp Cloud API integration was fully removed (quick task), and two live-production debug sessions fixed real DB reliability bugs (a pg-pool checked-out-client error-listener gap that crashed the process, and a drizzle-orm client leak on a failed `begin` statement).

### What Worked

- Both Phase 22 (booking approval) and Phase 23 (lesson deletion) explicitly reused an already-proven pattern (slotless-request approve/reject keyboard; existing capacity-release SQL) instead of inventing a second approach — zero new architectural surface for either phase
- The two mid-milestone production incidents (webhook silent-hang, DB idle-in-transaction crash) were each root-caused with direct source reads of the actual installed SDK/driver code (not guessed from docs) and verified live in production before being marked resolved — both fixes held under a real recurrence of the triggering condition
- Phase 25's verification independently re-ran the QR generation and decoded the output with `jsQR` rather than trusting the implementation's own claim — caught nothing wrong here, but is the right level of rigor for a compose-an-image feature

### What Was Inefficient

- The `webhook-hang-no-reply.md` debug session's own frontmatter was left at `status: investigating` after its root symptom was fully fixed, because a distinct follow-on issue (CYCLE 4 candidate) was spun into two *separate* debug sessions rather than being folded back into this one's closure — the file sat as a false "open" item for 3 days until this milestone's audit caught it
- Phase 25's human-verification gap (physical QR phone scan) stayed unresolved for a day after code-verification passed 9/9 — the automated `jsQR` decode already gave strong confidence the QR payload was correct; closing the loop just needed the user's one-line confirmation, which should have been asked for immediately after verification rather than left as a dangling milestone-close blocker
- Milestone close surfaced 9 open audit items (2 stale debug sessions, 1 missing quick-task SUMMARY.md, 1 pending human-verify, 5 todos); 3 of the 4 non-todo items were each a 5-minute fix (write a summary, move a file, ask one question) that could have been done at the time they were created instead of accumulating

### Patterns Established

- When a debug session spins off a distinct follow-on issue into a new session, immediately update the original session's frontmatter `status` (and add a closeout note pointing to the new session) rather than leaving it open — the open-artifact audit treats "no explicit resolved status" as a real gap, not a soft one
- A quick-task's `SUMMARY.md` should be written in the same sitting as the last commit — writing it retroactively (as done here for 260726-0x3) is straightforward when commits are well-documented, but is pure avoidable rework if skipped in the first place

### Key Lessons

1. Closing a milestone with real "resolve first" intent (vs. blanket-acknowledging everything) is cheap when the open items are genuinely stale bookkeeping rather than unfinished work — 6 of 9 open items here were writable/archivable in under 15 minutes total, leaving only the todos (correctly deferred, since they're future-milestone material) and the human-verify (a one-line user confirmation) as truly external.
2. A todo explicitly titled "run X before scoping v-next" is a signal the milestone-close conversation and the next milestone's requirements-gathering conversation should be treated as one continuous handoff, not two disconnected steps.

### Cost Observations

- Sessions: 1 session covering phases 22-25 execution + 2 unplanned debug sessions + 1 quick task + milestone close
- Model: Claude Sonnet 5 throughout
- Notable: milestone close itself required as much back-and-forth as a small phase (9 open audit items triaged, PROJECT.md full evolution review, ROADMAP.md reorganization) — worth budgeting close-time proportional to elapsed milestone duration, not just phase count

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 3 | 19 | Initial build — established all core patterns |
| v1.1 | 2 | 13 | Per-bot routing + DB-backed onboarding state machine |
| v1.2 | 3 | 16 | Billing layer + enforcement + proactive notifications; Wave 0 scaffolding mature |
| v1.3 | 6 | ~20 | Session scheduling + slotless bookings — close never ran, exact count lost |
| v1.4 | 5 | 16 | Single-bot merge + menus + escalation; first milestone with a retroactive verification sweep at close |
| v1.5 | 1 | 3 | AI-driven onboarding replaces step-machine; ad-hoc phase retroactively versioned at close |
| v1.6 | 4 | 4 | Booking approval + admin power tools + invite generator; first close to run a full open-artifact audit (9 items triaged) |

### Cumulative Quality

| Milestone | Tests | TypeScript | Notes |
|-----------|-------|------------|-------|
| v1.0 | 208 | Clean | All 3 phases Nyquist-compliant |
| v1.1 | 28 test files | Clean | Full mock isolation; no real Telegram API or DB in CI |
| v1.2 | 320 (42 suites) | Clean | SELECT FOR UPDATE + UNIQUE dedup pattern established |
| v1.3 | unknown | unknown | No archive — figures lost |
| v1.4 | 344 total, 247 passing | Clean (src/) | 94 pre-existing test failures unrelated to v1.4 (stale fixtures, TS6200 collisions) — test-suite health debt flagged, not fixed |
| v1.5 | 36/36 (onboarding) | Clean | Full-suite figure not re-measured |
| v1.6 | not re-measured | Clean (src/) | 4 WhatsApp-only test files removed; v1.4's 247/344 figure no longer trustworthy — recommend a fresh full measurement early v1.7 |

### Top Lessons (Verified Across Milestones)

1. External human actions (Meta BV, OAuth) must start on day 1 — they gate delivery, not code.
2. Atomic claim guards prevent double-send/double-sync races — apply universally to any idempotent poller.
3. Keep ROADMAP.md and REQUIREMENTS.md in sync when deferring requirements — silent divergence creates planning confusion at milestone close.
4. Run `milestone.complete` CLI before archiving phase docs manually — the CLI needs SUMMARY.md files in place for accurate stats.
5. Wave 0 it.todo scaffolding pays off across 3+ phases — invest in stubs early, implement late, keep ts-jest green throughout.
6. UAT → gap plan → re-verify cycle catches real UX regressions that static code review cannot surface.
7. A milestone's `/gsd-complete-milestone` close can be silently skipped (v1.3) with no forcing function to catch it — the next milestone's fresh REQUIREMENTS.md just overwrites the unshipped one's history. Verify the archive step actually ran, don't just trust the ROADMAP.md "SHIPPED" badge.
8. A debug session that spins off a distinct follow-on issue into a new session must have its own frontmatter `status` updated at that moment — otherwise it sits as a false "open" item until the next milestone's audit catches it (v1.6).
9. Human-verification gaps backed by strong automated proxy evidence (e.g. `jsQR`-decoded QR payload matching exactly) are usually a one-line user confirmation away from closing — ask immediately rather than letting them become a milestone-close blocker (v1.6).
8. Phases executed without per-phase code review + verification accumulate risk invisibly — a milestone-close sweep that retroactively verifies every phase (not just the currently active one) is the last safety net, but it's much cheaper to catch bugs per-phase than to batch-discover 3 of them at once during close.
