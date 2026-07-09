# Phase 2: AI Booking Conversations & Owner Alerts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 2-AI Booking Conversations & Owner Alerts
**Areas discussed:** Messaging Channel Pivot, Booking Approval Scope, Owner Response Mechanism & Timeout, Slot Holding During Pending Approval, Availability Data Model

---

## Messaging Channel Pivot

User raised this unprompted, in place of any of the originally-proposed gray areas.

**User's choice:** Build Phase 2 against Telegram (Bot API) first. WhatsApp integration (Phase 1) shelved pending Meta Business Verification/publish gate. Viber ruled out — no self-service signup (commercial-only via Rakuten), conflicts with $0 budget.
**Notes:** Matches a prior decision already recorded in user memory (`messaging-channel-strategy`, decided 2026-07-08 in an earlier session). Structural implication: channel-agnostic core + adapter split, so WhatsApp can slot back in later without reworking booking logic.

---

## Booking Approval Scope

| Option | Description | Selected |
|--------|-------------|----------|
| New bookings only | Owner confirms/rejects new bookings; cancellations auto-processed, no owner veto | ✓ |
| Owner can reject cancellations too | Matches literal roadmap wording but contradicts BOOK-02 (cancel anytime) | |

**User's choice:** New bookings only (recommended option).

| Option | Description | Selected |
|--------|-------------|----------|
| Treat reschedule like a new booking | Needs same slot-confirmation as any new booking | ✓ |
| Auto-processed like a cancellation | Client can freely move appointment if new slot is free | |

**User's choice:** Treat like a new booking (recommended option).

| Option | Description | Selected |
|--------|-------------|----------|
| FYI alert, no action needed | Owner informed of auto-processed actions, no buttons | ✓ |
| No alert at all | Owner only finds out via agenda later | |

**User's choice:** FYI alert, no action needed (recommended option).

| Option | Description | Selected |
|--------|-------------|----------|
| "Pending owner confirmation" | Sets correct expectation, second message follows | ✓ |
| "Booking confirmed" immediately | Simpler but misleading if later rejected | |

**User's choice:** "Pending owner confirmation" (recommended option).

---

## Owner Response Mechanism & Timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Inline keyboard buttons | Telegram native buttons, one tap, unambiguous | ✓ |
| Text commands (e.g. /accept 12) | Simpler to implement, more error-prone | |

**User's choice:** Inline keyboard buttons (recommended option).

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-expire after N hours | Prevents indefinite slot limbo | ✓ |
| Stays pending indefinitely | Simplest, risks stuck slots | |

**User's choice:** Auto-expire after N hours (recommended option).

| Option | Description | Selected |
|--------|-------------|----------|
| 2 hours | Tight but generous enough for business hours | ✓ |
| 24 hours | More lenient, risks long same-day waits | |

**User's choice:** 2 hours (recommended option).

---

## Slot Holding During Pending Approval

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, temp hold | Locks slot immediately on pending row insert | ✓ |
| No, stays open until accepted | Risks double-promise, worse UX | |

**User's choice:** Yes, temp hold (recommended option).

| Option | Description | Selected |
|--------|-------------|----------|
| Released immediately | Slot freed right away on expiry/rejection | ✓ |
| Held a bit longer as a buffer | Added complexity, no clear PoC benefit | |

**User's choice:** Released immediately (recommended option).

---

## Availability Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed hours + 1 generic service | Simplest, defers real model to Phase 4 | |
| Per-day hours, still 1 service | Moderate middle ground | |
| Full model now (per-service durations + per-day hours) | More work now, no later migration | ✓ |

**User's choice:** Full model now — explicitly went against the recommended (simpler) default.
**Notes:** Reasoning: Phase 4's onboarding flow will write to this same schema rather than needing a later migration.

| Option | Description | Selected |
|--------|-------------|----------|
| 1-hour slots | Matches generic service duration, simple | ✓ |
| 30-minute slots | Finer granularity, more test combinations | |

**User's choice:** 1-hour slots (recommended option).

| Option | Description | Selected |
|--------|-------------|----------|
| Leave to planner/executor | Pick plausible services/hours | ✓ |
| I want to specify exact services/hours | User provides exact values | |

**User's choice:** Leave to planner/executor (recommended option).

---

## Claude's Discretion

- Exact Greek wording for all new Telegram messages (pending-confirmation, owner alert, expiry notice, confirmation/rejection replies).
- Exact schema/table design for the availability model (services table, business_hours table, columns).
- Telegram adapter internal structure (webhook handler shape, callback_query routing).
- Idempotency key format for Gemini function calls.
- Specific service names/durations and weekly hours seeded for the two Phase 1 fixture businesses.

## Deferred Ideas

- Per-business dedicated messaging accounts/numbers post-PoC (same discussion thread as the Telegram pivot).
- Bringing WhatsApp back online once Meta Business Verification clears.
- Cancellation cutoff windows (BOOK2-01, v2 requirement) — out of scope, cancellations stay unrestricted.
- Reviewed but not folded: todo `2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md` — concerns Phase 1 routing/business-identity, not Phase 2 booking-conversation logic.
