# Feature Landscape: Billing & Membership Systems for Chat-Native Appointment Booking

**Domain:** Fitness studio & appointment booking apps with token/credit/membership billing
**Researched:** 2026-07-17
**Research Mode:** Ecosystem (SaaS fitness booking platforms)
**Overall Confidence:** HIGH

---

## Executive Summary

Token and credit systems are table-stakes in fitness studio booking software. The industry converges on a few core patterns:

1. **Token deduction happens at booking confirmation**, not at service time. Restoration on cancellation is automatic and immediate (within 12 hours pre-appointment).
2. **Validity windows are typically 6–12 months for punch cards**, with no expiry being a modern differentiator. Passes use rolling (membership-anniversary) or calendar-based (all members same date) renewal cycles.
3. **Enforcement is binary**: hard-block (prevent booking if no valid membership) or soft-flag (allow booking, alert owner). Most mature platforms default to hard-block for revenue protection.
4. **Expiry notifications happen at 7 days pre-expiry** for both client and owner (some use 14-day window). Clients expect to query remaining balance in-app or via chat.
5. **Reschedule edge cases are under-documented** in public sources but critically important: reschedules outside the paid period must either (a) fail loudly, (b) auto-restore credits + rebook, or (c) allow booking at a different price tier.
6. **Multi-month packages (90-day cycles) are standard** but require careful handling of partial expiry logic and rollover caps.

The industry's biggest pitfall: treating expiry as a simple date check instead of a state machine. Edge cases around cancellation within the 24-hour window, reschedule across package boundaries, and concurrent token operations (two simultaneous bookings) cause silent data corruption in production systems.

---

## Table Stakes Features

Features users expect in any fitness studio booking app. Missing these = product feels incomplete or unfair.

| Feature | Why Expected | Complexity | Behavior |
|---------|--------------|------------|----------|
| **Book using active membership/credits** | Fitness studios price per-session; clients need to purchase before booking | Medium | Client selects session; bot checks if membership/pass is valid (not expired). If valid, show `Confirm booking (costs 1 token)`; if invalid, show `No active membership. See balance.` |
| **Automatic token deduction at confirmation** | One point of truth for session usage; prevents double-bookings via UI + DB UNIQUE constraint on (session_id, member_id) | Low | On `confirm_booking`, decrement membership.sessions_remaining by 1. Trigger immediate expiry check if now ≤ 0. |
| **Full credit restoration on cancel (24h+ window)** | Industry standard per ClassPass, Restore Hyper Wellness: clients expect to get credits back if they cancel well in advance | Low | On `cancel_booking` (if now < appointment_time - 24h), increment membership.sessions_remaining. Mark booking as cancelled (soft-delete or status='cancelled'). |
| **Late cancellation fee or forfeit (within 24h)** | Protects studio from no-shows; clients know the rule in advance | Low | On cancel within 24h window: (a) keep token deducted (forfeited), (b) email owner + client about the policy. Tracking: booking.cancelled_at timestamp. |
| **Membership expiry check at booking time** | Prevents booking with expired memberships; ensures no service is provided on stale credits | Low | On `create_booking`, query: `SELECT * FROM memberships WHERE client_id=X AND membership_type='pass' AND (today <= expiry_date OR unlimited=true)`. Fail if none found. |
| **Client queries balance ("How many sessions left?")** | Clients need to check before booking; UX expectation in any membership system | Low | Intent: `check_balance`. Response: `Remaining: 8 sessions (valid until Aug 30)`. Show all active memberships (multiple passes possible). |
| **Owner records payment and creates membership via chat** | All owner actions are chat-based in PoC; critical for manual billing workflows | Medium | Owner: `Create membership for Alexios: 10-pack pass, valid 30 days from today`. Bot creates membership record, generates ID, confirms to owner. |
| **Expiry notification to client and owner** | Clients forget expiry dates; owners need to re-sell before clients churn. Industry sends at 7-day mark. | Medium | Scheduled job: daily at 8am, query memberships where (expiry_date - today = 7 days). Send client: `Your 8 remaining sessions expire in 7 days. Book soon!` Send owner: `Alexios' pass expires 7/24.` |
| **Enforce membership validity: block vs flag policy** | Studios differ in risk tolerance. Boutique studios block hard; corporate gyms flag to staff. Must be configurable per business. | Low | Policy: `business.membership_enforcement = 'block' | 'flag'`. If 'block', fail booking if no valid membership. If 'flag', allow booking but send owner alert: `Booking without membership – Alexios has no active pass.` |
| **Handle cancellation + token restoration edge case: same-day reschedule** | Client cancels 3pm appointment, reschedules to 5pm same day (both within original validity). Credits should not be lost. | Medium | On reschedule within same validity window: (1) cancel old, (2) restore credit from old, (3) book new, (4) deduct credit for new. Net result: same balance. Atomically in one transaction. |

---

## Differentiators

Features that set product apart. Not expected, but valued by power users or studios optimizing for retention.

| Feature | Value Proposition | Complexity | Market Presence |
|---------|-------------------|------------|------------------|
| **Partial credit carryover on renewal** | Instead of losing unused credits, clients can carry 30–50% to next month. Reduces churn (users feel they're not losing money). | Medium | ClassPass, Peloton do this. Everfit mentions rollover in premium tier. Most punch-card systems forfeit unused credits. |
| **No expiry option for punch cards** | Modern studios (e.g., Trime Studio Stockholm) offer lifetime-valid punch cards. Differentiate by trusting clients, reduce support load (no expiry disputes). | Low | Niche market (not mainstream fitness), but premium positioning. Requires UI to display "Never expires" clearly. |
| **Reschedule without re-booking flow** | Instead of cancel + rebook, reschedule atomically. Keeps credits, updates calendar event. Smoother UX for client. | Medium | Not widely documented but standard in mature booking platforms (Mindbody, Acuity). Requires careful state management. |
| **Package tier recommendation engine** | Bot suggests "10-pack is better value than 5-pack for your usage pattern" based on booking history. | High | Not found in research; innovative. Requires 2–3 months of booking history to train. Low priority for v1. |
| **Pause / freeze membership** | Client can pause for 1 month (vacation, injury). Extends expiry by pause duration instead of forfeiting. Retention lever. | Medium | Everfit, Mindbody support this. Reduces churn during life changes. Requires UI for client to request pause + owner approval. |
| **Custom expiry window per package** | Owner can set "10-pack valid 6 months, 20-pack valid 12 months". Most platforms force one window per type. | Medium | Punchpass mentions this as a feature. Flexible. Requires schema change: expiry_days per package definition, not type. |
| **Owner bulk-assign credits (manual adjustment)** | Owner can add or subtract credits for a client (refund, courtesy, late-cancel reversal, no-show penalty). Tracks audit log. | Low | Standard in Mindbody, Zen Planner. Important for dispute resolution. Requires `credit_adjustments` table with reason + timestamp. |
| **Client invite friends (share credits?)** | Client can share a pass with a friend (split cost). Not common; very niche. | High | Not found in research. Too risky for studios (revenue loss, abuse). Skip for now. |
| **Rollover cap enforcement** | If max rollover is 50%, and client has 100 unused credits, only 50 carry over. Prevents infinite accumulation. | Low | Mentioned in research (Everfit, ClassPass). Requires `membership.rollover_cap` field. |
| **Grace period extension on near-expiry** | Client can request a 1-week grace extension if they book within 3 days of expiry (retention play). Owner auto-approves or manually reviews. | Medium | Not found in research; uncommon. Interesting retention tactic but operationally heavy. |

---

## Anti-Features

Features to explicitly **NOT** build (or defer far future).

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Automatic payment collection via card/bank** | SCOPE OUT: Payment processing adds PCI compliance, payment gateway integration (Stripe, PayPal), fraud detection. Too much infrastructure for PoC. Owner records manual payment via chat. Revisit in v2. | Owner uses Telegram/WhatsApp to say "Payment received for Alexios 10-pack" → bot creates membership. Manual but sufficient. |
| **Refund processing via system** | Chargebacks, partial refunds, subscription cancellations → lawyer territory. Out of scope. | Owner handles refunds outside system (manual bank transfer or card reversal). If dispute, contact support. |
| **Unlimited rollover** | Credits never expire → studio loses revenue control. Clients accumulate stale credits, then complain they're "too old to use". | Enforce rollover cap (e.g., 50% max carry-over) + hard expiry on original package. |
| **Per-staff memberships** | E.g., "5 sessions with Instructor A, 10 with Instructor B, unlimited with anyone else". Too complex for PoC (requires per-instructor availability + scheduling). | Single shared schedule per business. Instructor-specific bookings deferred to v2+. |
| **Tiered access (bronze/silver/gold)** | Different membership tiers unlock different prices/availability (e.g., gold members can book 2h in advance, bronze only 1h). Adds class discrimination UX friction. | All clients, same booking window. Price discrimination via package tiers (5-pack, 10-pack), not access tiers. |
| **Gamification (points, badges, "earn 10 extra credits for refer a friend")** | Common in ClassPass/Peloton. Sounds fun but adds complexity: referral tracking, fraud (fake referrals), policy disputes. | Skip for now. If retention is problem, tackle with simpler tools (grace period, rollover cap, notification cadence). |
| **Multi-currency or international pricing** | PoC is Greek-only. Don't support USD, EUR, GBP. Revisit in v2. | Hard-code EUR. All prices in €. |
| **Guest pass / day pass (one-off sessions without membership)** | Tempting (new customer conversion). But splits logic: membership path vs guest path. Hard to track in chat bot. | MVP: membership-only. Guests book via separate flow (email or phone) outside bot. Revisit in v2. |
| **Recurring auto-renewal (subscription)** | Auto-charge client every month for membership renewal. Requires payment gateway + recurring billing. Out of scope. | Manual owner recording: "Renewing Alexios' monthly pass for Aug." Bot creates new membership with same terms. |
| **Package upsell on booking** | If client tries to book but has no credits, upsell: "Buy 5-pack now (€50)?" Tempting but adds friction to booking flow + payment complexity. | Redirect: "You have no active membership. Ask owner for pricing & packages." Owner sends pricing, handles payment offline, records in bot. |

---

## Feature Dependencies

Clear dependency graph. Helps with phasing.

```
┌─ Membership Type Definition (owner creates via chat)
│   ├─ Book with valid membership (checks expiry)
│   ├─ Token deduction at confirmation
│   └─ Client balance query
│
├─ Expiry logic
│   ├─ Membership expiry check at booking
│   ├─ Expiry notification (7-day pre-alert)
│   └─ Rollover on renewal
│
├─ Cancellation & Restoration
│   ├─ Credit restoration on cancel (24h window)
│   ├─ Late cancellation forfeit (within 24h)
│   └─ Reschedule without re-booking (atomic)
│
├─ Enforcement Policy
│   ├─ Hard-block: prevent booking if no membership
│   └─ Soft-flag: allow booking, alert owner
│
└─ Audit Trail
    ├─ Owner bulk credit adjustments
    └─ Membership change log (creation, expiry, renewal)
```

**Critical**: Cancellation/restoration logic must be implemented before releasing expiry notifications. Otherwise, users book → cancel outside window → lose tokens → complain. If notifications go out before restoration is solid, support load spikes.

---

## Edge Cases & Gotchas

The industry's pain points, explicitly enumerated.

### Tier 1: Critical (causes silent data corruption or revenue loss)

1. **Same-day reschedule across token boundaries**
   - Client has pass A (expires today) with 2 tokens. Books pass B (expires next month) with 10 tokens.
   - Client cancels appointment in pass A at 11:59am (within window), rebooks in pass B.
   - **Danger**: If atomicity is lost, credits can be double-deducted or not deducted.
   - **Prevention**: Wrap cancel + rebook in `BEGIN TRANSACTION...ROLLBACK` or Drizzle's transaction API. Assert tokens before and after.
   - **Detection**: Daily audit: `SELECT SUM(tokens_deducted) FROM bookings WHERE booking_date=TODAY GROUP BY client_id` vs `SELECT SUM(sessions_remaining) FROM memberships WHERE client_id=X`. Should equal initial count.

2. **Concurrent token deduction (two bookings within same second)**
   - Client opens app, clicks "Book" on two different sessions within milliseconds.
   - Both requests check membership.sessions_remaining=10, both deduct, both confirm.
   - **Result**: Two bookings, but sessions_remaining=8 instead of 9.
   - **Prevention**: DB UNIQUE constraint on (membership_id, booking_slot_id) (last line of defense). App-level sequential booking (one booking at a time per client). PostgreSQL row-level locking with `SELECT...FOR UPDATE` during token deduction.
   - **Detection**: Test with load-test: 2 concurrent requests, same client, different sessions. Verify only one succeeds or both fail.

3. **Expiry date arithmetic errors (timezone, DST, leap years)**
   - Membership valid 30 days from 2026-01-30 (Jan) vs 2026-05-30 (May): different day counts.
   - Expiry stored as `DATE`, not `TIMESTAMP WITH TZ`. 11:59pm client's time zone expires at midnight UTC (off by a day).
   - **Prevention**: Store expiry as `DATE`. Expiry check: `TODAY <= expiry_date` (not `<`). All date math in database (not app). Always use UTC internally.
   - **Detection**: Test expiry on boundary dates. Check in client's time zone (create test for Greece TZ).

4. **Rollover loses credits if not capped**
   - Client has 50 unused tokens in April. May renewal rolls over 100%, so 150 for May. June renewal: 250. By Dec: 800 unused tokens.
   - Studio can't enforce "use or lose" = revenue loss.
   - **Prevention**: Enforce `rollover_cap` per package (default 50%). Rollover logic: `new_sessions = MIN(old_sessions_remaining * rollover_pct, rollover_cap)`. Rest is forfeited (logged but not restored).
   - **Detection**: Audit rollover monthly. Flag clients with >100 unused tokens for 3+ months.

### Tier 2: Moderate (causes support tickets, not data corruption)

5. **24-hour window ambiguity**
   - "Cancel within 24 hours" — is it 24 hours from booking creation, or from appointment start time?
   - ClassPass & Restore use: "24 hours **before** appointment start time".
   - **Prevention**: Hard rule in bot: "Cancel anytime before 24 hours before appointment. After that, you forfeit the token." Show countdown: "Cancellable until 2026-07-20 03:00 PM".
   - **Detection**: Client cancels, check booking.appointment_time - now(). If now() > appointment_time - 24h, apply late fee.

6. **Partial refund on mid-package upgrade**
   - Client has 3 remaining tokens from a 10-pack (€50). Buys a 20-pack (€100). Should the 3 old tokens disappear or merge?
   - **Prevention**: No auto-merge. Owner records: "Alexios: upgrading 10-pack to 20-pack. Keep 3 unused tokens from old pass." Bot creates new membership, keeps old one as `status='superseded'`. Client can still view old membership.
   - **Detection**: Audit log tracks all membership state changes.

7. **Late cancellation notification race**
   - Owner receives "Booking within 24h window!" alert, but client simultaneously cancels.
   - Alert goes to owner, owner thinks they need to chase client, but client already cancelled.
   - **Prevention**: Alert include current cancellation window status: "Booking for 07-20 03:00 PM — cancellable until 07-19 03:00 PM (expires in 18 hours)".

8. **No expiry option, but owner changes their mind later**
   - Owner chose "no expiry" for punch cards in April. In September, wants to enforce 12-month expiry retroactively.
   - **Problem**: Can't add expiry to cards already sold.
   - **Prevention**: At membership creation time, ask owner: "Expiry period? (options: none, 6 months, 12 months, custom)". Lock in choice per membership. New memberships can use different policy. Warn owner: "Changing the expiry policy affects **future** memberships only."
   - **Detection**: Schema: `memberships.expiry_override_days` — per-membership expiry, not type-level.

### Tier 3: Minor (edge cases, rare)

9. **Membership renewal on same day client has appointment**
   - Client has pass expiring 2026-07-20 11:00 AM. Books appointment for 2026-07-20 02:00 PM. Owner renews pass same morning.
   - Bot checks expiry: is old pass or new pass valid?
   - **Prevention**: Renewal logic increments expiry_date (don't replace, add duration). Track `memberships.renewal_date`. On booking, check if membership has a renewal pending; if so, include both in validity check.
   - **Detection**: Unit test: membership expires today at 11am, owner renews at 10am, client books at 12pm. Verify: booking succeeds, uses new membership balance.

10. **Discount application across renewal**
    - Client bought 10-pack in July at €50. In Aug, studio runs "new customer 20-pack for €75 if you refer a friend". Client's old 10-pack expires Aug 15.
    - Can't retrofit discount to old purchase. New pass has new price.
    - **Prevention**: Prices are immutable. `package_definition.price_eur` + `membership.price_paid_eur` (what they actually paid) are distinct. Audit log tracks if manual override applied.

---

## MVP Recommendation

**Phase 7 (Config & Recording):**
- ✓ Owner defines packages (name, duration in days, session count or unlimited) via chat
- ✓ Owner records client payment, creates membership with expiry

**Phase 8 (Enforcement & Deduction):**
- ✓ Client books; bot checks membership validity (not expired)
- ✓ Token deducted on confirmed booking
- ✓ Token restored on cancel (24h+ window); forfeited within 24h
- ✓ Membership enforcement policy (block vs flag) per business
- ✓ Reschedule within same validity window (atomic restore + rebook)

**Phase 9 (Notifications & Queries):**
- ✓ Client balance query ("How many sessions left?")
- ✓ Expiry notification at 7 days pre-expiry (client + owner)
- ✓ Auto-renewal on expiry (owner records, bot creates new membership with same terms)

**Defer to v1.3+:**
- ❌ Partial credit rollover (30–50% to next month) — differentiator, not critical
- ❌ No-expiry punch cards — niche, can add as option later
- ❌ Package tier recommendation engine — requires data, low ROI early
- ❌ Pause/freeze membership — retention play, not MVP
- ❌ Bulk credit adjustments (owner manually adds/subtracts) — defer to Phase 10

---

## Complexity Notes by Feature

| Feature | Why Complex | Risk Level |
|---------|------------|-----------|
| **Token deduction with concurrency** | Multiple clients booking same session. DB row locking required. | HIGH — Test thoroughly with load tests. |
| **Expiry check at booking + validity window** | Timezone arithmetic (Greece TZ). Boundary conditions. | MEDIUM — Test on expiry date at 11:59 PM. |
| **Cancellation 24h window + token restoration** | State machine: pending → confirmed → cancelled. Atomicity critical. | HIGH — Use DB transactions, log all state changes. |
| **Reschedule across package boundaries** | Need to track which package funded the old booking, so restoring to correct one. | MEDIUM — Denormalize: `bookings.membership_id` links to the membership that paid for it. |
| **Expiry notification scheduling** | Daily cron job, timezone-aware, avoid duplicate notifications. | MEDIUM — Use Supercronic + idempotency key (notification_id). |
| **Rollover cap enforcement** | Math-heavy: compute rollover amount, track carryover, enforce cap. | LOW — Query once per renewal cycle, deterministic. |
| **Multi-business enforcement policy (block vs flag)** | Per-business config must be queryable at booking time. | LOW — Add `business.membership_enforcement` field, query at booking check. |

---

## Sources

### ClassPass & Mindbody Integration
- [ClassPass Cancellation Policy](https://help.classpass.com/hc/en-us/articles/207942743-What-is-the-reservation-cancellation-policy)
- [Mindbody ClassPass Integration Guide](https://support.mindbodyonline.com/s/article/207281507-Things-to-know-when-using-ClassPass?language=es)
- [ClassPass Credit Refund Documentation](https://classpass.my.site.com/help/s/article/How-can-I-refund-or-credit-back-a-ClassPass-user?language=en_US)

### Punch Card & Validity Patterns
- [Empow3r Fitness Punch Card Policies](https://empow3rfitness.com/policies)
- [Athletic Lab Punch Card Expiry](https://www.athleticlab.com/faq-items/how-long-do-punch-card-memberships-last/)
- [Punchpass Fitness Studio Software](https://punchpass.com/)
- [Trime Studio: No-Expiry Punch Cards](https://www.trime.app/punch-cards)

### Renewal & Rollover Policies
- [ClubExpress Renewal Schedule Documentation](https://help.clubexpress.com/hc/en-us/articles/24736869993883-Renewal-Schedule)
- [ClassPass Credit Rollover Policy](https://help.classpass.com/hc/en-us/articles/209367426-Do-my-credits-roll-over)
- [Reservio: Class Passes vs Memberships](https://www.reservio.com/blog/tips/class-passes-vs-memberships-loyalty)
- [Singapore Fitness Guide: Flexible Class Passes](https://vibefam.com/moving-past-memberships-a-practical-guide-to-flexible-class-passes-for-singapore-fitness-studios/)

### Cancellation & Token Restoration
- [Restore Hyper Wellness Cancellation Policy](https://www.restore.com/terms)
- [The Restoration Lab Med Spa Cancellation Policies](https://www.restorationlabmedspa.com/book-appointment/cancellation-no-show-policies)
- [Restoration Aesthetics Cancellation Fees](https://www.therestorationaesthetics.com/appointments)

### Membership Enforcement & Access Control
- [GymMaster Club Membership Hold Policies](https://www.gymmaster.com/blog/club-membership-hold-policies-best-practices/)
- [Fitness Connection Membership Policies](https://fitnessconnection.com/policies/member-policies)
- [Booking & Membership Requirements](https://docs.gymdesk.com/en/help/docs/booking-settings)
- [FTC Guidance: Gym Cancellation & Policies](https://www.ftc.gov/business-guidance/blog/2025/08/cancelling-gym-or-other-membership-shouldnt-heavy-lift-what-businesses-can-learn-ftcs-case)

### Expiry Notifications & Session Credits
- [Everfit Session Credits & Expiry Management](https://help.everfit.io/en/articles/14698318-session-credits-manage-and-track-paid-client-sessions-beta)
- [Remindlo SMS Reminder System for Gyms](https://www.remindlo.co.uk/industries/gym)
- [Trainerize Personal Training Rewards & Credits](https://help.trainerize.com/hc/en-us/articles/34364710236820-ABC-Trainerize-x-MyFitnessPal-Premium-Rewards-Program)

### Multi-Month Packages & Retention
- [Fitness Degree: 90-Day Member Retention Strategy](https://www.fitdegree.com/post/how-to-build-a-90-day-member-retention-system-for-your-boutique-studio)
- [Namaste Fitness: Multi-Studio Pricing](https://www.namastefitness.com/multi-studio-pricing)
- [WodGuru Gym Pricing Strategy 2026](https://wod.guru/blog/gym-pricing-strategy/)
- [Orangetheory Fitness Membership Options](https://www.orangetheory.com/en-us/memberships)

### Billing Edge Cases & Legal
- [Zen Planner: How Software Prevents Billing Mistakes](https://zenplanner.com/financial/how-software-for-fitness-studio-billing-can-help-studio-owners-avoid-costly-mistakes/)
- [CloudGym Manager: Refunds, Credits, or Balance Adjustments](https://www.cloudgymmanager.com/when-should-a-gym-give-a-refund-a-credit-or-just-adjust-the-balance/)
- [Limitless Studio: Chargeback Handling](https://www.yourlimitlessstudio.com/articles/chargebacks)
- [Punchpass: Reduce Late Payments for Fitness Businesses](https://punchpass.com/resources/blog/how-to-reduce-or-eliminate-late-payments-for-your-fitness-business/)
- [Wodify: Billing Strategies for Fitness](https://www.wodify.com/blog/billing-strategies-in-fitness-businesses-insights-from-wodify/)
- [WellnessLiving: Overdue Payment Collections](https://www.wellnessliving.com/blog/overdue-payment-collections-gyms-fitness-studios/)

### Chat-Based Scheduling & Booking Systems
- [ProProfs Chat: Appointment Scheduling Chatbots](https://www.proprofschat.com/blog/appointment-scheduling-chatbots/)
- [GetMyAI: AI Appointment Booking Chatbot](https://www.getmyai.ai/features/ai-appointment-booking-chatbot/)
- [BotPenguin: Appointment Booking Chatbot](https://botpenguin.com/use-cases/appointment-bookings/)
- [Botpress: Booking Chatbot Build Guide 2026](https://botpress.com/blog/chatbot-for-bookings)
- [Zapier: Best Appointment Scheduling Apps 2026](https://zapier.com/blog/best-appointment-scheduling-apps/)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Table Stakes Features** | HIGH | ClassPass, Mindbody, Everfit, Punchpass all align on core behaviors. Cancellation window (24h), token deduction, expiry check are universal. |
| **Punch Card Expiry Patterns** | HIGH | 6-12 month windows confirmed across Empow3r, Athletic Lab, Punchpass, Trime. No-expiry is documented (Trime Studio). |
| **Pass Renewal (Rolling vs Calendar-based)** | HIGH | ClubExpress documentation explicit. Rolling renewals standard for per-member management. |
| **Rollover Cap Enforcement** | MEDIUM | Mentioned in ClassPass and Everfit but specifics vary. Presumed best practice based on revenue reasoning. |
| **Enforcement Policies (Block vs Flag)** | MEDIUM | GymMaster and FTC docs reference blocking for non-payment. "Soft flag" inference based on support workflows documented (reminder systems). Explicit "flag vs block" config not widely documented. |
| **Expiry Notifications** | HIGH | Everfit (7-day trigger), Remindlo (14, 7, 3-day cadence), Fitness First (14-day window). 7 days confirmed in multiple sources. |
| **24-hour Cancellation Window** | HIGH | ClassPass, Restore Hyper Wellness, Restoration Aesthetics all enforce 24-hour pre-appointment window for full credit restoration. Industry standard. |
| **Edge Cases (Concurrency, Boundary Conditions)** | MEDIUM | Not explicitly documented in public sources. Inferred from billing system design patterns and CARD Act legal framework (expiry must be >5 years in US). Requires testing. |
| **Multi-Month Packages (90-day)** | HIGH | Fitness Degree, Namaste, Orangetheory all use 90-day cycles. 3-month class package validity documented (Punchpass research mentions "10 class package valid 3 months"). |
| **Chat-Based Membership Query** | LOW | Chat-based booking apps (BotPenguin, GetMyAI, Botpress) mention scheduling but don't detail balance query workflows. Presumed available but not well-documented. |

---

## Gaps Requiring Phase-Specific Research

1. **Concurrent booking races in production**: Published frameworks (Mindbody, ClassPass) don't detail their locking strategies. Phase 8 planning should include load testing design.
2. **Partial refund policies in chat UX**: How do teams handle "client used 3 of 10 sessions, wants full refund"? Owner judgment call? Auto-proration? Requires deeper dive into support workflows.
3. **Timezone handling in Greek context**: How does DST (Greece observes +2 hours March–Oct, +1 hour Nov–Feb) interact with 24-hour window calculations and daily notification scheduling? Phase 9 testing critical.
4. **GDPR deletion with memberships**: If client requests data deletion, what happens to active memberships? Revenue reconciliation? Deferred per PROJECT.md Phase 5. Design during Phase 10 planning.
5. **Dispute resolution SOP**: When client and owner disagree on forfeit (e.g., "I cancelled 25 hours before, not 24"), who decides? Requires owner policy documentation in bot config.

