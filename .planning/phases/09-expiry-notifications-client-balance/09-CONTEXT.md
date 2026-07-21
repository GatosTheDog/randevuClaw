# Phase 9: Expiry Notifications & Client Balance - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Two distinct capabilities delivered in Phase 9:

1. **Proactive expiry sweep** — A new in-process poller (`src/scheduler/membership-expiry.ts`) sweeps for memberships expiring within 7 calendar days and sends Greek Telegram notifications to both the client and the business owner. Dedup prevents duplicate notifications per membership per expiry event.

2. **Client balance query** — A new Gemini tool `check_membership_balance` in `function-executor.ts` lets clients ask their session balance via chat in Greek and receive an accurate reply with sessions remaining and expiry date.

**No new booking flow changes.** Phase 8 handles booking enforcement and session deduction. Phase 9 is read-only relative to the booking flow.

</domain>

<decisions>
## Implementation Decisions

### Expiry Sweep Module (NOTF-01, NOTF-02, NOTF-03)
- **D-01:** New file `src/scheduler/membership-expiry.ts` — separate from `src/conversation/expiry-poller.ts` (which handles pending-booking expiry, a different concept). Sits alongside `reminders.ts` and `agenda.ts` in the scheduler directory.
- **D-02:** Poller interval: 6-hour `setInterval`. Runs 4× per day — balanced between freshness and DB load. Registered in `server.ts` alongside `startExpiryPoller()` and `startReminderPoller()`.
- **D-03:** Rolling window query: notify when `membership.expiresAt <= now + 7 calendar days` AND no prior `'7_day'` notification exists for this membership's current expiry date. This survives sweep downtime — if the app is down for 1–2 days, the next sweep catches up.
- **D-04:** Dedup table: `membership_expiry_notifications` with UNIQUE on `(membership_id, notification_type, expiry_date)`. `expiry_date` = Athens calendar date of `membership.expiresAt` (via `isoDateInAthens()`). Using the expiry date (not today's date) means: if a membership is renewed to a new expiry date (same `membership_id` via upsert), a new UNIQUE key fires the notification again — correct behavior.
- **D-05:** `notification_type` = `'7_day'` for both client and owner notifications. Two rows inserted per membership per expiry event: one for client, one for owner (or a single row with two send operations — planner decides which dedup granularity is cleaner).
- **D-06:** `botTokenStore.run(business.botToken, ...)` required inside the sweep, same as `expiry-poller.ts`. Pollers have no inherited AsyncLocalStorage context — must wrap Telegram calls explicitly.

### Client Balance Query (NOTF-04)
- **D-07:** New Gemini tool `check_membership_balance` added to `BOOKING_TOOLS` in `src/conversation/function-executor.ts`. Client-facing, read-only. Consistent with all other client tools (book, cancel, check availability).
- **D-08:** Three distinct reply scenarios:
  - **No active membership**: "Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με [business name] για ανανέωση." (Greek, with business name, call-to-action)
  - **Active unlimited-session membership** (`sessionsRemaining IS NULL`): "Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις [expiry_date]." (Show expiry date, state unlimited sessions)
  - **Active counted membership**: "Έχετε [N] μαθήματα απομείνει. Η συνδρομή σας λήγει στις [expiry_date]." (Sessions remaining + expiry date)
- **D-09:** Expiry date displayed in Greek format: `DD/MM/YYYY` (e.g., `14/08/2026`) for clarity with Greek users.

### Claude's Discretion
- Whether `notification_type` column uses one value (`'7_day'`) for both client and owner rows, or two values (`'7_day_client'` / `'7_day_owner'`) for finer granularity — planner picks cleaner schema.
- `isRunning` guard in the sweep: DB UNIQUE constraint provides the dedup, so an overlapping sweep doesn't re-send. An `isRunning` boolean guard (like the blocker note in STATE.md) is optional if the 6-hour interval makes overlapping sweeps practically impossible. Planner decides.
- Per-business vs per-client outer loop ordering: reminders poller uses a per-business outer loop; same pattern recommended for consistency.
- Greek message wording exact text (D-08 above gives the template; planner/researcher may refine).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/ROADMAP.md` §Phase 9 — goal, success criteria, dependencies
- `.planning/REQUIREMENTS.md` §NOTF-01..04 — locked requirements for this phase

### Existing Poller Pattern (MUST read before writing sweep code)
- `src/conversation/expiry-poller.ts` — canonical in-process poller pattern: `runExpirySweep()` + `startExpiryPoller()`, `botTokenStore.run()` wrapping, per-business + per-booking isolation via nested try/catch
- `src/scheduler/reminders.ts` — reminder poller: same structure, `startReminderPoller()` registration pattern
- `src/server.ts` — how pollers are registered at startup (lines 36–39)

### Schema & Billing Layer (Phase 7/8 artifacts)
- `src/database/schema.ts` — `memberships` table (expiresAt, sessionsRemaining, isActive, clientPhone, businessId, id), `membership_ledger` table, existing UNIQUE partial index `unique_active_membership`
- `src/billing/queries.ts` — `getActiveMembershipForDeduction()` (the active membership lookup to reuse or extend for balance query); `isoDateInAthens()` timezone util for expiry date formatting
- `.planning/phases/07-billing-configuration-payment-recording/07-CONTEXT.md` — Phase 7 schema decisions (D-10: one active membership per client per business; D-11: expiry as `TIMESTAMP WITH TIME ZONE`)
- `.planning/phases/08-enforcement-session-deduction/08-CONTEXT.md` — Phase 8 decisions (D-06: unlimited = `sessionsRemaining IS NULL`)

### Timezone Utility
- `src/utils/timezone.ts` — `isoDateInAthens()` for Athens calendar date from timestamp; `addCalendarDays()` for 7-day window calculation

### Client Tool Pattern
- `src/conversation/function-executor.ts` — `BOOKING_TOOLS` definition + tool handler dispatch pattern; all client Gemini tools live here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getActiveMembershipForDeduction()` in `billing/queries.ts`: returns `{id, sessionsRemaining, expiresAt, businessId}` — extend or create a parallel `getActiveMembershipForBalance()` that also returns `clientPhone` / `businessId` for the notification sweep
- `isoDateInAthens(date: Date): string` in `timezone.ts`: converts timestamp to Athens calendar date string — use for `expiry_date` column in dedup table and for display formatting
- `botTokenStore.run(token, fn)` in `telegram/client.ts`: mandatory wrapper for Telegram calls from pollers
- `onConflictDoNothing()` Drizzle pattern: established in Phase 7 ledger inserts — same pattern for `membership_expiry_notifications` dedup insert
- `listAllBusinessIds()` in `database/queries.ts`: outer loop for per-business sweep (same as `expiry-poller.ts`)

### Established Patterns
- In-process `setInterval` + per-business try/catch isolation: `expiry-poller.ts` is the canonical template
- `BOOKING_TOOLS` addition: add tool definition to the `tools` array, add handler case to the dispatcher switch in `function-executor.ts`
- Greek error messages follow the established format from Phase 5 onboarding and Phase 8 enforcement

### Integration Points
- `server.ts`: register `startMembershipExpiryPoller()` alongside existing pollers
- `function-executor.ts`: add `check_membership_balance` tool definition to `BOOKING_TOOLS` and handle in the tool dispatcher
- New schema migration: `membership_expiry_notifications` table (migration number after Phase 8's last migration)

</code_context>

<specifics>
## Specific Ideas

- Greek message for no-membership balance query: "Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με [business name] για ανανέωση."
- Greek message for unlimited membership: "Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις [DD/MM/YYYY]."
- Greek message for counted membership: "Έχετε [N] μαθήματα απομείνει. Η συνδρομή σας λήγει στις [DD/MM/YYYY]."
- 7-day client notification (NOTF-01): include sessions remaining + expiry date in the message
- 7-day owner notification (NOTF-02): include client name (from `clientBusinessRelationships.client_name`) + their sessions remaining + expiry date
- Expiry date displayed as `DD/MM/YYYY` in all Greek-facing messages

</specifics>

<deferred>
## Deferred Ideas

- 30-day expiry notification (a second notification tier) — out of scope for v1.2; NOTF requirements only specify 7 days
- Owner dashboard showing all near-expiry memberships at once — v1.3
- Client renewal flow triggered by the expiry notification (inline "contact owner" button) — v1.3
- Push notification via WhatsApp (v1.2 deferred WhatsApp milestone) — v1.2+

</deferred>

---

*Phase: 9-Expiry Notifications & Client Balance*
*Context gathered: 2026-07-21*
