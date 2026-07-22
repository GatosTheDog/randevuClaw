# Feature Landscape: Session Scheduling & Slotless Bookings for Chat-Native Appointment Booking

**Domain:** Fitness studio & class-based appointment booking with configurable session management
**Researched:** 2026-07-22
**Research Mode:** Ecosystem (SaaS fitness scheduling, chatbot booking UX, class management patterns)
**Overall Confidence:** HIGH

---

## Executive Summary

Session scheduling (fixed-capacity class sessions, recurring patterns) and slotless booking requests (waitlist-like approval workflows) are emerging table-stakes in boutique fitness booking software. The landscape distinguishes between two fundamental booking modes:

1. **Open Slots Mode (v1.2 — current):** Clients book any available time on a continuous timeline (e.g., "Book any free 1-hour slot Fri 2–5 PM").
2. **Fixed Session Mode (v1.3 — new):** Owner pre-defines recurring class sessions with fixed capacity and times (e.g., "Pilates Mondays 10 AM, 12 PM, 6 PM; max 12/session"). Clients pick a specific session or join a waitlist if full.

Key findings:

- **Recurring class management** is standard across Mindbody, Glofox, Vibefam, Setmore: define weekly patterns once, auto-generate sessions for 4–12 weeks forward.
- **Capacity + Waitlists** go together: when a session fills, clients can request to join a waitlist; on cancellation, the first waitlisted client is notified (auto or manual).
- **Slotless requests** are an emerging pattern (not universal) where clients request a slot outside open availability; owner can approve/reject, converting it to a confirmed booking. This bridges the gap between "fully booked" and "no capacity" scenarios.
- **Cancellation cutoff policies** (24–48h before session) are ubiquitous but configurable per business. Enforcement is binary: forfeit credits within window, or restore if beyond window.
- **Renewal nudges** follow a tiered timeline: 60, 30, 14, 7 days before expiry, with optional session-count thresholds ("Nudge when 1 session left" or "When 3 sessions left AND 7 days to expiry").
- **Per-business configuration** is critical: each business must opt into modes, set thresholds, configure notification cadence, and enable/disable features individually.
- **Chatbot UX for these flows** requires clear state feedback (e.g., "This session is full. Want to request a spot? [Yes/No]"), explicit confirmations for forfeit-risk cancellations, and readable session listings (capacity, times, instructor if available).
- **Greek-specific nuance:** Greek fitness studios are smaller, owner-operated boutiques; they value personal touch over automation. Expect high reliance on owner approval flows and manual intervention. WhatsApp/Telegram remain primary communication channels.

---

## Table Stakes Features

Features users expect in any fitness studio booking app with class-based sessions.

| Feature | Why Expected | Complexity | Behavior | Chatbot UX Notes |
|---------|--------------|------------|----------|------------------|
| **Session Catalog (recurring class schedule)** | Studios run fixed classes (Pilates Mon/Wed/Fri 10am, Yoga Tue/Thu 6pm). Must be queryable in booking flow. | Medium | Owner defines recurring class template (e.g., "Pilates 60m, capacity 12, Mon/Wed/Fri 10am"). System auto-generates instances for 4–12 weeks. Client sees list of upcoming sessions with time, capacity, instructor. | Show sessions as a **list with clear times, capacity status, and action buttons** ("Book this session" or "Request a spot if full"). Format: "🕐 Mon 10 AM — Pilates (11/12 spots)" or "❌ FULL — Request a spot". |
| **Session capacity limits** | Prevents overbooking; protects instructor-to-client ratio. | Low | On session creation, set max_capacity (e.g., 12). On booking confirm, check current_booked >= max_capacity. If full, prevent booking unless waitlist enabled. | Dynamically update capacity display as bookings happen. "12/12 spots booked — join waitlist?" |
| **Booking within session (not time range)** | Client picks a specific session, not a time window. Simpler for owner, clearer for client. | Low | Session.id is foreign key on booking. On book, verify session.start_time > now() + buffer and session.current_booked < session.max_capacity. | Client clicks "Book Pilates Mon 10 AM" → confirm → done. No ambiguity. |
| **Recurring session generation** | Owner doesn't want to create 52 Pilates sessions manually. Auto-recurrence is standard. | Medium | Session recurrence template: (business_id, name, duration, capacity, recurrence_pattern='WEEKLY', recurrence_days=['MO','WE','FR'], end_date). On save, generate session records for next N weeks. | Owner: "Create recurring: Pilates, Mon/Wed/Fri 10am, 12 spots, 12 weeks" → bot confirms schedule auto-generated. |
| **Waitlist (full session handling)** | Industry standard (Mindbody, Acuity, Glofox): full session → join waitlist. No revenue loss; conversion tracked. | Medium | On session full, offer: "Join waitlist? We'll notify you if a spot opens." Store client in `slotless_requests` or `waitlist` with status='waiting'. On cancellation, find first waiting client, notify, auto-confirm if they accept. | "This session is full (12/12). **Request a spot?** [Yes/No]" → "You're #2 on the waitlist. We'll message you when a spot opens." |
| **Owner assigns client to session (for walk-ins, phone bookings)** | Owner receives call: "Can I book Pilates Friday 10am?" Owner records directly without client using chat. | Medium | Owner: "Book Alexios for Pilates Fri 10am" → bot checks capacity, confirms, sends Alexios confirmation message. Deducts session credit. | Owner message: "Book [client name] [session]" → bot confirms, notifies client. Handles if full (offer approval or waitlist). |
| **Session cancellation by owner (mass notify)** | Instructor sick, equipment broken → owner cancels entire session. All booked clients must be notified with alternative options. | Medium | Owner: "Cancel Pilates Mon 10am session — reason: instructor illness" → bot marks session.status='cancelled', queries all bookings for this session, sends each client: "Your Pilates session Mon 10am is cancelled. We offer: [alternative sessions]. Book now?" Refund credits immediately. | Owner: "Cancel [session name]" → bot confirms, sends template message to all booked clients with alternatives. Log reason. |
| **Check-in surfacing (slotless count display)** | On check-in day, owner/client wants to see how many are attending and if there are waitlisted/slotless clients requesting approval. | Low | On session.start_date, query: booked count, waitlist count, slotless_requests pending approval. Display: "Today's Pilates 10am: 10 booked, 2 waitlisted, 1 approval request (João wants to join)". | Client check-in: bot displays their session + day's occupancy. Owner check-in alert: "@Owner: João is requesting to join today's Pilates (11/12 spots). Approve? [Yes/No]" |
| **Membership enforcement per session** | Client tries to book but has no active membership. Enforcement (block vs flag) applies per session booking too. | Low | Before confirming booking, check membership validity. If no valid membership and business.enforcement='block', reject: "No active membership. See balance." If 'flag', allow but alert owner. | Error message if blocked: "You need an active membership to book. Current balance: 0 sessions. Ask owner for package pricing." |

---

## Differentiators

Features that set product apart. Not expected, but valued by power users or studios optimizing for retention.

| Feature | Value Proposition | Complexity | Market Presence | Chatbot UX Notes |
|---------|-------------------|------------|------------------|------------------|
| **Slotless booking requests** | Client requests a session that's fully booked or outside hours. Owner approves/rejects. Bridges "no availability" gap without manual back-and-forth. | Medium | Emerging pattern; not universal. Whautomate mentions "auto-notify waitlist on cancellation" (auto-accept). Fewer products document explicit approval workflow. | "Full session. Want to **request a spot?** Owner will approve." If approved: "Your request approved! Booked for Pilates Mon 10am." If rejected: "Sorry, owner can't accommodate. Try another session?" |
| **Per-session pricing override** | Package covers 10 sessions €50. Premium Pilates session charges €7 extra; budget sessions charge €3 less. | High | Not found in research. Interesting revenue lever but operational complexity high. | Owner might need: "Session pricing: regular (€0 extra), premium (€7 extra)." Client sees at booking: "Pilates Mon 10am (Premium +€7)". |
| **Instructor-specific bookings** | Client can book with specific instructor (e.g., "Book Pilates with Maria, not someone else"). | High | Standard in mature platforms (Mindbody, Zen Planner) but adds complexity: per-instructor availability, scheduling conflicts, profile management. | Client: "Show me sessions with [instructor name]." Session display: "🧑 Pilates Mon 10am — with Maria". |
| **Session notes / class descriptions** | Owner adds details: "Today's Pilates focus: core strengthening, bring mat." Clients see before booking. | Low | Common in boutique fitness (Glofox, Vibefam mention class descriptions). Builds hype. | Session display: "🧘 Pilates Mon 10am (12 spots) — Today: Core focus, intermediate level. Bring mat." |
| **Buffer before booking (advance limit)** | Can only book sessions starting N hours or days away (e.g., "No bookings within 2 hours of start"). | Low | Standard in Mindbody, Acuity. Prevents last-minute chaos, gives owner buffer to manage. | If client tries to book session starting in <2h: "Sorry, this session is too soon to book. Our next available: [next session]". |
| **Booking window limit (ahead limit)** | Can only book sessions up to N weeks in advance (e.g., "Book max 4 weeks ahead"). | Low | Standard (Acuity, ClassPass). Encourages regular re-booking; keeps client engagement high. | If client tries to book 6 weeks out and limit is 4: "Our booking window is 4 weeks ahead. Next available sessions: [list up to 4 weeks]". |
| **Renewal nudge triggered by session threshold** | Instead of just calendar days, nudge when client has last N sessions remaining AND expiry is within M days. E.g., "1 session left + 7 days to expiry" → nudge. | Medium | Mentioned in research (Everfit session-credit thresholds). More targeted than calendar-only nudges. | Client: "You have 1 session left and it expires in 7 days. Renew now to avoid losing access." [Renewal details] |
| **Multi-session per week limits (enforcement)** | Membership includes "up to 3 sessions per week"; bot prevents booking 4th session in the same week. | Medium | Standard in fitness (Orangetheory offers 1, 2, 3, 4 sessions/week tiers). Requires weekly quota tracking. | If client tries to book 4th session in a week and limit is 3: "You've reached your weekly limit (3/3). Next available slot is next week on [date]." |
| **Rescheduling within same validity window (optimize)** | Client reschedules from Mon 10am → Tue 2pm; both within same membership validity. No additional deduction; 1 credit used total. | Medium | Documented in v1.2 FEATURES.md as "atomic restore + rebook". Ensure it works seamlessly in session-mode too. | Client cancel Mon session + rebook Tue session → "You've been moved. 1 session used total (still showing X remaining)." |

---

## Anti-Features

Features to explicitly **NOT** build (or defer to post-v1.3).

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Automatic waitlist → booking conversion** | When a cancellation happens, auto-book the first waitlist client and deduct credits without owner approval. High risk: client didn't actively re-confirm, might lose credits unexpectedly. Fraud surface (clients gaming the system). | Manual approval: notify owner "João is #1 on the waitlist for cancelled spot. Auto-convert? [Yes/No]" + notify João "Your spot is available — confirm to book? [Yes/No]". Client must actively accept. |
| **Dynamic pricing per session** | "This session is 90% full, so booking now costs 10% more" or "Early morning sessions €5 off." Clever for revenue, but creates pricing complexity and client frustration. | Static per-session pricing or per-package pricing only. No surge pricing. |
| **Instructor-to-client ratio enforcement** | Auto-block bookings if instructor has too many private sessions scheduled + class sessions. Complex scheduling constraint. | Manual: owner ensures instructor availability. Warn owner if instructor overbooked via alert, but don't auto-reject. |
| **Session swaps between clients** | Client A booked Mon 10am, Client B booked Tue 2pm. They negotiate: "Let's swap." System auto-swaps bookings. | No swap logic. If client wants a different session: (1) cancel current booking (restore credit), (2) book new session (deduct credit). Two-step, transparent. |
| **"Overbooking mode" (oversell capacity)** | Owner can overbook a session (e.g., 15 bookings in a 12-capacity session) for high-demand classes. | Hard cap on capacity. If full, waitlist only. Overbooking = operational chaos in small studios + client disappointment on day-of. |
| **Seasonal session templates** | "Summer schedule: different classes June–Aug; Winter schedule Sept–May." Auto-swap calendars. | One active schedule per business. To change schedule, owner manually creates new sessions + cancels old ones. Rare enough that manual is acceptable. |
| **Timed class series / packages** | "4-week Pilates series, must book all 4 together." Booking lock-in. | Single-session bookings only. No enforced series. Client can book individually. |
| **Session transfer to another client** | "I bought 10 sessions but I can't use them all. Give to my friend." | No transfers. Credits are personal to the client. Alternative: owner records payment for friend separately. |
| **Auto-reschedule on no-show** | Client doesn't check in for a session → bot auto-reschedules to next available session. | No auto-reschedule. No-show deducts credit (already configured in v1.2 policy block/flag). Manual rescheduling only. |
| **Seasonal pricing tiers** | "Summer classes €10, winter classes €5." Price tiers per session. | No seasonal pricing. Single package pricing per business. |
| **Attendance-based rewards (badges, points)** | Client attends 10 sessions → unlock free session or discount. Gamification. | Out of scope. Focus on core booking + renewal nudges. |

---

## Feature Dependencies

Clear dependency graph. Helps with phasing.

```
┌─ Session Catalog (owner creates recurring sessions)
│   ├─ Session Capacity Limits
│   ├─ Booking within session (not time range)
│   ├─ Recurring session generation (auto-create for N weeks)
│   │
│   ├─ Waitlist / Slotless Requests
│   │   └─ (when session full, route to approval or auto-queue)
│   │
│   └─ Session Cancellation by Owner
│       └─ Mass notify + auto-refund credits
│
├─ Cancellation Cutoff Policy (per-business opt-in)
│   ├─ Configurable hours-before-session window (default 24h)
│   ├─ Credit forfeited <cutoff (implicit: restored ≥cutoff)
│   ├─ Greek confirmation + explicit forfeit warning
│   └─ (Already built in v1.2; extend to sessions)
│
├─ Renewal Notification Extensions (per-business opt-in)
│   ├─ Last-session threshold (opt-in, default 1)
│   ├─ Mass broadcast to near-expiry clients
│   └─ Per-client single-session renewal reminder
│
├─ Per-Business Configuration (settings)
│   ├─ booking_mode (open_slots vs fixed_sessions) — default: open_slots (v1.2 behavior)
│   ├─ slotless_requests_enabled (default: off)
│   ├─ allow_multi_booking (default: off; prevents booking >1 session/week if enabled)
│   ├─ cancellation_cutoff_enabled + hours (default: off)
│   ├─ last_session_threshold_enabled + count (default: off)
│   └─ (All editable via chat post-onboarding)
│
└─ Membership Enforcement on Session Booking
    ├─ Block vs Flag policy (already v1.2)
    └─ (Applies unchanged to sessions)
```

**Critical Path:**
1. Session Catalog + Booking within session must come first (enable fixed-session mode).
2. Cancellation Cutoff Policy must be solid before Renewal Notifications (otherwise, confusing messaging around credit forfeiture).
3. Slotless Requests and Renewal Nudges are independent; can run in parallel.
4. Per-Business Configuration (settings UI/chat) must be refactored to expose new flags.

---

## Edge Cases & Gotchas

### Tier 1: Critical (causes silent data corruption or revenue loss)

1. **Concurrent bookings in same session (race condition)**
   - Two clients simultaneously request the last spot in a session (capacity 12, currently 11 booked).
   - Both check: 11 < 12 ✓. Both confirm. Result: 13 bookings for capacity 12.
   - **Prevention:** DB `SELECT...FOR UPDATE` on session.current_booked during booking confirmation. Serialize at DB level.
   - **Detection:** Load test: 2 concurrent requests, same session, capacity=1. Verify only one succeeds.

2. **Cancellation cutoff vs session time boundary**
   - Cutoff is 24 hours before session. Session starts Mon 10:00 AM.
   - Client cancels Sun 11:00 AM (not yet 24 hours). Should NOT forfeit (still ≥24h).
   - Client cancels Mon 9:00 AM (< 24h). SHOULD forfeit.
   - **Danger:** Off-by-one errors in `now() vs session.start_time - 24h` comparison. Use `<=` or `<` consistently.
   - **Prevention:** Expiry check: `if now() > session.start_time - INTERVAL '24 hours' THEN forfeit; ELSE restore;`. Store cutoff in hours (not magic numbers).
   - **Detection:** Test boundary: book session Mon 10am. Try cancel Sun 9:59 AM (should restore) vs Sun 10:01 AM (should forfeit). Include Greece TZ (UTC+2 May–Oct, +1 Nov–Apr).

3. **Recurring session generation with DST transitions**
   - Owner creates recurring session: "Mon 10am, starting 2026-03-16, 12 weeks."
   - March 29, 2026: Greece transitions to daylight saving (+1 hour). Session time stored as TIMESTAMP.
   - Generated sessions before DST: 10:00 AM. After DST: 11:00 AM (or 9:00 AM if not adjusted).
   - **Danger:** Clients see wrong times; owner confused.
   - **Prevention:** Store session times as `TIME` (not TIMESTAMP). Recurrence pattern in UTC offset-aware logic. Explicitly ask owner on session creation: "Starting Mon Mar 16, 10am. Greece observes DST March 29 (+1 hour). Confirm time stays 10am (will be 11am UTC)? [Yes/No]".
   - **Detection:** Generate sessions spanning DST boundary; inspect times. Test Greece TZ.

4. **Slotless request approved but client already booked elsewhere**
   - Client requests "Pilates Mon 10am" (full, request submitted). While waiting, client books "Yoga Mon 10am" (same time, different session). Owner approves Pilates request. **Result:** Double-booked client at same time.
   - **Prevention:** On slotless approval, check client.bookings for conflicting times in same time window. Reject approval if conflict: "Client already has Yoga Mon 10am. Can't approve conflicting Pilates session."
   - **Detection:** Test: submit slotless request → book different session same time → approve slotless → verify booking fails or approval prevents it.

5. **Waitlist auto-promotion without credit check**
   - Client #1 on waitlist for a session (credits available). Session cancellation triggers auto-notify. If client confirms without re-checking membership, they might have used credits elsewhere in the interim.
   - **Prevention:** On waitlist conversion (manual approval), always re-check membership validity + availability. Don't auto-book; require client to confirm: "Your spot is ready! Book now? [Yes/No]". Recalculate credit deduction at confirmation, not at notification.
   - **Detection:** Test: build credit, join waitlist → client spends credits (now 0) → space opens on waitlist → owner approves → client tries to confirm → should fail "no active membership" at that moment.

### Tier 2: Moderate (causes support tickets, not data corruption)

6. **Cancellation cutoff ambiguity for recurring sessions**
   - Policy: "24 hours before session." Does this apply per session or per recurring series?
   - Client books "every Pilates Mon 10am for 4 weeks." Then cancels one session (Mon Mar 18). Is it just that one, or the whole series?
   - **Prevention:** Cancellations are per-session (not series). Clear messaging: "Cancel [Session Name] Mon Mar 18 only? Or cancel all future? [Choose]".
   - **Detection:** Book recurring series → cancel middle session → verify only that session cancelled, rest intact.

7. **Session still listed after full capacity for waitlist clients**
   - Full session: "Pilates Mon 10am (12/12)". Waitlisted clients see "FULL — Join waitlist" but the session doesn't disappear from their session list.
   - Confusion: do they click again to join, or are they already joined?
   - **Prevention:** Change display for clients on waitlist: "✓ You're on the waitlist (#2)" instead of "FULL — Join waitlist". Clear state.
   - **Detection:** Join waitlist → check session list → verify marked as "Waiting" or similar.

8. **Renewal nudge for multi-membership client**
   - Client has 2 active memberships: 10-session pass (expires Mar 30, 2 sessions left) + 20-session pass (expires Apr 15, 15 sessions left).
   - Renewal nudge triggers for the first (Mar 30 + low sessions). But client has plenty of sessions from the second pass. Nudge feels premature.
   - **Prevention:** Nudge logic includes all active memberships. Only nudge if **all** active memberships meet threshold (low sessions AND near expiry). Or nudge with context: "Your Mar 30 pass has 2 sessions left. You also have [other pass details]."
   - **Detection:** Create 2 active memberships with staggered expiry + session counts. Verify nudge condition considers all.

9. **Owner reconfigures cutoff policy mid-cycle**
   - Owner sets 24h cutoff on Day 1. Client books session for Day 5. On Day 4, owner changes cutoff to 48h.
   - Should the already-booked session use the old 24h rule or new 48h rule?
   - **Prevention:** Cutoff policy applies to new bookings only. Already-booked sessions use the cutoff at booking time. Store `booking.cancellation_cutoff_hours` at booking creation.
   - **Detection:** Book session with 24h policy → owner changes to 48h → verify cancellation still uses 24h window.

10. **Slotless request approval but session now has spots available via cancellation**
    - Session full (12/12). Client #1 requests slot. Before owner approves, two clients cancel. Now session is half-empty (10/12).
    - Owner approves slotless request, booking succeeds. But client didn't actually need approval; they could have auto-booked.
    - **Prevention:** On slotless approval, re-check current capacity. If now available (< max_capacity), auto-book instead of converting to "slotless approved booking" state. Don't create a new booking type; merge with normal bookings.
    - **Detection:** Full session → submit slotless → cancellations free up spots → approve slotless → verify booking is just a normal booking, not a special state.

### Tier 3: Minor (edge cases, rare)

11. **Session time display inconsistency in Greek timezone**
    - Owner sees session time as "10:00 AM Athens" in settings. Client sees "10:00 AM" (browser interprets as their local if not set). If client in different timezone (e.g., Diaspora Greek in US), confusion.
    - **Prevention:** Always display times with timezone marker or UTC offset. For PoC (Greek-only), default to Athens (UTC+2 in summer, +1 in winter). Explicitly note: "All times Athens."
    - **Detection:** Verify session times always display "10 AM Athens" not just "10 AM".

12. **Recurring session with variable duration**
    - Owner wants: "Mon 10am–11am = 60 min, Fri 10am–10:30am = 30 min" (same recurring series, different durations).
    - **Prevention:** Recurrence templates must allow per-day duration override, or sessions must be defined separately. For MVP, assume all recurring sessions same duration. Owner can create 2 separate recurring templates if needed.
    - **Detection:** Try to create recurring with variable duration → should either fail with "all sessions must be same duration" or require multiple recurrence definitions.

13. **Owner bulk-cancels week of sessions, then wants to undo**
    - Owner: "Cancel all sessions week of Mar 18–24" (holiday closure) → bot cancels 7 sessions, sends 40 clients refund notifications.
    - Next day: "Wait, we're opening after all. Re-enable those sessions."
    - **Prevention:** No "undo" button; if needed, owner manually recreates sessions. But warn before bulk-cancel: "This will cancel [N] sessions and refund [M] clients. Proceed? [Yes, I'm sure]". Log reason in audit trail.
    - **Detection:** Bulk-cancel → try to undo → should require manual recreation, not magic undo.

---

## MVP Recommendation (v1.3)

**Phase 1: Session Catalog & Booking (CLSS)**
- ✓ Owner creates recurring class sessions (weekly recurrence template → auto-generate 4–12 weeks forward)
- ✓ Session capacity limits (max participants per session)
- ✓ Clients book within a specific session (not time range)
- ✓ Session cancellation by owner (mass notify + auto-refund)
- ✓ Waitlist when session full ("Request a spot? [Yes/No]")
- ✓ Owner assigns client to session (for phone/walk-in bookings)

**Phase 2: Cancellation Cutoff Policy (CANC)**
- ✓ Per-business opt-in (default off; "cancel anytime" preserved)
- ✓ Configurable hours-before-session window (default 24h)
- ✓ Credit forfeited inside window; restored ≥window
- ✓ Greek warning + explicit forfeit confirmation before cancel
- ✓ Extend v1.2 enforcement (which used simple 24h) to session-aware logic

**Phase 3: Slotless Booking Requests (SLOT)**
- ✓ Client requests a session (full or outside hours)
- ✓ Owner approves/rejects via chat keyboard ("João requests Pilates Mon 10am. Approve? [Yes/No]")
- ✓ Approved request converts to booking + notifies client
- ✓ Rejected request notifies client with alternatives
- ✓ Per-client history queryable ("How many times have I requested?")
- ✓ Check-in surfacing: "2 booked, 1 waitlist, 1 approval request" for session starting soon

**Phase 4: Renewal Notification Extensions (RENW)**
- ✓ Last-session threshold nudge (opt-in per business, default 1 session)
- ✓ Trigger: (sessions_remaining ≤ threshold) AND (days_to_expiry ≤ 7)
- ✓ Owner-triggered mass broadcast ("Send renewal nudge to all [business_id] with expiring memberships")
- ✓ Per-client single-session renewal reminder (owner "Remind [client name] to renew")
- ✓ Extend v1.2 7-day notification (both client + owner) to include session thresholds

**Phase 5: Per-Business Configuration (ONB/Config Extension)**
- ✓ Onboarding asks each new feature with clear defaults
- ✓ Owner edits settings post-onboarding via chat commands
- ✓ Settings editable: `booking_mode`, `slotless_requests_enabled`, `cancellation_cutoff_hours`, `last_session_threshold`, `allow_multi_booking`
- ✓ All settings default to v1.2 behavior (off, preserve backward compatibility)

**Defer to v1.4+:**
- ❌ Instructor-specific bookings (adds calendar + profile complexity)
- ❌ Buffer/advance booking limits (useful but lower priority)
- ❌ Session-level pricing overrides (revenue lever but operational complexity)
- ❌ Per-session notes / descriptions (nice-to-have, low ROI early)
- ❌ Multi-session per week enforcement (future if requested)
- ❌ Dynamic recurring session recalculation on DST (handle manually for now)

---

## Complexity Notes by Feature

| Feature | Why Complex | Risk Level | Testing Priority |
|---------|------------|-----------|------------------|
| **Recurring session generation** | Date arithmetic, DST transitions, timezone handling. Must generate correct times across weeks. | MEDIUM | HIGH — Test spanning DST boundary (Mar 29, 2026 Greece +1h) and winter TZ (Nov 1). |
| **Session capacity + concurrent bookings** | Multiple clients booking same session simultaneously. DB row-locking required. | HIGH | CRITICAL — Load test: 2+ concurrent requests, same session, capacity=1. Verify only one succeeds. |
| **Cancellation cutoff enforcement** | Timezone-aware time comparisons. "24 hours before session" must account for Greece TZ + DST. Off-by-one errors costly. | MEDIUM | HIGH — Test cancel at exact boundary (23:59, 24:00, 24:01 before session). |
| **Slotless request approval workflow** | State machine: request → pending → approved/rejected. Atomic transition + notification. Prevent race if client already booked elsewhere. | MEDIUM | HIGH — Test: concurrent approval + competing booking at same time. |
| **Waitlist auto-promotion** | On cancellation, find first waiting client, notify, wait for confirmation, convert to booking. Timing-sensitive; credit availability can change. | MEDIUM | HIGH — Test: credit spend between waitlist join and auto-promotion. |
| **Mass session cancellation + refunds** | Cancel N sessions, refund M clients atomically. Rollback on partial failure. Notification batching. | HIGH | CRITICAL — Test: cancel 10 sessions spanning 5 weeks, 50 clients. Verify all refunded, all notified. |
| **Renewal nudge with multi-membership logic** | Client has multiple active memberships with different expiry dates + session counts. Nudge trigger must consider all. | MEDIUM | MEDIUM — Test: 2 memberships, staggered expiry, different session counts. Nudge only when all meet threshold. |
| **Recurring sessions + DST transition** | Greece observes DST (Mar 29 +1h, Oct 27 -1h). Recurring sessions spanning transition must maintain correct times. | MEDIUM | HIGH — Generate sessions Feb 1–May 1, 2026. Verify times pre/post DST. |
| **Check-in surfacing (real-time count)** | On session start, query current attendance, waitlist, slotless approvals. Must be fast (no slow queries). | LOW | MEDIUM — Test: query check-in status for session starting in 30 min. Latency <500ms. |
| **Per-business configuration management** | Multiple independent settings, each with defaults. Onboarding updates, post-launch edits. Schema + validation. | LOW | MEDIUM — Test: enable/disable each flag independently. Verify each affects behavior correctly. |

---

## Chatbot UX Patterns for Sessions + Slotless

### Pattern 1: Session Listing and Booking

**Scenario:** Client says "Θέλω να κάνω κράξ αυτή την εβδομάδα" (I want to do a class this week).

**Bot flow:**
```
Bot: "Τι είδος κλάσης ενδιαφέρει σας;" (What class interests you?)
     [Pilates] [Yoga] [HIIT]

Client: [Pilates]

Bot: "Pilates αυτή τη βδομάδα:
     🕐 Δευ 10 πμ — Pilates (11/12 θέσεις) [Κράξ]
     🕐 Τρί 6 μμ — Pilates (12/12 - ΓΕΜΑ΀TE) [Περιμ. λίστας]
     🕐 Πέμ 10 πμ — Pilates (5/12) [Κράξ]"

Client: [Κράξ - Δευ 10 πμ]

Bot: "Θα κάνετε 1 θέση στο Pilates Δευ 10 πμ. Κόστος 1 session. Επιβεβαιώνετε;" [Ναι/Όχι]

Client: [Ναι]

Bot: "✓ Κρατησμένο! Pilates Δευ 10 πμ. Σας έχει σταλεί ενημέρωση. Διαγραφή: έως Κυρ 10 πμ χωρίς χρέωση."
```

**Key UX elements:**
- List sessions with clear time, capacity (X/12), and action button.
- Use emojis for visual scanning (🕐 time, ✓ confirmed, ⏳ waitlist).
- Show cancellation deadline upfront.
- Explicit confirmation before booking (costs Y credits, cancellable until Z).

### Pattern 2: Full Session + Waitlist Request

**Scenario:** Client tries to book a full session.

```
Bot: "Το Pilates Δευ 10 πμ είναι πλήρες (12/12 θέσεις).
     Θέλετε να ζητήσετε μια θέση; Θα σας ειδοποιήσουμε αν ελευθερωθεί.
     [Ναι, παρακαλώ] [Όχι, άλλη ώρα]"

Client: [Ναι, παρακαλώ]

Bot: "✓ Ζήτημα υποβλήθηκε. Είστε #2 στη λίστα αναμονής.
     Θα σας στείλουμε μήνυμα αν μια θέση ελευθερωθεί.
     Εν τω μεταξύ: άλλες επιλογές:
     🕐 Τρί 6 μμ — Pilates (8/12) [Κράξ]"
```

**Key UX elements:**
- Show waitlist position (#2 of 5, etc.).
- Offer alternatives immediately (don't leave client hanging).
- Confirm request stored.

### Pattern 3: Cancellation with Cutoff Warning

**Scenario:** Client cancels a session within the cutoff window (loses credit).

```
Bot: "Θέλετε να ακυρώσετε Pilates Δευ 10 πμ?
     ⚠️ Ακύρωση ως Κυρ 10 πμ = 1 θέση αποδίδεται.
     Ακύρωση μετά Κυρ 10 πμ = 1 θέση χάνεται.
     Τι θέλετε;"

Client: "Ακύρωση μετά Κυρ"

Bot: "⚠️ ΠΡΟΣΟΧΉ: Αν ακυρώσετε μετά Κυρ 10 πμ, χάνετε την 1 θέση χωρίς επιστροφή.
     Το κόστος δεν θα επιστραφεί.
     Είστε σίγουρος;" [Ναι, χάσε τη θέση] [Όχι, ακύρωση νωρίς]"

Client: [Ναι, χάσε τη θέση]

Bot: "✓ Ακύρωση επιβεβαιώθηκε. Pilates Δευ 10 πμ ακυρώθηκε.
     1 session χάθηκε.
     Απόθεμα: 7/10 sessions remaining (expires Aug 15).
     Άλλες θέσεις: [alternatives]"
```

**Key UX elements:**
- Explicit warning with clear deadline (day + time).
- Two-step confirmation for forfeit scenario (prevent accidents).
- Show remaining balance after cancellation.

### Pattern 4: Owner Receives Slotless Approval Request

**Scenario:** Owner receives in-chat notification of a slotless request.

```
Bot (to owner): "📬 João ζητά να κάνει κράξ σε Pilates Δευ 10 πμ (γεμάτο).
                 João έχει 8 sessions ενεργές (expires Aug 30).
                 Αποδέχεσθε;" [Ναι] [Όχι] [Αργότερα]"

Owner: [Ναι]

Bot: "✓ Ενέκρινες.
     📬 João: Κρατησμένο! Pilates Δευ 10 πμ. -1 session. Remaining: 7/8."
```

**Key UX elements:**
- Notify owner with client context (balance, membership validity).
- Clear action buttons.
- Auto-notify client on approval (transparent).

### Pattern 5: Renewal Nudge with Session Threshold

**Scenario:** Client has 1 session left and expiry in 7 days.

```
Bot (to client): "🔔 Πρόσεχε! Το pass σου λήγει σε 7 ημέρες.
                  Απόθεμα: 1 session.
                  Ανανέωσε τώρα για να αποφύγεις διακοπή υπηρεσίας.
                  [Ανανέωσε] [Αργότερα]"

Client: [Ανανέωσε]

Bot: "📱 Ανανέωση διαθέσιμη.
     10-pack: €50 (valid 30 days)
     20-pack: €80 (valid 30 days, καλύτερη τιμή)
     Ποιο θέλετε;" [10-pack] [20-pack] [Σκέψου λίγο]"
```

**Key UX elements:**
- Use emoji for urgency (🔔).
- Show specific reason (session count + days left).
- Include pricing + recommendations ("better value").
- Offer "think about it" option (don't force).

---

## Sources

### Session Scheduling & Fixed Classes
- [Setmore: Class Booking Support](https://support.setmore.com/en/articles/490889-class-booking)
- [SchedulingKit: How to Set Up Group Class Booking (2026 Guide)](https://schedulingkit.com/hub/scheduling/how-to-set-up-group-class-booking)
- [Pembee: Top 10 Best Class Booking Systems (2026)](https://www.pembee.app/blog/top-10-class-booking-systems)
- [Mindbody Fitness Class Scheduling Software](https://www.glofox.com/blog/fitness-class-scheduling-software/)
- [Glofox: Fitness Class Scheduling Features](https://www.glofox.com/blog/fitness-class-scheduling-software/)
- [Vibefam: AI-Powered Fitness Studio Management](https://vibefam.com/)
- [Acuity Scheduling: Group Classes with Capacity](https://acuityscheduling.com/learn/group-classes-pricing)

### Waitlist & Request Approval Workflows
- [Vibefam: Waitlist Conversions for Fitness Studios](https://vibefam.com/best-way-grow-your-fitness-studio-crm-booking-system-integration-for-waitlist-conversions/)
- [US Tech Automations: Fitness Class Waitlist Automation 2026](https://ustechautomations.com/resources/blog/fitness-class-waitlist-automation-case-study)
- [ManageMemberships: Manage Bookings with Waitlist Functionality](https://managememberships.com/blog/manage-bookings-waitlist-functionality)
- [GetApp: Fitness Software with Wait-list Management 2026](https://www.getapp.com/recreation-wellness-software/health-fitness/f/wait-list-management/)

### Cancellation Policies & Cutoff Enforcement
- [Apptoto: How to Write an Appointment Cancellation Policy](https://www.apptoto.com/best-practices/appointment-cancellation-policy)
- [SimplyBook.me: Handling Last-Minute Cancellations](https://news.simplybook.me/handling-last-minute-cancellations-policies-bottom-line/)
- [Square Support: Set a Custom Cancellation Policy](https://squareup.com/help/us/en/article/5493-set-a-custom-cancellation-policy-with-square-appointments)
- [Acuity Scheduling: How to Create a Cancellation Policy](https://acuityscheduling.com/learn/how-to-create-a-cancellation-policy)

### Renewal Notifications & Session-Based Thresholds
- [Glue Up: Membership Renewal Email Templates](https://www.glueup.com/blog/membership-renewal-email-templates)
- [Remindlo: Gym Membership Reminder SMS](https://www.remindlo.co.uk/industries/gym)
- [LoyaltyPass: Gym Member Retention Between Sessions](https://www.loyaltypass.co/blog/guide/gym-member-retention-between-sessions)
- [Everfit: Session Credits & Expiry Management](https://help.everfit.io/en/articles/14698318-session-credits-manage-and-track-paid-client-sessions-beta)

### Chatbot UX Patterns & Fitness Booking
- [Chatbot.com: AI ChatBot for Gyms and Fitness Centers](https://www.chatbot.com/solutions/ai-chatbot-for-gym-and-fitness/)
- [Oscar Chat: AI Chatbot for Gyms & Fitness Studios (2026 Guide)](https://www.oscarchat.ai/blog/ai-chatbot-for-gyms-fitness-studios/)
- [Parallel HQ: How to Design Chatbot UX: 2026 Conversational UI Patterns](https://www.parallelhq.com/blog/chatbot-ux-design)
- [FuseLabCreative: Chatbot UI Design Patterns and Best Practices 2026](https://fuselabcreative.com/chatbot-interface-design-guide/)

### Owner-Side Notifications & Mass Management
- [SimplyBook.me: Automated WhatsApp Notifications](https://simplybook.me/en/)
- [CitaFlow: AI Chatbot with WhatsApp & Telegram Bookings 24/7](https://citaflow.com/en/chat-ai/)
- [BookingPress: Telegram Notification Integration](https://www.bookingpressplugin.com/addon/telegram-notification/)
- [Booknify: Telegram Appointment Booking Notifications](https://booknify.com/features/appointment-booking-system-with-telegram-notifications)
- [Zoho Bookings: Yoga Instructor Scheduling Software](https://www.zoho.com/bookings/industries/yoga-scheduling-software.html)

### Multi-Session Booking & Membership Policies
- [SmartHealthClubs: Gym Membership Pricing & Session Options](https://smarthealthclubs.com/blog/how-to-set-your-gym-membership-pricing/)
- [Fitness Connection: Member Policies](https://fitnessconnection.com/policies/member-policies)
- [GymDesk: Session Booking Documentation](https://docs.gymdesk.com/en/help/docs/booking)
- [Orangetheory Fitness: Membership Options 2026](https://www.orangetheory.com/en-us/memberships)

### Check-In & Attendance Verification
- [Exercise.com: Check-In Software for Gyms](https://www.exercise.com/platform/check-ins/)
- [Virtuagym: Gym Access Control & Check-In](https://business.virtuagym.com/gym-access-control-system/)
- [Glofox: Best Gym Check-In Systems (Boutique Fitness)](https://www.glofox.com/blog/gym-check-in-system/)
- [GymDesk: Session Access & Failed Check-In Troubleshooting](https://docs.gymdesk.com/help/session-access)

### Per-Business Configuration & Policy Management
- [Wix Bookings: Setting Up Booking Policies](https://support.wix.com/en/article/wix-bookings-setting-up-your-booking-policies)
- [Microsoft Bookings: Set Scheduling Policies](https://learn.microsoft.com/en-us/microsoft-365/bookings/set-scheduling-policies)
- [Booxi: Service and Business Booking Rules](https://help.booxi.com/en/articles/9952791-how-do-service-and-business-booking-rules-interact)

### Greek Context & Language
- [HappyFox: Customer Service Software in Greek](https://blog.happyfox.com/customer-service-software-now-in-greek/)
- [Chatbots.org: Greek Language Chatbots Directory](https://www.chatbots.org/language/greek/)
- [Botsify: AI Chatbot Development in Greece](https://botsify.com/chatbot-service-in-greece)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Session Catalog & Recurring Generation** | HIGH | Mindbody, Glofox, Vibefam, Pembee all explicitly support recurring weekly classes. Patterns are mature and consistent. |
| **Session Capacity + Booking Modes** | HIGH | All major platforms (Acuity, Setmore, SuperSaaS, GymDesk) support fixed-capacity sessions. Well-documented. |
| **Waitlist/Slotless Request Workflows** | MEDIUM-HIGH | Waitlists are standard (Mindbody, Acuity, Glofox). Slotless "request approval" is emerging but less universally documented. Inferred from broader booking system design. |
| **Cancellation Cutoff Enforcement** | HIGH | 24–48h windows confirmed across Apptoto, SimplyBook.me, Square, Acuity. Policy templates widely available. |
| **Renewal Nudge with Session Thresholds** | MEDIUM-HIGH | 7-day threshold confirmed (Everfit, Remindlo). Session-count thresholds (1, 3, 5 sessions) mentioned in Everfit docs and LoyaltyPass. Combined logic less documented. |
| **Chatbot UX Patterns for Sessions** | MEDIUM | ChatBot.com, Oscar Chat, Botpress provide general principles. Fitness-specific chatbot examples exist but don't detail session + waitlist flows in depth. Inferred from general conversational UX best practices. |
| **Per-Business Configuration** | MEDIUM | Wix, Microsoft Bookings, Booxi show config patterns. Specific implementation (chat-based vs UI-based) less documented. Inferred from existing v1.2 approach. |
| **Greek Language & Fitness Context** | MEDIUM | Greek-language customer service solutions available (HappyFox, Botsify). Fitness studio use cases in Greece exist (Club Pilates Athens, etc.). Combined context (chat booking + Greek + pilates-style studios) limited in public sources; requires inference from general fitness + Greek language patterns. |
| **DST & Timezone Handling** | LOW-MEDIUM | Greece's DST transition (Mar 29 +1h, Oct 27 -1h) documented. Session time preservation across DST not widely discussed in public fitness software docs. Requires careful testing. |
| **Check-In Surfacing & Real-Time Count** | MEDIUM | Exercise.com, Glofox, GymDesk mention check-in systems. Real-time occupancy display inferred from UX expectations, not explicitly detailed. |

---

## Gaps Requiring Phase-Specific Research

1. **Slotless Request State Machine:** Formal approval workflow (pending → approved/rejected → [if approved] booked). When does credit deduction happen? At approval or at booking conversion? Needs detailed design before Phase 3.

2. **Concurrent Session Bookings Under Load:** Published platforms don't detail locking strategies for simultaneous bookings in same session. Phase 1 must include load testing before release.

3. **Recurring Session Auto-Cancellation on Holiday:** If owner creates recurring sessions but wants to skip specific weeks (Easter, summer closure), how is this handled? Auto-skip rules or manual cancel each week? Needs clarification.

4. **Audit Trail for Slotless Decisions:** When owner rejects a slotless request, should reason be logged? Should client be able to appeal? Requires owner SOP documentation during Phase 3.

5. **Mass Broadcast Performance:** Owner sends renewal nudge to 500+ clients simultaneously. Batching, rate-limiting, and failure handling needed. Network/DB stress test critical before Phase 4.

6. **Multi-Timezone Owner Workflow:** If owner is in Greece but has clients in diaspora (US, Germany), session times need disambiguation. Phase 1 design should address (or defer as out-of-scope for PoC).

7. **GDPR Deletion with Active Slotless Requests:** Client requests data deletion. What happens to their pending slotless requests? Needs legal + schema clarity. Deferred to Phase 5 (full deletion flow).

8. **Waitlist Promotion Success Rate Tracking:** For analytics, owner wants to know "% of waitlisted clients who convert to bookings when slots open." Requires metrics schema; nice-to-have, not MVP.

---

## Recommendations for Phase Planning

1. **Strict sequencing:** CLSS → CANC → SLOT → RENW → ONB/Config. Each layer depends on the previous.
2. **Greek UX testing:** Every chatbot flow must be tested with Greek speakers (even if researched, cultural fit matters).
3. **Load testing early:** Session bookings + concurrent requests are high-risk; test at 100 concurrent bookings per session before Phase 1 ships.
4. **DST boundary testing:** Generate sessions spanning Mar 29 and Oct 27, 2026 (Greece DST dates). Verify times remain consistent.
5. **Audit trail from day one:** Log all state transitions (request pending → approved → booked, session cancellation + refund reason, policy change history). Makes debugging and GDPR easier.
6. **Slotless request SOP:** Clarify approval criteria (owner discretion? Automatic if capacity opens? Credit availability re-check?). Document in onboarding.

