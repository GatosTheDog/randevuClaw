# Project Research Summary: Studio Session Scheduling & Slotless Bookings

**Project:** RandevuClaw v1.3
**Domain:** Class-schedule booking mode, slotless request approval, cancellation cutoff policy, renewal notification extensions for chat-native Greek fitness/wellness booking bot
**Researched:** 2026-07-22
**Overall Confidence:** HIGH

## Executive Summary

RandevuClaw v1.3 adds three interconnected feature clusters to the existing v1.2 session-credit billing system: **(1) Session Catalog** (fixed-capacity recurring classes like "Pilates Mon/Wed/Fri 10am, 15 spots"), **(2) Slotless Booking Requests** (clients request slots; owner approves/rejects), and **(3) Cancellation Cutoff Policy** (configurable forfeit windows). Renewal nudges extend the existing v1.2 expiry notification sweep.

**Recommended stack:** Add `rrule` v2.8.1 (RFC 5545 standard, battle-tested in Calendly/Google Calendar, 791K weekly npm downloads) for recurring session expansion. Reuse existing DST-safe timezone utilities (proven 6+ months in v1.2). Add 3 new Drizzle tables (`sessionCatalog`, `sessionInstances`, `slotlessRequests`) with 7 optional business config columns (all nullable/backward-compatible). All additions fit existing free tiers — no infrastructure cost increase.

**Six critical pitfalls:** capacity races (SELECT FOR UPDATE), slotless state machine orphaning (re-check membership at approval), DST cutoff bugs (use isoDateInAthens), booking mode switch orphaning (nullable session_id FK), Telegram rate limits (throttle broadcast), recurring expansion atomicity (eager + idempotency).

## Key Findings

### Stack

- **`rrule` v2.8.1** — only new package; RFC 5545 standard; 791K weekly npm downloads; used in Calendly/Google Calendar/Apple Calendar; native TypeScript types; ~8 KB gzipped server-side. Alternatives rejected (cron-parser too narrow, luxon too heavy, manual expansion fragile on DST).
- **Existing `timezone.ts`** — `isoDateInAthens()`, `addCalendarDays()` cover all cutoff window arithmetic; DST-safe; proven v1.2. No new date library needed.
- **Drizzle ORM (existing)** — 3 new tables via standard `pgTable` pattern; `SELECT FOR UPDATE` for capacity races (same as Phase 8 session deduction); RLS inheritance automatic via FK chain.
- **Telegraf callback_query (existing)** — slotless approval buttons reuse v1.2 owner-approval keyboard pattern; no new messaging library.
- **setInterval pollers (existing)** — renewal threshold sweep extends existing 6-hour expiry sweep; no new scheduler.
- **7 new business config columns** — all nullable defaults; backward-compatible; `open_slots` is the default `booking_mode` so existing businesses are unaffected.

### Features

**Table stakes (must ship — industry standard across Mindbody, Glofox, Acuity, Setmore):**
- Pre-defined recurring class sessions with date/time/capacity
- Owner creates recurring session template once → system auto-generates instances ~90 days forward
- Client books specific session; capacity tracked atomically
- Owner cancels individual session → all booked clients notified in Greek
- Owner assigns client to session directly → client notified
- Cancellation cutoff window with credit forfeiture; Greek confirmation dialog before forfeit
- Slotless booking requests (client request → owner approve/reject → booking)

**Differentiators (emerging, per-business opt-in):**
- Per-client slotless request history surfaced at check-in
- Last-session threshold nudge (sessions_remaining ≤ N triggers renewal notification)
- Owner mass renewal broadcast (throttled, 10 msg/sec)
- Multi-session booking in single request (`allow_multi_booking`)

**Anti-features / out of scope:**
- Waitlist auto-promotion (adds state complexity; defer to v1.4)
- Per-instructor or per-room scheduling (PoC scope)
- Recurrence patterns beyond weekly (daily/bi-weekly adds rrule complexity without clear PoC need)
- Buffer/advance booking limits (useful, lower priority)
- Session-level pricing overrides (future revenue lever)

**Critical edge cases:**
- DST boundary (Greece: Oct 25 2026 -1h, Mar 28 2027 +1h) — cutoff arithmetic must use wall-clock time, not UTC offset
- Slotless approval after membership expires — must re-check inside approval transaction
- Two clients simultaneously booking last capacity spot — DB UNIQUE constraint + SELECT FOR UPDATE
- Booking mode switch mid-operation — nullable `session_id` FK; mode-aware queries; existing bookings unaffected

**Chatbot UX patterns (Telegram):**
- Session listing: show date/time/capacity/booked count + action buttons
- Cancellation with cutoff: two-step Greek confirmation ("Θα χάσετε 1 session. Συνέχεια;")
- Owner approval: notify with client context (balance, membership validity); Ναι/Όχι keyboard
- Renewal nudge: specific Greek message ("Σας έχει απομείνει 1 session. Ανανεώστε σύντομα.")

### Architecture Integration

**New tables:**
| Table | Purpose | Key columns |
|-------|---------|------------|
| `session_catalog` | Recurring session template | `businessId`, `serviceId`, `dayOfWeek`, `startTime`, `capacity`, `rruleString`, `isActive` |
| `session_instances` | Pre-generated instances | `catalogId`, `sessionDate`, `sessionTime`, `bookedCount`, `isCancelled`, idempotency_key UNIQUE |
| `slotless_requests` | Approval queue | `businessId`, `clientPhone`, `requestedDate`, `requestedTime`, `status` (pending/approved/rejected), `bookingId` FK nullable |

**7 new businesses columns:**
`booking_mode`, `cancellation_cutoff_enabled`, `cancellation_cutoff_hours`, `last_session_threshold_enabled`, `last_session_threshold_count`, `slotless_requests_enabled`, `allow_multi_booking`

**Modified files:**
- `src/database/schema.ts` — 3 new tables + 7 new columns on businesses
- `src/billing/queries.ts` — `cancelBookingWithRefund` extended for cutoff check
- `src/conversation/function-executor.ts` — `bookAppointmentTool` gains session-booking path; `cancelAppointmentTool` gains cutoff confirmation step
- `src/onboarding/ai-owner-agent.ts` — new OWNER_TOOLS for session catalog management
- `src/telegram/telegram.ts` — slotless request approval callback routing

**Build order (each phase depends on prior):**
1. Schema + migrations (blocks all downstream)
2. Query layer (blocks business logic)
3. Business logic — session manager, cutoff enforcement, slotless approval (blocks Gemini tools)
4. Client Gemini tools — book_session, request_slot, cancel_with_cutoff (blocks E2E tests)
5. Owner Gemini tools — create_session, cancel_session, approve_request, renewal_broadcast
6. Pollers + onboarding extensions (depends on all above)

### Critical Pitfalls

| Pitfall | Severity | Prevention | Phase |
|---------|---------|-----------|-------|
| Capacity race (2 clients claim last spot) | HIGH | `SELECT FOR UPDATE` on session_instance + `UNIQUE(session_instance_id, client_phone)` | Session booking phase |
| Slotless approval orphaning (membership expires mid-approval) | HIGH | Re-check membership validity INSIDE approval transaction | Slotless phase |
| DST cutoff bug (Oct 25 -1h breaks hours-before-session math) | HIGH | Use `isoDateInAthens()` + `addCalendarDays()`; NEVER raw UTC offsets; test Oct 25 & Mar 28 | Cutoff phase |
| Booking mode switch orphans existing bookings | MEDIUM | Nullable `session_id` FK; mode-aware queries dispatch on flag; existing bookings unaffected | Schema phase |
| Telegram rate limit on mass broadcast | MEDIUM | Throttle to 10 msg/sec; pre-compose templates; background job not critical path; idempotency key | Renewal phase |
| Recurring expansion atomicity | MEDIUM | Eager hybrid + idempotent inserts (pattern from Phase 7 createMembership); UNIQUE idempotency_key on session_instances | Session catalog phase |

## Implications for Roadmap

### Recommended Phase Structure (continues from Phase 9 → starts Phase 10)

**Phase 10: Session Catalog & Schema** (foundation — all others blocked)
- Schema migration: 3 new tables + 7 business config columns
- `rrule` integration for instance pre-generation (~90 days)
- Owner creates/lists/cancels session catalog entries via OWNER_TOOLS
- Owner assigns client to session; Greek notification
- Nyquist test stubs for all CLSS requirements

**Phase 11: Session Booking Flow**
- Client books specific session via Gemini NLU (`book_session` tool)
- Session-aware enforcement (membership check + capacity check atomically)
- Session bookings deduct session credits via existing ledger
- Calendar event per session booking
- Concurrent capacity race test (SELECT FOR UPDATE proven)

**Phase 12: Cancellation Cutoff**
- `cancellation_cutoff_enabled/hours` on businesses table
- Cutoff check in `cancelBookingWithRefund` using DST-safe time comparison
- Two-step Greek confirmation dialog before forfeiture
- Credit restoration path (≥ cutoff) vs. forfeiture path (< cutoff)
- DST boundary tests (Oct 25 2026, Mar 28 2027)

**Phase 13: Slotless Booking Requests**
- `slotless_requests` table + approval state machine
- Client requests via Gemini tool → owner notified with Ναι/Όχι keyboard
- Approved → creates booking (re-checks membership inside transaction)
- Per-client request history + check-in surfacing
- Owner tools: list_pending_requests, approve/reject

**Phase 14: Renewal Extensions**
- `last_session_threshold_enabled/count` config
- Extend existing 6-hour expiry sweep: trigger when sessions_remaining ≤ threshold AND days_to_expiry ≤ 7
- Mass renewal broadcast (throttled, OWNER_TOOLS command)
- Per-client renewal reminder on demand

**Phase 15: Onboarding Extensions**
- 6 new onboarding questions (one per optional feature) with explicit defaults
- Post-onboarding config edits via existing "update config" chat entry point
- `booking_mode` switch safety gate (warn if existing bookings present)

### Open Questions Requiring Decisions Before Planning

1. **Recurring pattern scope:** Weekly-by-weekday only (Mon/Wed/Fri) vs. fully flexible rrule? Recommend weekly-only for MVP.
2. **Session capacity semantics:** Hard cap (block at capacity) vs. soft cap (allow over-booking with owner alert)? Recommend hard cap.
3. **Slotless credit handling:** Approved slotless booking consumes normal session credit (via existing ledger) vs. tracked separately? Recommend: consumes credit via existing ledger.
4. **Mass broadcast target:** "All near-expiry" (days_to_expiry ≤ 7 OR sessions_remaining ≤ threshold) vs. entire client list? Recommend: near-expiry only.
5. **`booking_mode` changeability:** Once set, lockable or changeable? Recommend: changeable but warn if existing session bookings exist.

## Sources

- [rrule npm package](https://www.npmjs.com/package/rrule) — RFC 5545 recurrence
- [Setmore: Class Booking Support](https://support.setmore.com/en/articles/490889-class-booking)
- [Glofox: Fitness Class Scheduling Software](https://www.glofox.com/blog/fitness-class-scheduling-software/)
- [Vibefam: Waitlist Conversions for Fitness Studios](https://vibefam.com/best-way-grow-your-fitness-studio-crm-booking-system-integration-for-waitlist-conversions/)
- [Apptoto: How to Write an Appointment Cancellation Policy](https://www.apptoto.com/best-practices/appointment-cancellation-policy)
- [SimplyBook.me: Handling Last-Minute Cancellations](https://news.simplybook.me/handling-last-minute-cancellations-policies-bottom-line/)
- [LoyaltyPass: Gym Member Retention Between Sessions](https://www.loyaltypass.co/blog/guide/guide/gym-member-retention-between-sessions)
- [Everfit: Session Credits & Expiry Management](https://help.everfit.io/en/articles/14698318-session-credits-manage-and-track-paid-client-sessions-beta)
- [Drizzle ORM Relations Documentation](https://orm.drizzle.team/docs/relations)
