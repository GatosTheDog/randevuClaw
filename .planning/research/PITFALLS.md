# Pitfalls: Adding Billing & Membership to Booking System

**Domain:** Chat-native membership/credit system for appointment booking  
**Stack:** Telegram Bot API, Drizzle ORM, Neon Postgres, Gemini AI, setInterval pollers  
**Researched:** 2026-07-17  
**Confidence:** HIGH (Postgres/transaction patterns verified via official docs; notification dedup patterns from production systems)

## Critical Pitfalls

### Pitfall 1: Concurrent Session Deduction Race Condition (Double-Debit)

**What goes wrong:**
Owner books two back-to-back appointments for the same client within a few seconds. Both requests pass through Gemini function-calling sequentially (correct), but each independently reads the client's membership balance (e.g., 10 credits), validates it as ≥ 1, and then deducts. Both see the same initial balance, so both deduct 1 credit, leaving the balance at 9 instead of 8. Credits are lost; client can book without "paying" for the second session.

**Why it happens:**
- Read-then-write pattern without locking: `SELECT balance FROM memberships WHERE client_id = X` followed by `UPDATE ... SET balance = balance - 1` has a gap where a concurrent transaction reads the old balance.
- Gemini sequential execution prevents double *booking* (two events at the same time), but doesn't prevent double *deduction* if the Gemini calls themselves race in response processing.
- Default Postgres READ COMMITTED isolation level doesn't prevent lost updates in read-modify-write scenarios.

**How to avoid:**
1. **Use `SELECT FOR UPDATE` within a transaction** to lock the membership record during the entire deduction operation:
   ```typescript
   await db.transaction(async (tx) => {
     const membership = await tx
       .select()
       .from(memberships)
       .where(eq(memberships.id, membershipId))
       .for('update');  // Lock the row
     
     if (membership.balance < 1) throw new Error('No credits');
     
     await tx
       .update(memberships)
       .set({ balance: sql`balance - 1` })
       .where(eq(memberships.id, membershipId));
   });
   ```
2. **Make Gemini function-calling atomic per booking:** The booking confirmation must be the *only* point where credits are deducted. Do not deduct in confirmation *and* in a separate audit/log step.
3. **Use `SERIALIZABLE` isolation level if high-contention environment emerges:** For now, `SELECT FOR UPDATE` is sufficient for a single-digit concurrent user base, but be prepared to escalate if >100 simultaneous bookings/day.
4. **Test with concurrent booking requests:** Simulate two rapid bookings for the same client; verify balance decreases by exactly 2, not 1.

**Warning signs:**
- Balance audit logs show fewer total deductions than bookings created (e.g., 50 bookings but only 48 credits deducted).
- Client reports "I had 10 credits, booked twice, now I have 9" instead of 8.
- Test with `ab -c 10 -n 100` (10 concurrent requests) to confirm locking prevents race.

**Phase to address:**
**Phase 8 (Enforcement & Session Deduction)** — This is the phase where `create_booking` Gemini function calls `deductMembership()`. Must implement row-level locking before this phase ships.

---

### Pitfall 2: Timezone Edge Cases in Rolling 30/90-Day Expiry Calculations

**What goes wrong:**
Owner records a payment for a client on 2026-07-17 at 2 PM (Athens time, UTC+3). Package says "valid for 30 days." The bot calculates expiry as `2026-07-17 + 30 days = 2026-08-16`. But:
- If a cron poller runs at midnight UTC (3 AM Athens time), it might check expiry as `current_date - expiry_date` without time-of-day, marking the membership as expired on 2026-08-17 when the owner intended 2026-08-17 as the last valid day.
- DST transition (late Oct 2026, Athens shifts from UTC+3 to UTC+2): If the membership is checked at the DST boundary, the `now()` call might jump back 1 hour, causing time-based expiry checks to behave unexpectedly.
- Clients in different timezones (e.g., Greek diaspora) may book via Telegram and expect expiry to respect their local time, not Athens time.

**Why it happens:**
- Storing expiry as a bare `DATE` (without time) loses the intent of "30 days from payment time."
- Using `now()` in Postgres (which respects server timezone, not application timezone) causes silent misalignment.
- Daylight Saving Time transitions cause `now() - timestamp` arithmetic to shift by 1 hour without warning.
- setInterval polling doesn't account for DST transitions; if a poller runs daily at "8 AM", DST means it actually runs at 9 AM for part of the year.

**How to avoid:**
1. **Store expiry as `TIMESTAMP WITH TIME ZONE` (not `DATE`):**
   ```typescript
   // When recording payment at 2:00 PM Athens time
   const expiryTime = new Date('2026-07-17T14:00:00+03:00');
   const expiryTimestamp = new Date(expiryTime.getTime() + 30 * 24 * 60 * 60 * 1000);
   // Stores: 2026-08-16T14:00:00+03:00 (exactly 30 days later, same local time)
   
   await db
     .insert(memberships)
     .values({
       client_id,
       expires_at: expiryTimestamp.toISOString(), // ISO 8601 w/ tz
       created_at: new Date().toISOString(),
     });
   ```
2. **Use explicit timezone context in expirycheck queries:**
   ```typescript
   // Set application timezone to Athens for consistency
   await db.execute(sql`SET TIME ZONE 'Europe/Athens'`);
   
   // Then all now() calls use Athens time
   const expired = await db
     .select()
     .from(memberships)
     .where(lt(memberships.expires_at, sql`now()`));
   ```
3. **For setInterval pollers, use a fixed absolute time (UTC) and convert in code:**
   ```typescript
   setInterval(() => {
     const nowUTC = new Date();
     const nowAthens = new Date(nowUTC.toLocaleString('en-US', { timeZone: 'Europe/Athens' }));
     // Check expiry using Athens local time, not server time
   }, 24 * 60 * 60 * 1000);
   ```
4. **Test expiry at DST boundaries:** Simulate a membership expiring on late Oct 2026 (DST transition day); verify notifications fire on the correct local date, not shifted.
5. **Document timezone assumption:** Add a comment in the db schema: `-- All timestamps stored as UTC; app timezone is Europe/Athens for expiry checks.`

**Warning signs:**
- Expiry notifications arrive on wrong date (e.g., user expects Aug 16, gets notified Aug 15 or Aug 17).
- Membership appears expired in app but UI shows "expires tomorrow."
- DST transition (late Oct) causes batch of false expiry notifications.
- Audit log shows `expires_at = 2026-08-16 00:00:00` (midnight) for a payment recorded at 2 PM.

**Phase to address:**
**Phase 9 (Notifications & Expiry)** — Expiry notifications and enforcement are Phase 9. But **Phase 7 (Config & Payment Recording)** must establish the timezone convention when membership is created. Flag for dual validation: Phase 7 schema, Phase 9 notification logic.

---

### Pitfall 3: Data Integrity on Cancellation After Membership Expired

**What goes wrong:**
Client has a 5-session pass valid until 2026-08-10. On 2026-08-12, the bot marks the membership as expired (no more bookings allowed). But on 2026-08-15, the client asks to cancel an appointment that was booked *before* 2026-08-10. Should the credit be restored?

Outcome A: Credit is restored (naive refund-on-cancel logic), but the membership is expired—so the restored credit is unreachable. Client loses 1 credit, payment dispute ensues.

Outcome B: Credit is *not* restored (refund only if membership is valid), but then the cancel logic must check expiry status *at the time of cancellation*, not at the time of the original booking. If ownership uses a generic "cancel any booking" function without membership awareness, it might restore credits unconditionally.

**Why it happens:**
- The cancel booking flow doesn't distinguish between "cancel within validity window" (refund credit) and "cancel after membership expired" (no refund).
- The membership table doesn't track a "validity_start_date," so there's no way to know if the credit was *ever* valid when the booking was made.
- Compensation/refund logic is written at the booking level without coordination with the membership level.

**How to avoid:**
1. **Store membership validity window explicitly:**
   ```typescript
   const membership = {
     id: UUID,
     client_id: UUID,
     business_id: UUID,
     valid_from: TIMESTAMP, // When membership begins
     expires_at: TIMESTAMP, // When membership ends
     balance: INT,          // Credits remaining
     booked_sessions: []    // Track which bookings used this membership
   };
   ```
2. **Link each booking to the membership used:**
   ```typescript
   const booking = {
     id: UUID,
     membership_id: UUID | NULL, // NULL if booked outside membership, or if no membership
     ...
   };
   ```
3. **Refund only if booking was created *within* membership validity:**
   ```typescript
   async function cancelBookingWithRefund(bookingId: UUID) {
     const booking = await getBooking(bookingId);
     const membership = await getMembership(booking.membership_id);
     
     // Refund only if booking was created during membership validity
     if (membership && membership.valid_from <= booking.created_at && booking.created_at < membership.expires_at) {
       await restoreCredits(membership.id, 1);
     } else {
       // No refund; log reason
       console.log(`No refund: booking created outside membership validity`);
     }
   }
   ```
4. **Audit trail for every credit change:**
   ```typescript
   await db.insert(credit_audit_log).values({
     membership_id,
     reason: 'BOOKING_CANCELLED',
     booking_id,
     delta: +1,
     timestamp: new Date(),
     notes: `Membership valid ${membership.valid_from} to ${membership.expires_at}`,
   });
   ```
5. **Test cancellation edge cases:**
   - Cancel booking created *before* expiry, but cancelled *after* expiry → refund ✓
   - Cancel booking created *after* expiry → no refund ✓
   - Cancel booking created during validity, membership later extended → still refund (because it *was* valid) ✓

**Warning signs:**
- Audit log shows `delta: -1` (credit deducted) but no corresponding `delta: +1` when cancelled.
- Client reports "My membership expired but I still have old bookings; I can't cancel without losing credits."
- Refund transaction logs show credits restored to expired memberships, creating orphaned credits.

**Phase to address:**
**Phase 8 (Enforcement & Session Deduction)** — Must establish the booking↔membership link and track validity window. Refund logic is part of the cancel-booking flow, which is already implemented in v1.0 but must be extended to handle membership awareness. **Prerequisite:** Phase 7 must create the `membership_id` foreign key on bookings.

---

### Pitfall 4: Chat UX Ambiguity in Owner Payment Recording Commands

**What goes wrong:**
Owner sends: `"Πλήρωσε ο Γιάννης 5 περάσματα"` (Giannis paid for 5 passes).

Ambiguities:
- Is "5 passes" a quantity of passes (e.g., 5 × 1-session pass) or 5 sessions within one multi-session pass?
- Is the price included? (e.g., "5 passes for €25" vs. "5 passes" — what's the price?)
- Which package? If the business has "5-session pass €50" and "unlimited pass €100", did Giannis buy one or the other?
- When does it expire? Some passes are "30 days," some are "rolling 90 days."

Outcome: Gemini LLM might guess incorrectly, creating a membership with wrong credit balance, expiry date, or package type. Owner doesn't realize until booking disputes arise.

**Why it happens:**
- Natural language is inherently ambiguous. "5 passes" doesn't specify the package type.
- Owner doesn't follow a structured format (chat is free-form).
- Gemini's function-calling for `create_membership()` has many optional parameters (expiry_type, credit_count, price, etc.), and it must guess the intent.
- No confirmation step: Gemini creates the membership immediately; owner might not realize the mistake until later.
- The bot doesn't ask clarifying questions (e.g., "Is this the 5-session €50 pass or a different package?").

**How to avoid:**
1. **Define a structured payment recording format, but make it optional:**
   - Preferred: `"Γιάννης: 5-pass-50EUR"` (unambiguous, package ID + price)
   - Fallback: `"Γιάννης πλήρωσε"` (Gemini tries to infer, but with caveats)
   
2. **Implement multi-turn clarification:**
   ```typescript
   // Gemini detects ambiguity
   if (geminiResponse.confidence < 0.8 || geminiResponse.clarifications_needed) {
     await sendOwner({
       text: `Γιάννης πλήρωσε; Πιστεύω ότι είναι:\n1️⃣ 5-session pass (€50, expires 30 days)\n2️⃣ Unlimited pass (€100, expires 90 days)\nΕπιλέξτε αριθμό ή γράψτε το σωστό.`,
       reply_markup: quickReplyButtons(['1', '2', 'Cancel']),
     });
   }
   ```
3. **Require confirmation before creating membership:**
   ```typescript
   const summary = `Δημιουργία:\nΠελάτης: Γιάννης\nΠακέτο: 5-session (€50)\nΛήγει: 2026-08-17\nΗμερομηνία: σήμερα\n\nΣωστό; (Ναι/Όχι)`;
   await sendOwner(summary);
   // Wait for "Yes" before actually inserting
   ```
4. **Make package lookup mandatory, not optional:**
   - When recording payment, bot *first* asks "Which package did Giannis buy?" by listing all configured packages.
   - Only after owner confirms package does the bot ask for payment amount.
   - This removes the need for Gemini to guess the package.

5. **Add an "undo" command:**
   ```
   Owner: "Ακύρωση τελευταίας πληρωμής"
   Bot: "Ακύρωση: Γιάννης, 5-session €50, δημιουργία 2026-07-17 14:30\nΤα περάσματα έχουν αφαιρεθεί. Σωστό;"
   ```

**Warning signs:**
- Owner reports "I recorded that Giannis paid for 5 passes, but the bot gave him an unlimited membership."
- Audit log shows `create_membership` with `confidence: 0.4` (Gemini was unsure).
- Multiple membership records for same client on same day (owner tried to fix a mistake by recording payment again).
- Chat history shows bot asking "Is this the 5-session pass?" but owner's response was not parsed.

**Phase to address:**
**Phase 7 (Config & Payment Recording)** — This is the UX design phase. Must establish a payment recording flow that prioritizes clarity over brevity. Use callback queries (buttons) for package selection, not free-form Gemini parsing. Test with actual owners before Phase 7 ships.

---

### Pitfall 5: Duplicate Notification Alerts from setInterval Polling

**What goes wrong:**
A membership expires on 2026-08-10. At 8 AM Athens time, a setInterval poller runs and sends:
```
"Γιάννης, το πακέτό σας λήγει σε 3 ημέρες."
```

But a second poller (or the same poller running twice due to a long-running query) fires 2 minutes later and sends the same message again. Client receives two identical notifications. If the poller runs daily, client gets notified multiple times per day for the same expiry.

Outcome: notification spam, trust erosion, support complaints ("Your bot won't stop bothering me").

**Why it happens:**
- setInterval runs at fixed intervals regardless of how long the previous iteration took. If a poller runs every 60 seconds and takes 30 seconds to complete, another iteration starts before the first is done, causing overlapping execution.
- No deduplication logic: the bot sends a notification without checking "have I already sent this for this membership today?"
- Neon serverless DB might have delayed query responses during cold starts, causing the poller to time out and re-run, duplicating the notification.
- No shared state between poller instances (if code is deployed multiple times or in multiple processes, each sends its own notification).

**How to avoid:**
1. **Track sent notifications in the database:**
   ```typescript
   const notificationLog = {
     id: UUID,
     membership_id: UUID,
     notification_type: 'EXPIRY_3_DAYS' | 'EXPIRY_1_DAY' | 'EXPIRED',
     sent_at: TIMESTAMP,
     business_id: UUID,
   };
   
   // Before sending expiry notification
   const lastNotif = await db
     .select()
     .from(notificationLog)
     .where(
       and(
         eq(notificationLog.membership_id, membershipId),
         eq(notificationLog.notification_type, 'EXPIRY_3_DAYS'),
         gte(notificationLog.sent_at, sql`now() - interval '1 day'`)
       )
     )
     .limit(1);
   
   if (!lastNotif) {
     // Send notification and log it
     await sendNotification(...);
     await db.insert(notificationLog).values({
       membership_id: membershipId,
       notification_type: 'EXPIRY_3_DAYS',
       sent_at: new Date(),
     });
   }
   ```

2. **Use database UNIQUE constraint to prevent duplicate inserts:**
   ```sql
   CREATE UNIQUE INDEX uq_notification_log_daily
   ON notification_log (membership_id, notification_type, DATE(sent_at AT TIME ZONE 'Europe/Athens'))
   WHERE sent_at > now() - interval '24 hours';
   ```
   This allows only one notification per membership per notification_type per day.

3. **Use idempotent notification IDs:**
   ```typescript
   const notifId = `${membershipId}:EXPIRY_3_DAYS:${todayDateInAthens}`;
   await sendNotification({
     idempotency_key: notifId, // External message queue deduplicates by this
     text: '...',
   });
   ```

4. **Prevent concurrent poller execution:**
   ```typescript
   let isRunning = false;
   setInterval(async () => {
     if (isRunning) return; // Skip this cycle if previous one is still running
     isRunning = true;
     try {
       await scanAndNotifyExpiries();
     } finally {
       isRunning = false;
     }
   }, 60_000);
   ```

5. **Use a distributed lock (if multi-process):**
   Since you're using fly.io with a single process (scale: 1 for the cron poller), the above `isRunning` flag is sufficient. But if you ever scale to multiple processes:
   ```typescript
   // Acquire lock in Postgres
   const lock = await db.execute(sql`
     SELECT pg_advisory_lock(${POLLER_LOCK_ID});
   `);
   try {
     await scanAndNotifyExpiries();
   } finally {
     await db.execute(sql`SELECT pg_advisory_unlock(${POLLER_LOCK_ID});`);
   }
   ```

**Warning signs:**
- Client says "I got the same message 3 times in 5 minutes."
- Notification log has duplicate rows for the same membership on the same day with timestamps 1–2 minutes apart.
- User mutes the bot's notifications to avoid spam.
- Support ticket: "Why do I keep getting told my membership expires?"

**Phase to address:**
**Phase 9 (Notifications & Expiry)** — The notification scanning and sending logic lives here. Must implement deduplication before sending the first notification. Test by running the poller twice manually and confirming only one notification is sent.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| **Deduct credits without transaction lock (SELECT for UPDATE)** | Faster response, simpler code (~5 lines of SQL vs. 15 with transaction) | Double-spending bugs, data integrity loss, refund disputes, angry users | Never. Use transaction locking from Phase 8 day 1. Recovery is expensive. |
| **Store expiry as DATE (not TIMESTAMP)** | Simpler schema, easier date math | Timezone bugs, DST issues, ambiguous expiry time (midnight? end of day?), confusion about "30 days" | Never in a timezone-aware app. Use TIMESTAMP WITH TIME ZONE always. |
| **Rely on app-level deduplication instead of DB constraints** | Faster to implement (one line of code vs. migration + index) | Race conditions between dedup check and insert, duplicate notifications in high-traffic scenarios, audit confusion | Only for testing. For production, add UNIQUE constraint + handle conflict in code. |
| **Skip confirmation step for payment recording** | Fewer chat turns, faster UX | Mistakes are silent, support load increases, data integrity issues | Only if package ID is machine-readable and unambiguous. Require confirmation for free-form input. |
| **Use setInterval with no timeout guard** | Simpler code, fewer edge cases | Overlapping poller executions, duplicate notifications, cascade failures if DB query hangs | Never. Always add `isRunning` flag or distributed lock. |
| **No audit trail for membership changes** | Fewer schema columns, smaller DB | Impossible to debug disputes, no way to trace credit origins, GDPR audit compliance risk | Never. Every credit change (deduct, restore, expire) must log reason + context. |
| **Gemini function-calling for ambiguous payment records** | Fewer structured inputs, conversational feel | Silent mistakes, wrong packages assigned, Gemini hallucination risks | Only with explicit confirmation step. Never create membership without owner approval. |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Neon Serverless Postgres** | Assuming persistent connection pooling like traditional DBaaS. Long-running queries cause connection reuse delays. | Use Drizzle's connection pooling; set `statement_timeout = 30s` to prevent long queries from blocking pollers. Test poller latency under load. |
| **Drizzle ORM + SELECT FOR UPDATE** | Trying to use `.for('update')` outside of a transaction, or forgetting to read the locked row before updating. | Always wrap in `db.transaction(async (tx) => { const row = await tx.select()...for('update'); ... })`. Don't try to lock and then query separately. |
| **Gemini function-calling + membership validation** | Gemini hallucinating a package ID that doesn't exist, or making up an expiry date. | Always validate Gemini's proposed membership against the actual packages in the database. Return an error to Gemini if invalid, force it to ask the owner to clarify. |
| **Telegram Bot API + async message sending** | Fire-and-forget notifications without waiting for success. If Telegram rate-limits or the message fails, there's no retry. | Wrap message sends in retry logic with exponential backoff. Log send failures to audit trail. |
| **setInterval + time-based expiry checks** | Using `new Date()` in JavaScript (client-side timezone) instead of `now()` in Postgres (server timezone). Expiry checks happen at wrong times. | Set application timezone globally. Use Postgres `now()` for all expiry logic. Convert to Athens time explicitly in app code. |
| **Google Calendar API + DST transitions** | Calendar events are created in one timezone, but DST changes the effective time. Users see their appointment at a different time than expected. | Store appointment times in ISO 8601 format with timezone. Use `datetime.tzinfo` in Python or `.toISOString()` in Node for explicit timezone handling. Test at DST boundaries. |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| **Full table scan for expiry notifications** | Poller takes 10 seconds to complete when there are 100 memberships; 5 minutes when there are 10,000. | Add index on `(expires_at, notified_at)` and query only memberships expiring in the next 3 days. | 1,000+ memberships per business, or 100+ businesses. |
| **SELECT FOR UPDATE on heavily-booked membership** | Lock waits pile up; bookings start failing with "lock timeout." | Shorten the critical section: lock only during the `balance - 1` operation, not for validation. Use `SKIP LOCKED` in rare conflict scenarios. | 50+ concurrent bookings/minute for same client. |
| **setInterval poller running every 60 seconds** | CPU usage stays low, but notifications arrive 1–2 minutes late instead of immediately. | For expiry notifications (non-urgent), 60s is fine. For booking alerts (time-sensitive), use webhook instead of polling. | 1,000+ notifications/minute. Switch to event-driven architecture. |
| **Duplicate notification query without index** | Poller scans entire `notification_log` for each membership before sending. | Add composite index: `(membership_id, notification_type, DATE(sent_at))`. Query only last 24 hours. | 100,000+ notification log rows. |
| **Logging every credit change** | Audit log grows unbounded; queries slow as table size increases. | Partition audit log by month. Archive old logs. Add retention policy (e.g., keep 1 year). | 1M+ audit log rows. |
| **No connection pooling with Neon** | Each booking request opens a new connection to Neon. Connection overhead dominates query time. | Use Drizzle's built-in pooling or Neon's PgBouncer. Set pool size to 10–20. | 100+ concurrent requests. |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|-----------|
| **Logging credit balance in chat messages** | If chat logs are leaked or archived unencrypted, attacker sees how much each client is "worth" (target for fraud). | Only log balance changes in audit table, never in chat message content. If you must show balance, encrypt sensitive fields. |
| **Allowing Gemini to infer client identity from payment text** | Owner says "Γιάννης πλήρωσε," Gemini matches it to a client by name search. But what if two clients have similar names? Wrong client gets the credit. | Never infer client from text. Require explicit client selection (buttons with client names, or a phone number lookup). |
| **No validation of payment amounts** | Owner says "Γιάννης πλήρωσε 1,000 EUR" by accident (instead of 100). Bot creates membership worth 1,000 EUR. | Validate that payment amount matches a known package price. If it doesn't, ask owner to confirm or re-enter. |
| **Storing payment records without context** | If a client disputes a charge, you have no way to prove they requested the membership (they could claim unauthorized access). | Require owner to explicitly confirm the payment before recording (via button click or typed confirmation). Log the confirmation timestamp + content. |
| **Exposing membership IDs in chat** | Owner sees "Membership 12345 created." If an attacker finds this ID, they might be able to query or modify it. | Use opaque client IDs in chat (e.g., "Γιάννης" instead of "client_12345"). Never leak internal UUIDs to users. |
| **No rate limiting on payment recording** | Attacker (or buggy script) sends 1,000 payment commands to the bot in 1 second. All are processed. | Implement rate limiting: max 5 payment records per hour per business. Log and alert on rate limit exceeded. |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| **Unclear expiry notification timing** | Client gets notified "Your membership expires in 3 days," but doesn't know if that means 3 calendar days, 72 hours, or "by the end of the third day." Books another appointment, then finds out they can't book it. | Use precise language: "Your pass expires 2026-08-17 at 23:59 (Athens time)" or "You have 3 days left: Aug 14, 15, 16." Show the exact expiry date and time. |
| **No way to see membership balance mid-conversation** | Client asks "How many classes do I have left?" Bot responds with a static balance that might be outdated (especially if a booking was just created). | Add a client-facing "balance" query command. Query live balance from DB every time. Cache result for 1 minute to avoid overload. |
| **"You have no credits" error without recovery path** | Client books and gets rejected: "No valid membership." Bot doesn't explain what to do next (buy a pass? contact owner?). | On rejection, immediately suggest next steps: "You have no credits. Your owner is Alice (alice@example.com). Send her 'I want to buy a pass.' in this chat." |
| **Owner doesn't know what packages they've configured** | Owner tries to record a payment: "I sold a 5-session pass." But they actually created a "5-class package," and the names don't match. Confusion ensues. | When owner starts payment recording, bot lists all active packages: "Which package did they buy? 1️⃣ 5-class €50 (30 days) 2️⃣ Unlimited €100 (90 days)". Buttons, not free text. |
| **No confirmation of membership creation** | Owner records payment. Bot immediately creates membership. Owner realizes they made a typo (e.g., "Γιάννη" instead of "Γιάννης"). Undo is not intuitive. | Show a summary before committing: "Creating: Giannis, 5-class €50, expires Aug 17. Correct? ✅ Confirm / ❌ Cancel". Only create on "Confirm." |
| **Notification spam** | Client gets 5 identical "Your membership expires soon" messages. Stops reading bot messages altogether. | Deduplicate by membership + notification_type + date. Send once per day maximum. Provide a "do not remind me" option. |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Session Deduction:** Deduction logic prevents double-spending even if two bookings are confirmed simultaneously *for the same client*. Verify with concurrent test: 2 rapid bookings, check balance decreases by exactly 2.

- [ ] **Cancellation Refunds:** Cancelled bookings restore credits *only if the booking was created during membership validity*. Test: book during valid period, cancel after membership expired → no refund. Book after expiry → no refund (or error).

- [ ] **Expiry Enforcement:** Bookings are rejected (or flagged for owner review) if client has no valid membership. Verify: membership expires, next booking is rejected with clear message.

- [ ] **Timezone Consistency:** All expiry dates are stored as TIMESTAMP WITH TIME ZONE. Expiry checks use Athens timezone explicitly (not server timezone). DST transitions don't cause silent date shifts. Test: create membership expiring on Oct 26, 2026 (DST boundary in Greece), verify expiry notification fires on correct date.

- [ ] **Notification Deduplication:** Client receives each expiry notification (3 days before, 1 day before, on expiry day) *at most once per day*. Test: run poller twice, confirm only one notification sent. Check notification_log for duplicates.

- [ ] **Audit Trail:** Every credit change (deduct, restore, expire) is logged to audit table with reason, amount, booking_id, and timestamp. Verify: run 10 bookings, check audit log has 10 entries with correct deltas.

- [ ] **Payment Recording UX:** Owner must explicitly confirm payment amount and package before membership is created. Test: owner tries to record payment; bot shows summary; if owner doesn't confirm, membership is not created. Undo is available if owner made a mistake.

- [ ] **Error Messages:** When membership validation fails (expired, insufficient credits), bot shows client the expiry date *and* owner contact info. Verify: rejected booking includes "Contact Alice (alice@example.com) to buy a pass."

- [ ] **Rate Limiting:** Payment recording commands are rate-limited (e.g., max 10 per hour per business). Test: send 20 payment records in 1 minute, verify 11–20 are rejected with "rate limited" message.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| **Double-deducted credits (Pitfall 1)** | MEDIUM | 1. Query audit_log for duplicate deductions on same booking/time. 2. Identify affected memberships. 3. INSERT compensating credit in audit_log with reason='RACE_CONDITION_CORRECTION'. 4. UPDATE memberships SET balance = balance + 1 WHERE id IN (affected). 5. Notify affected clients "credit restored due to system error." 6. Log incident & root cause in retro. |
| **Incorrect expiry date (Pitfall 2)** | MEDIUM | 1. Query memberships WHERE expires_at is wrong (e.g., midnight instead of intended time). 2. Fix with UPDATE memberships SET expires_at = correct_date WHERE id IN (...). 3. Resend expiry notifications if expiry date was extended. 4. If memships were marked expired prematurely, restore any cancelled-with-no-refund bookings. |
| **Cancelled booking with no refund when should have been refunded (Pitfall 3)** | LOW–MEDIUM | 1. Query booking WHERE cancelled_at, check membership.valid_from vs booking.created_at. 2. If booking was created during validity, issue compensating credit. 3. Notify client "credit restored for booking cancelled in error." |
| **Wrong package assigned during payment recording (Pitfall 4)** | LOW | 1. Owner notices mistake immediately (within same chat session). 2. Issue undo command or call support flow. 3. If discovered later, manually correct: UPDATE memberships SET package_id = correct_id. 4. If balance changed, audit & notify. |
| **Duplicate notifications sent (Pitfall 5)** | LOW | 1. Query notification_log, identify duplicates. 2. DELETE duplicate rows (keep the first one per membership per day). 3. Implement dedup check & rerun poller. 4. Notify affected clients "duplicate notifications were a system error; one real notification was sent." |
| **Membership expired but old bookings exist** | MEDIUM | 1. Write one-off migration: for each cancelled booking after membership expired, check if refund should have been issued. 2. Issue credits to affected clients. 3. Audit trail explains correction. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Concurrent session deduction race condition | **Phase 8 (Enforcement & Session Deduction)** | Run concurrent booking requests (e.g., `ab -c 5 -n 20`); verify final balance is correct. Check for missing transactions in audit_log. |
| Timezone edge cases in rolling expiry | **Phase 7 (Config & Payment Recording)** [schema] + **Phase 9 (Notifications & Expiry)** [enforcement] | Create membership at 2 PM, set expiry to +30 days. Verify expiry timestamp is 2026-08-16T14:00:00+03:00 (not midnight). Run poller at DST boundary; confirm notification fires on correct date. |
| Data integrity on cancellation after expiry | **Phase 8 (Enforcement & Session Deduction)** | Create booking, let membership expire, cancel booking. Verify: no credit restored. Create booking, cancel before expiry. Verify: credit restored. Test both paths. |
| Chat UX ambiguity in payment recording | **Phase 7 (Config & Payment Recording)** | Walk through payment recording flow with actual owner. Confirm package selection is unambiguous (buttons, not free text). Verify confirmation step is required. |
| Duplicate notification alerts from setInterval polling | **Phase 9 (Notifications & Expiry)** | Run poller twice manually; verify only one notification sent. Query notification_log for duplicates (should be zero). Test under load with 100+ memberships. |
| No transaction locking on deduction | **Phase 8** | Same as session deduction race. |
| No audit trail | **Phase 7** [schema] + **Phase 8** [write operations] | For each credit-affecting operation (deduct, restore, expire), verify audit_log has exactly one entry with correct reason + context. |
| Ambiguous confirmation for payment | **Phase 7** | Owner records payment; bot shows summary; verify owner must click "Confirm" to proceed. Test: close chat without confirming → membership not created. |
| Rate limiting not implemented | **Phase 7** | Send 20 payment records in 1 minute; verify 11–20 are rejected with rate-limit error. |

---

## Sources

### Concurrent Access & Race Conditions
- [How to Solve Race Conditions in a Booking System](https://hackernoon.com/how-to-solve-race-conditions-in-a-booking-system) — HackerNoon, discusses lost updates and SELECT FOR UPDATE
- [Hands-on Preventing Database Race Conditions with Redis](https://iniakunhuda.medium.com/hands-on-preventing-database-race-conditions-with-redis-2c94453c1e47) — Medium, distributed locking strategies
- [PostgreSQL Transaction Isolation Levels](https://www.postgresql.org/docs/current/transaction-iso.html) — Official PostgreSQL docs
- [Understanding Isolation in PostgreSQL: MVCC & ACID](https://dev.to/kfir-g/understanding-isolation-in-postgresql-a-deep-dive-into-the-i-in-acid-3650) — DEV Community

### Timezone Issues & DST Handling
- [How to Handle Date and Time Correctly to Avoid Timezone Bugs](https://dev.to/kcsujeet/how-to-handle-date-and-time-correctly-to-avoid-timezone-bugs-4o03) — DEV Community
- [Time Zones in Billing: Why Getting This Wrong Costs Real Money](https://getlago.com/blog/time-zone-nightmares) — Lago Blog (billing-specific)
- [Understanding Time Zones and Subscription Billing](https://help.supliful.com/en/articles/8498900-understanding-time-zones-and-subscription-billing-a-guide-for-subscribers) — Supliful Help Center

### Payment Integrity & Double-Spending
- [Stripe Refunds Documentation](https://docs.stripe.com/refunds) — Official Stripe docs on refund processing & double-refund risks
- [Clear Refund Rules in Membership Agreements](https://www.glueup.com/blog/clear-refund-rules-sample-membership-agreement) — Glue Up blog, membership refund best practices
- [Understanding Refund Policies for Subscription Services](https://www.19pine.ai/blog/refund-policies-subscription) — Pine AI

### Notification Deduplication & Polling
- [How to Build Alert Deduplication Logic](https://oneuptime.com/blog/post/2026-01-30-alert-deduplication/view) — Oneuptime Blog
- [How Deduplication Works in Zapier](https://docs.zapier.com/platform/build/deduplication) — Zapier Platform Docs
- [Idempotency & Deduplication in System Design](https://www.systemdesignsandbox.com/learn/idempotency-deduplication) — System Design Sandbox
- [How to Handle Kafka Message Deduplication](https://oneuptime.com/blog/post/2026-01-24-kafka-message-deduplication/view) — Oneuptime Blog

### Chat UX & Natural Language
- [Chatbot UX Fail & Design Best Practices 2026](https://lollypop.design/blog/2025/january/chatbot-ui-ux-design-best-practices-examples/) — Lollypop Design
- [Reducing User Query Ambiguity Through Chatbot Clarifying Questions](https://image-ppubs.opensource.google/dirsearch-public/print/downloadPdf/11423066) — USPTO patent, clarification patterns

### Drizzle ORM & Postgres Integration
- [Drizzle ORM Transactions Documentation](https://orm.drizzle.team/docs/transactions) — Official Drizzle docs
- [SELECT FOR UPDATE Support in Drizzle](https://github.com/drizzle-team/drizzle-orm/discussions/1337) — Drizzle GitHub discussion
- [Drizzle Row-Level Security (RLS)](https://orm.drizzle.team/docs/rls) — Drizzle docs for multi-tenant isolation

### Membership & Subscription Cancellation Patterns
- [Stripe Cancel Subscriptions Documentation](https://docs.stripe.com/billing/subscriptions/cancel) — Stripe best practices for cancellation
- [Cancel Flow Examples: Netflix, Canva, Spotify 2026](https://www.subjolt.com/guides/cancel-flows-that-convert/) — Subjolt, UX patterns for cancellation

---

*Pitfalls research for: Chat-native appointment booking with membership/credit system*  
*Researched: 2026-07-17*  
*Confidence: HIGH (core patterns verified; recommendations based on production SaaS + Postgres best practices)*
