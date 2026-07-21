# Phase 9: Expiry Notifications & Client Balance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-21
**Phase:** 9-Expiry Notifications & Client Balance
**Areas discussed:** Expiry sweep module, "7 days before" window logic, Client balance query behavior

---

## Expiry Sweep Module

| Option | Description | Selected |
|--------|-------------|----------|
| New file: src/scheduler/membership-expiry.ts | Sits alongside reminders.ts and agenda.ts — all scheduled tasks in one directory. No naming confusion with existing booking expiry poller. | ✓ |
| Extend src/conversation/expiry-poller.ts | Add runMembershipExpirySweep() alongside existing runExpirySweep(). Fewer files but naming becomes ambiguous. | |
| You decide | Claude picks the cleaner separation. | |

**User's choice:** New file src/scheduler/membership-expiry.ts
**Notes:** Avoids naming confusion — expiry-poller.ts handles booking expiry (different concept).

---

### Sweep Interval

| Option | Description | Selected |
|--------|-------------|----------|
| Every 6 hours | Sweeps 4×/day — balanced between freshness and DB load. | ✓ |
| Once daily at ~8 AM Athens time | Cleaner timing but requires time-of-day logic incompatible with locked no-cron stack. | |
| Every 15 minutes (same as reminder poller) | Overkill for a daily-granularity task. | |

**User's choice:** Every 6 hours
**Notes:** Daily-granularity task doesn't need sub-hourly polling.

---

## "7 Days Before" Window Logic

### Window calculation

| Option | Description | Selected |
|--------|-------------|----------|
| Rolling window: notify when ≤7 days remain | WHERE expiresAt <= now + 7 days AND no prior notification. DB UNIQUE prevents double-fire. Survives sweep downtime. | ✓ |
| Strict: notify only on exactly day 7 | Fragile — if fly.io is down that day, notification permanently missed. | |
| You decide | Claude picks. | |

**User's choice:** Rolling window
**Notes:** Safety over purity — missed sweep day should not silently skip notification.

---

### Dedup date column semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Notification date (today's Athens date) | Records when notification was sent. Would allow re-fire on consecutive sweep days. | You decide |
| Membership expiry date | Records which expiry event this covers. Re-fires correctly if membership renewed to new expiry. | |

**User's choice:** You decide (Claude picked: expiry date)
**Claude's decision:** `date` = Athens calendar date of `membership.expiresAt` via `isoDateInAthens()`. Rationale: Phase 7's membership upsert updates the same row on renewal (same membership_id, new expiresAt). Using expiry date in UNIQUE key means a renewed membership correctly re-notifies for its new expiry window. Using today's date would allow double-fire across consecutive sweeps.

---

## Client Balance Query Behavior

### No active membership reply

| Option | Description | Selected |
|--------|-------------|----------|
| Inform + suggest contacting business | "Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με [business name] για ανανέωση." | ✓ |
| Simple: no membership message only | "Δεν βρέθηκε ενεργή συνδρομή." — minimal, no call-to-action. | |

**User's choice:** Inform + suggest contacting business

---

### Unlimited membership reply

| Option | Description | Selected |
|--------|-------------|----------|
| Show expiry date + state unlimited sessions | "Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις [expiry_date]." | ✓ |
| You decide | Claude picks wording. | |

**User's choice:** Show expiry date + state unlimited sessions

---

### Tool placement

| Option | Description | Selected |
|--------|-------------|----------|
| function-executor.ts BOOKING_TOOLS | All client-facing Gemini tools live here. Consistent pattern. | ✓ |
| src/billing/tools.ts | Owner-facing billing tools live here — wrong audience for a client tool. | |

**User's choice:** function-executor.ts BOOKING_TOOLS

---

## Claude's Discretion

- `notification_type` column values: `'7_day'` for both client/owner rows, or `'7_day_client'`/`'7_day_owner'` for finer granularity — planner picks.
- `isRunning` guard in sweep: DB UNIQUE provides the dedup; guard may be unnecessary with 6-hour interval. Planner decides.
- Per-business outer loop ordering: reminders pattern recommended.
- Exact Greek message wording: templates provided in CONTEXT.md specifics; researcher/planner may refine.

## Deferred Ideas

- 30-day expiry notification tier — out of NOTF requirements scope
- Owner dashboard for near-expiry memberships — v1.3
- Inline renewal CTA button in expiry notification — v1.3
- WhatsApp notifications — deferred to v1.2+ WhatsApp milestone
