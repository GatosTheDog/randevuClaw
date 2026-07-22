# Architecture: Session Scheduling & Slotless Bookings (v1.3)

**Milestone:** v1.3 Studio Session Scheduling & Slotless Bookings
**Researched:** 2026-07-22
**Confidence:** HIGH

## Context: What v1.3 Adds

v1.2 shipped a billing system with memberships and session credits. v1.3 layersON TOP three new features:

1. **Session Catalog** — Pre-defined recurring sessions (e.g., "Monday 18:00–19:30 Pilates, 15 capacity")
2. **Slotless Booking Requests** — Clients request a time/date not in the catalog; owner approves → creates booking
3. **Cancellation Cutoff Policy** — Business can forbid cancellations within N hours; credit is forfeited if inside cutoff

**Not new:** Existing open-slot booking (v1.0–v1.2) remains unchanged. Both modes coexist per-business toggle.

---

## System Architecture Overview

### Current v1.2 Architecture (Baseline)

```
CLIENT SIDE (Telegram)
    ↓
routeConversationMessage
    ├─ (Gemini intent: book_appointment, cancel, reschedule, check_balance)
    └─ executeTool → existing bookings table + membership enforcement

OWNER SIDE (Telegram)  
    ↓
aiOwnerAgent (Gemini function-calling)
    ├─ update_hours, add_service, delete_service
    ├─ create_package, record_payment, view_client_membership
    └─ set_enforcement_policy

CALLBACK QUERY (owner taps Approve/Reject)
    ↓
handleCallbackQuery
    ├─ parseCallbackData → booking_id or billing callback pattern
    └─ updateBookingStatusIfPending + calendar sync + notifications

DATABASE (RLS enforced via withBusinessContext)
    ├─ bookings (open slots only)
    ├─ memberships, membershipLedger (session credits)
    ├─ billingPackages
    └─ membershipExpiryNotifications (dedup for alerts)
```

### v1.3 Additions

**New data models:**
- `sessions` — recurring session definitions
- `session_instances` — pre-expanded instances (e.g., next 90 days)
- `session_bookings` — client bookings into sessions (separate from `bookings` table for open slots)
- `slotless_requests` — client requests for slots not in catalog

**New business config columns (5 total):**
- `booking_mode`: 'open_slots' (default) | 'sessions' | 'hybrid'
- `cancellation_cutoff_enabled`: BOOLEAN DEFAULT false
- `cancellation_cutoff_hours`: INTEGER DEFAULT 8
- `last_session_threshold_enabled`: BOOLEAN DEFAULT true
- `last_session_threshold_count`: INTEGER DEFAULT 1
- `slotless_requests_enabled`: BOOLEAN DEFAULT false
- `allow_multi_booking`: BOOLEAN DEFAULT false

**Data flow integration:**
```
CLIENT: "Book me into Monday pilates"
    ↓ [if booking_mode='sessions']
Gemini NLU: intent='book_session' (NEW)
    ├─ session_id, date resolved
    └─ executeTool('book_session') → insertSessionBooking

CLIENT: "I want Thursday 19:00 (no open slot)"
    ↓ [if slotless_requests_enabled=true]
Gemini NLU: intent='request_slotless_booking' (NEW)
    ├─ service, preferred_date, preferred_time
    └─ executeTool('request_slotless_booking') → insertSlotlessRequest

OWNER: "I can do Thursday 19:30"
    ↓ [owner running aiOwnerAgent]
Gemini NLU: intent='approve_slotless_request' (NEW)
    └─ executeOwnerTool('approve_slotless_request', { slotless_request_id, decided_date, decided_time })
        ├─ Create bookings row (open-slot booking)
        ├─ Update slotless_requests (status='approved')
        └─ Alert client: "Request approved for Thursday 19:30"
```

---

## New Tables (Schema Changes)

### sessions

Pre-defined recurring or one-off sessions per business.

```sql
sessions {
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,               -- "Pilates", "Gym Class A", etc.
  service_id INTEGER REFERENCES services(id),  -- optional; for matching with services list
  recurring_pattern TEXT,           -- 'weekly' | null (one-off)
  day_of_week INTEGER,              -- 0–6 (JS getDay convention), nullable if one-off
  start_time TEXT NOT NULL,         -- "HH:MM" 24h Athens local
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL,        -- max simultaneous clients
  instructor_notes TEXT,            -- internal-only notes
  is_active BOOLEAN DEFAULT true,   -- soft-delete flag
  created_at TIMESTAMP DEFAULT now(),
  
  -- UNIQUE: one recurring session per (business, name, day_of_week) when is_active=true
  UNIQUE(business_id, name, day_of_week) PARTIAL WHERE recurring_pattern='weekly' AND is_active=true
}
```

**Why separate from services:**
- Sessions are class-like (time + capacity bounded); services are generic (e.g., "haircut — 60 min — €50")
- One session can span multiple services (cross-training class)
- Same service can appear in multiple sessions (e.g., "Pilates" at 18:00 and 19:30)

### session_instances

Pre-expanded fixed instances of recurring sessions (generated for next ~90 days).

```sql
session_instances {
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  calendar_date TEXT NOT NULL,      -- "YYYY-MM-DD" Athens local, frozen at instance creation
  start_time TEXT NOT NULL,         -- inherited from session.start_time (frozen for DST consistency)
  end_time TEXT NOT NULL,
  capacity_remaining INTEGER NOT NULL,  -- decremented as clients book (session_bookings created)
  is_cancelled BOOLEAN DEFAULT false,   -- owner can cancel a specific instance
  created_at TIMESTAMP DEFAULT now(),
  
  -- One instance per (session, calendar_date)
  UNIQUE(session_id, calendar_date)
}
```

**Rationale for pre-expansion:**
- Simplifies availability checking (no complex date range queries)
- Instances are immutable once created (if cancelled, is_cancelled=true, but row persists for audit)
- Cleanup sweep (weekly) can soft-delete old instances or hard-delete after N days

### session_bookings

Client bookings into session_instances (equivalent to `bookings` but for sessions).

```sql
session_bookings {
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),  -- denormalized for RLS efficiency
  client_phone TEXT NOT NULL,      -- Telegram from.id stringified (consistent with bookings.clientPhone)
  session_instance_id INTEGER NOT NULL REFERENCES session_instances(id),
  booking_status TEXT NOT NULL DEFAULT 'pending_owner_approval',  -- same enum as bookings
  check_in_status TEXT,            -- 'pending' | 'checked_in' | 'no_show' | null (future feature)
  requestId TEXT NOT NULL,         -- idempotency key (matches bookings.requestId pattern)
  created_at TIMESTAMP DEFAULT now(),
  
  -- Idempotency: globally unique request per client
  UNIQUE(client_phone, requestId),
  
  -- Slot capacity: only ONE client can book per instance at pending/confirmed status
  UNIQUE(session_instance_id, client_phone, booking_status) 
    PARTIAL WHERE booking_status IN ('confirmed', 'pending_owner_approval')
}
```

**Why separate table from `bookings`:**
- Open-slot bookings (v1.0–v1.2) are fundamentally different (time is user-provided, not pre-defined)
- session_bookings capacity is bounded (session.capacity); bookings have no inherent limit
- Allows querying "all booked sessions for a client" separately from "all ad-hoc bookings"
- Future: check-in tracking (sessions are attended live; ad-hoc bookings are flexible)

### slotless_requests

Client-initiated requests for booking times not in the session catalog (or outside business hours).

```sql
slotless_requests {
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  client_phone TEXT NOT NULL,
  requested_service_id INTEGER REFERENCES services(id),  -- nullable; client may not specify a service
  requested_date TEXT,              -- "YYYY-MM-DD" if specified (nullable)
  requested_time TEXT,              -- "HH:MM" if specified (nullable)
  request_text TEXT NOT NULL,       -- e.g., "Any time this week for a haircut?"
  request_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  resulting_booking_id INTEGER REFERENCES bookings(id),  -- if approved, link to created open-slot booking
  owner_response_text TEXT,         -- owner's approval confirmation or rejection reason
  responded_at TIMESTAMP,           -- when owner approved/rejected
  created_at TIMESTAMP DEFAULT now(),
  
  -- Prevent spam: one request per (client, text, date)
  UNIQUE(client_phone, request_text, created_at::date) PARTIAL WHERE request_status='pending'
}
```

**Integration with billing:**
- When owner approves: creates a `bookings` row (open slot booking)
- That booking row then flows through v1.2 enforcement + deduction logic
- If client already has active membership: session is deducted immediately (same as open-slot booking)

---

## New vs. Modified Files

### New Files (Must Create)

| File | Purpose | Dependency |
|------|---------|-----------|
| `src/sessions/queries.ts` | CRUD: listSessions, getSessionById, insertSessionInstance, listAvailableInstances, insertSessionBooking | schema.ts, database/db.ts, withBusinessContext |
| `src/sessions/session-manager.ts` | Recurring expansion logic: generateInstances(session, startDate, endDate), updateCapacityRemaining | sessions/queries.ts, timezone utils |
| `src/slotless/queries.ts` | CRUD: insertSlotlessRequest, updateSlotlessRequestStatus, listPendingRequests, listClientRequests | schema.ts, database/db.ts |
| `src/slotless/handlers.ts` | Business logic: approveSlotlessRequest(requestId, decidedDate, decidedTime) → creates bookings row | slotless/queries.ts, bookings insertBooking, enforement checks |
| `src/conversation/session-booking-tools.ts` | Gemini tools: book_session, request_slotless_booking, list_slotless_requests | sessions/queries.ts, slotless/handlers.ts, enforcement |
| `src/onboarding/session-owner-tools.ts` | Gemini tools: create_session, list_sessions, cancel_session (one-off or recurring), approve_slotless_request, broadcast_renewal_nudge | sessions/session-manager.ts, slotless/queries.ts |
| `tests/sessions.test.ts` | Unit tests: session availability, capacity decrement, recurring expansion, DST edge cases | sessions/session-manager.ts |
| `tests/slotless.test.ts` | Unit tests: request flow, approval with booking creation, rejection, duplication prevention | slotless/handlers.ts |
| `migrations/0000-add-sessions-v1.3.sql` | Drizzle migration: CREATE TABLE sessions, session_instances, session_bookings, slotless_requests + ALTER businesses ADD columns | — |

### Modified Files (Must Update)

| File | Change | Why |
|------|--------|-----|
| `src/database/schema.ts` | Add 4 table defs + 7 columns to businesses | Schema source-of-truth |
| `src/conversation/function-executor.ts` | Add book_session, request_slotless_booking, list_slotless_requests to tool registry; update Gemini system prompt NLU hints | Client-side tooling |
| `src/conversation/router.ts` | If allow_multi_booking: loop through multiple Gemini function calls in one turn | Support multi-booking |
| `src/onboarding/ai-owner-agent.ts` | Add 5 OWNER_TOOLS: create_session, list_sessions, cancel_session, approve_slotless_request, broadcast_renewal_nudge; extend executeOwnerTool switch | Owner-side tooling |
| `src/billing/queries.ts` | Add getLastSessionNotificationDate(membershipId) for renewal sweep dedup | Avoid duplicate renewal alerts |
| `src/pollers/expiry-sweep.ts` | Extend sweep to check last_session_threshold + insert membershipExpiryNotifications for renewal nudges | Implement renewal feature |
| `src/webhooks/telegram.ts` | Extend parseCallbackData to recognize slotless:<action>:<id> patterns (if adding keyboard UI later) | Optional: async approval UI |
| `.env.example` | Add feature flags (optional): BOOKING_MODE (open_slots|sessions|hybrid per business config in DB) | Configuration |

---

## Build Order & Dependencies

```
PHASE A: SCHEMA & CORE QUERIES
├─ 1. Drizzle migration: CREATE sessions, session_instances, session_bookings, slotless_requests
├─ 2. src/database/schema.ts: Add table definitions + 7 business config columns
├─ 3. src/sessions/queries.ts: Basic CRUD (list, get, insert)
├─ 4. src/slotless/queries.ts: Basic CRUD (insert request, update status)
└─ 5. tests/sessions.test.ts, tests/slotless.test.ts: Verify query contracts

PHASE B: BUSINESS LOGIC
├─ 6. src/sessions/session-manager.ts: Recurring expansion, capacity tracking
├─ 7. src/slotless/handlers.ts: approveSlotlessRequest → create bookings row + deduction
├─ 8. src/billing/queries.ts: Add getLastSessionNotificationDate (for renewal sweep)
└─ 9. tests: Integration tests (session → booking → calendar sync, slotless → approval → deduction)

PHASE C: CLIENT-SIDE GEMINI INTEGRATION
├─ 10. src/conversation/session-booking-tools.ts: Tool defs for book_session, request_slotless_booking, list_slotless_requests
├─ 11. src/conversation/function-executor.ts: Register tools, handle responses, add NLU hints to system prompt
├─ 12. Update src/conversation/router.ts for multi-booking loop (if enabled)
└─ 13. tests/conversation.test.ts: Gemini tool call flow

PHASE D: OWNER-SIDE GEMINI INTEGRATION
├─ 14. src/onboarding/session-owner-tools.ts: Tool defs for create_session, list_sessions, cancel_session, etc.
├─ 15. src/onboarding/ai-owner-agent.ts: Add OWNER_TOOLS array + executeOwnerTool cases
├─ 16. Update owner system prompt for session management intents
└─ 17. tests/onboarding.test.ts: Owner tool flow

PHASE E: POLLERS & ASYNC FLOWS
├─ 18. Extend src/pollers/expiry-sweep.ts: Add last_session_threshold check + renewal notifications
├─ 19. Optional: src/slotless/callbacks.ts for keyboard-based approval (if needed)
├─ 20. Optional: Extend src/webhooks/telegram.ts parseCallbackData for slotless patterns
└─ 21. tests/pollers.test.ts: Renewal sweep correctness

PHASE F: INTEGRATION & DOCUMENTATION
├─ 22. End-to-end test: Client books session → owner approves → calendar synced → membership deducted
├─ 23. End-to-end test: Client requests slotless → owner approves → booking created → deduction
├─ 24. End-to-end test: Client cancels within cutoff → credit forfeited
├─ 25. Update 07-PATTERNS.md with session booking patterns, cancellation cutoff logic
└─ 26. Update AI-SPEC.md with new Gemini intents + system prompts
```

---

## Architectural Decisions & Rationale

### Decision 1: Separate `session_bookings` Table

**Choice:** New table, not extension of existing `bookings`.

**Rationale:**
- Semantic clarity: sessions are bounded (capacity); bookings are unbounded
- Query simplicity: "Show me all sessions a client booked" is SELECT from session_bookings; "Show all ad-hoc bookings" is SELECT from bookings
- Audit trail: clients can see which are self-scheduled (bookings) vs. owner-approved (session_bookings)
- Future: check-in tracking makes sense for sessions (live attendance) but not ad-hoc bookings

**Trade-off:** Dual logic in owner alerts + calendar sync. Mitigation: abstract both into a common booking handler that accepts either row type.

---

### Decision 2: Pre-Expand Recurring Sessions to Instance Table

**Choice:** Generate `session_instances` for ~90 days at session creation; cleanup weekly.

**Rationale:**
- **Availability checking:** O(1) query on session_instances vs. complex date range + recurrence math
- **Immutability:** Instances are never modified (if session is cancelled, parent session marked inactive; existing instances soft-deleted)
- **DST safety:** start_time/end_time frozen at instance creation; no recalculation on DST boundaries

**Trade-off:** Must manage lifecycle (old instances deleted weekly). Mitigation: simple cleanup sweep, non-blocking.

**Alternative considered (dynamic expansion):** Calculate instances on-the-fly. **Rejected** because:
- Blocks availability query on timezone/DST calculation
- Gemini NLU indirection: no pre-enumerated sessions to show client ("What sessions are available?")

---

### Decision 3: Slotless Requests → Open-Slot Booking (Not Session Booking)

**Choice:** Owner approves slotless → creates `bookings` row (open slot), not `session_bookings`.

**Rationale:**
- Consistency: slotless is a request for a custom time outside the catalog
- Enforces uniqueness: owner decides the time; avoids conflicts with pre-booked session instances
- Reuses existing billing flow: deduction happens via existing bookAppointmentTool path

**Trade-off:** Slotless bookings never appear in "sessions booked by client" queries. Mitigation: separate queries for client visibility.

---

### Decision 4: Cancellation Cutoff: Check-at-Cancel-Time, Not Book-Time

**Choice:** Enforce cutoff policy when client cancels, not when booking is created.

**Rationale:**
- Business policy may change after booking (allow flexibility in PoC)
- Hard enforcement (no-show fees, deposit holds) is out-of-scope
- Deferring to cancel-time is simpler: only check when credit restore would happen

**Implementation:**
```typescript
if (business.cancellation_cutoff_enabled) {
  const hoursUntil = calculateHours(now, booking.calendarDateTime);
  if (hoursUntil < business.cancellation_cutoff_hours) {
    if (business.enforcementPolicy === 'block') {
      return { error: 'cutoff_expired', message: 'Too late to cancel' };
    }
    // else: allow cancel, but do NOT restore credit below
    creditForfeited = true;
  }
}
// After updateBookingStatus → cancelled:
if (!creditForfeited) {
  await restoreCredit(...);  // v1.2 logic
}
```

**Not enforced (future):**
- Mandatory deposits
- No-show fees
- Refund percentages (e.g., "80% refund if cancelled >24h before")

---

### Decision 5: Renewal Nudge Threshold: Configurable Per-Business

**Choice:** `last_session_threshold_count` INTEGER (default: 1).

**Rationale:**
- Pilates studio may nudge at 3 sessions; personal trainer at 5
- Singleton query: SELECT memberships WHERE sessions_remaining <= threshold
- Dedup: existing membershipExpiryNotifications UNIQUE index extended with notification_type

**Implementation:**
```sql
-- New notification_type values:
'7_day_client' | '7_day_owner' | 'last_session_client' | 'last_session_owner'

-- Poller sweep (every 30 min):
SELECT m FROM memberships m
WHERE m.sessions_remaining <= business.last_session_threshold_count
  AND m.is_active = true
  AND NOT EXISTS (SELECT 1 FROM membershipExpiryNotifications 
    WHERE membership_id = m.id 
    AND notification_type = 'last_session_client'
    AND expiry_date = isoDateInAthens(now()))
```

---

### Decision 6: Multi-Session Booking: Sequential, Not Parallel

**Choice:** Gemini can call `book_session` 3× in one turn; executor loops through sequentially.

**Rationale:**
- Prevents race conditions on capacity/deduction (no two threads concurrently reading session_instances.capacity_remaining)
- Matches existing bookAppointmentTool atomicity model (no parallelism)
- Idempotency keys remain unique per call: `${requestId}:${call.id}`

**Trade-off:** Slower for bulk bookings. Mitigation: client is unlikely to book >3 sessions in one message; if they do, Gemini naturally parses as sequential.

---

### Decision 7: Owner Chat-Based Slotless Approval (Not Keyboard UI, for Now)

**Choice:** Start with text-based approval: owner types "Thursday 19:30" → Gemini detects intent → tool runs.

**Rationale:**
- Simpler MVP: no new callback_query patterns to define/test
- Owner already trained on chat interface (v1.1 onboarding)
- Can add keyboard UI later (Approve/Reject buttons) if volume demands

**Future:** Extend `parseCallbackData` + handleCallbackQuery for `slotless:<action>:<id>` patterns.

---

## RLS & Multi-Tenancy

**Constraint:** All session/slotless queries must wrap in `withBusinessContext(businessId, async () => {...})`.

**Example (UNSAFE):**
```typescript
// Direct query — RLS bypassed!
const sessions = await db.select().from(sessionsTable).where(eq(sessionsTable.name, 'Pilates'));
// Returns Pilates sessions from ALL businesses!
```

**Example (SAFE):**
```typescript
// RLS enforced
return withBusinessContext(businessId, async () => {
  return await db.select().from(sessionsTable).where(eq(sessionsTable.name, 'Pilates'));
  // Drizzle automatically adds: WHERE business_id = (current_setting('jwt.claims.sub')::int)
});
```

**Capacity race condition:**
Two clients simultaneously book the last slot in a session_instance.

**Mitigation (existing pattern — UNIQUE partial index):**
```sql
UNIQUE(session_instance_id, client_phone, booking_status) 
  PARTIAL WHERE booking_status IN ('confirmed', 'pending_owner_approval')
```

Result: DB enforces that only ONE client can claim a pending slot per instance. Second client gets conflict → `error: 'slot_taken'`.

---

## Phase-Specific Research Flags

| Phase | Likely Deep-Dive | Reason |
|-------|------------------|--------|
| Sessions (Build) | Recurring expansion — DST handling | How to handle "Monday 18:00" when clocks spring forward? What's the semantic? |
| Sessions (Build) | Instance generation cadence | How far ahead? 90 days? 180? Auto-extend when entering final week? |
| Sessions (Build) | Session → Google Calendar sync | Create one recurring event per session or individual events per instance? |
| Slotless (Build) | Fuzzy session name resolution | Gemini NLU: handle typos? "Book pilates" vs. "Boot Pilates"? Fuzzy match? |
| Slotless (Build) | Async approval state machine | If adding keyboard UI: idempotency on "Approve" re-tap? Status transitions? |
| Billing (Integrate) | Cancellation cutoff ledger entries | Log "credit forfeited within cutoff" in membershipLedger or silent no-restore? |
| Pollers (Extend) | Renewal sweep performance | At 1000 memberships, query speed? Batch inserts or per-membership? |
| Onboarding (New) | UI for 7 business config columns | All chat-based Gemini tools? Or add web dashboard later? |

---

## Integration Checklist

- [ ] Schema: 4 new tables + 7 business columns
- [ ] Queries: Session/slotless query layer isolated from existing bookings
- [ ] Function Tools: `book_session`, `request_slotless_booking`, `list_slotless_requests` (client-side)
- [ ] Owner Tools: 5 new OWNER_TOOLS (session CRUD, slotless approval, renewal broadcast)
- [ ] Callback Routing: Optional extension to parseCallbackData for future slotless keyboard UI
- [ ] Pollers: Extend expiry sweep for renewal nudges
- [ ] RLS: All queries wrap in withBusinessContext; Drizzle RLS triggers apply
- [ ] Build Order: Schema → Queries → Business Logic → Client Tools → Owner Tools → Pollers
- [ ] Testing: Unit + integration tests for sessions, slotless, cancellation cutoff, DST edge cases
- [ ] Documentation: PATTERNS.md, AI-SPEC.md updates

---

## Constraints & Assumptions

- **Recurring:** Only weekly expansion for v1.3; daily/bi-weekly deferred
- **Cancellation:** No-show penalties or hard refunds out-of-scope
- **Multi-Session:** Sequential booking only; no bulk discount logic
- **Calendar:** Single shared calendar per business (no per-staff calendars)
- **Timezone:** All times stored as Europe/Athens local; DST handled by existing utils
- **Language:** Greek-only (matches v1.0 constraint)
- **Scope:** PoC ~50–200 clients/day; scaling assumptions in PROJECT.md Phase-Specific Notes

---

## Sources

**Existing codebase (v1.2 patterns):**
- src/database/schema.ts (Drizzle RLS, withBusinessContext)
- src/conversation/function-executor.ts (tool registry, executeTool dispatcher)
- src/onboarding/ai-owner-agent.ts (OWNER_TOOLS, executeOwnerTool, Gemini integration)
- src/webhooks/telegram.ts (parseCallbackData, callback_query routing, handleCallbackQuery)
- src/telegram/handlers/payment-flow.ts (billing callback routing pattern)
- src/pollers/expiry-sweep.ts (poller pattern, membershipExpiryNotifications dedup)

**v1.2 Architecture & Decisions:**
- .planning/PROJECT.md (Key Decisions D-03, D-06, D-08, D-10, D-11, D-15, WR-01, WR-05, T-02-17, T-07-01, T-07-05, T-07-06)
- .planning/research/ARCHITECTURE.md (v1.2 billing, RLS, atomicity patterns)

**Timezone DST Safety:**
- src/utils/timezone.ts (addCalendarDays, isoDateInAthens utilities — existing)

---

*Architecture research for RandevuClaw v1.3 Session Scheduling & Slotless Bookings*
*Researched: 2026-07-22 by Claude Research Agent*
