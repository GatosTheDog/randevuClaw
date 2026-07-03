# Domain Pitfalls: WhatsApp Booking Platform for Greek Businesses

**Domain:** WhatsApp-native multi-tenant appointment booking platform with AI agent, Greek language, Google Calendar sync
**Researched:** 2026-07-03
**Confidence:** HIGH

---

## Critical Pitfalls

### Pitfall 1: Meta Business Verification Delays Block Launch

**What goes wrong:**
A single name mismatch across touchpoints (Meta Business Info, registration documents, website, address proof, authorized admin) causes Meta to reject verification and request resubmission. Approval can take 1–6 weeks depending on review backlog and completeness. For a $0-budget PoC, this is the primary blocker to using WhatsApp Cloud API at all.

**Why it happens:**
Meta's verification process is manual and requires consistency across legal documents, which small businesses typically have mismatches (DBA names, formatted addresses, exact legal entity names). Developers often rush this step assuming it's "just paperwork."

**How to avoid:**
- Audit all legal documents BEFORE submitting to Meta: exact match on business name, address, legal entity type, and authorized signatory across registration, website, privacy policy, and Meta Business Info.
- Start verification immediately when prototyping (do NOT wait until "almost ready for launch") because the 1–6 week delay is the critical path.
- Use a checklist: business name consistency, authorized admin identity, website presence, privacy policy URL, registration document scan quality.
- Do NOT assume free tier = instant approval; free tier is still subject to the same verification as paid.

**Warning signs:**
- Meta rejects your submission with a vague message about "document mismatch" — re-read the exact rejection reason and cross-check all four touchpoints.
- Resubmission after first rejection adds another 1–2 weeks.
- Approaching launch date with verification still pending — this is a hidden-delay crisis.

**Phase to address:**
Phase 1 (Architecture & Setup): Start verification immediately; do not treat it as a launch-week task. Verification completion should be a hard gate before any client-facing prototype.

---

### Pitfall 2: WhatsApp 24-Hour Customer Service Window Breaks Reminders/Notifications

**What goes wrong:**
You send a WhatsApp appointment reminder 48 hours before the appointment. WhatsApp silently throttles/blocks the message because you're outside the 24-hour customer service window and you haven't created (or your template was rejected). Users never receive reminders and no-shows spike. The 24-hour window restarts each time a customer messages you; outside that window, all business-initiated messages must use Meta-approved templates.

**Why it happens:**
Developers assume WhatsApp is like SMS and can send messages anytime; they don't realize the strict 24-hour window and template requirement. Template approval itself takes 24–48 hours, so there's a cascading dependency: you can't send reminders until templates are approved.

**How to avoid:**
- Create and submit (Utility category) message templates for:
  - Appointment confirmation (with booking details)
  - 24-hour reminder (with appointment time and cancellation link)
  - Cancellation acknowledgment
  - Daily agenda for business owners
  - Template approval typically takes 24 hours; treat this as a blocking dependency.
- Do NOT assume custom messaging outside the 24-hour window is possible; it isn't for new customers.
- Design your UX around template constraints: keep variables minimal, structure messages for readability within templates.
- Implement fallback: if reminder template is rejected, you can only send custom reminders within 24 hours of a customer's last message (which may be insufficient).

**Warning signs:**
- You send a test reminder and it doesn't arrive, but no error is logged by the WhatsApp API.
- Template approval takes >2 days; resubmit if unclear why it was rejected.
- Real-time monitoring: check WhatsApp Business Account dashboard for "rejected" or "pending" template status.

**Phase to address:**
Phase 2 (Message Flow): Define all templates, test approval workflow, and implement fallback reminder strategy (within 24-hour window) before implementing reminder jobs.

---

### Pitfall 3: LLM Function-Calling Double-Booking and Race Conditions

**What goes wrong:**
Two clients message in quick succession, both requesting the same time slot. The LLM function-call loop processes both requests simultaneously (or with insufficient locking), and the system books both of them to the same slot. Or: the LLM "hallucinates" that a slot is available when it's already booked, because it's operating on stale state or making multiple write calls without coordination.

**Why it happens:**
Developers treat LLM function calling as fire-and-forget. Parallel tool calls for database writes (book_appointment, check_availability, update_calendar) without idempotency keys or transaction isolation allow race conditions. Gemini's free tier also has rate limits that can cause partial failures (one write succeeds, another fails) leading to data corruption.

**How to avoid:**
- **Enforce sequential booking logic:** Do NOT let LLM call booking functions in parallel. Wrap all booking actions in a database transaction with row-level locks on the availability slot.
- **Idempotency keys:** Every function call must include a unique request ID that the database persists; a duplicate request with the same ID returns cached result, not a re-execution.
- **Slot locking:** When checking availability, immediately reserve the slot with a temporary hold (expires in 5 minutes). Do not allow multiple reserves of the same slot in the same transaction.
- **Function-call orchestration:** Enforce strict ordering: check_availability → reserve_slot → (LLM receives confirmation) → book_appointment. Do not parallelize these.
- **Rate limit handling:** If Gemini returns a rate-limit error during booking, rollback the entire transaction and inform the client to retry; do not proceed with partial state.

**Warning signs:**
- Two bookings appear in the database for the same time slot from different messages.
- Logs show that check_availability was called but book_appointment never ran, leaving dangling reservations.
- Rapid-fire test messages cause inconsistent outcomes (sometimes books successfully, sometimes doesn't).
- LLM confidently offers a time that's already booked according to the database.

**Phase to address:**
Phase 2 (Booking Flow): Implement database-level concurrency control and idempotency framework before the first user test. This is not a nice-to-have; it's a functional requirement.

---

### Pitfall 4: Gemini Free Tier Rate Limits Silently Break Under Load

**What goes wrong:**
You ship the PoC and it works fine with test messages (1–2 req/min). One week later, the system gets 15+ queries/min as real users arrive. Gemini starts returning 429 (Too Many Requests) errors. Your error handling logs them, but does not retry or notify users. Booking requests hang, clients get confused, and your bot appears broken.

Current free tier limits (2026):
- Gemini 2.5 Pro: 5 RPM (requests per minute), 100 RPD (requests per day)
- Gemini 2.5 Flash: 10 RPM, 100 RPD
- Gemini Flash-Lite: 15 RPM, 100 RPD

**Why it happens:**
Developers assume free tier is "unlimited" or test locally without simulating real load. Rate limits are per project (not per API key), so adding more keys does NOT increase quota. By the time you realize the limit is hit, users are already experiencing failures.

**How to avoid:**
- **Load test early:** Simulate 15–20 concurrent booking requests before shipping. You will hit rate limits.
- **Implement exponential backoff with jitter:** If Gemini returns 429, retry with increasing delays (1s, 2s, 4s, 8s, etc.). Do NOT retry immediately.
- **Circuit breaker pattern:** If rate limit is hit twice in 1 minute, switch to a fallback (e.g., "Sorry, I'm handling lots of bookings; can you try in 2 minutes?" or queue the request).
- **Upgrade plan:** Gemini free tier is NOT suitable for production. Budget for Gemini's paid tier ($15+/month) before launch, or implement a secondary LLM provider (e.g., Claude API) for fallback.
- **Monitor quota usage:** Use the Gemini API Studio dashboard and set up alerts for reaching 80% of daily quota.
- **Disable retry loops in LLM:** Do NOT let the LLM retry function calls infinitely on rate limit; it wastes quota and confuses the conversation.

**Warning signs:**
- Test with 10+ concurrent messages; if any return 429 errors, you've hit the limit.
- Logs show "rate limit exceeded" without retry logic.
- API response includes headers like `x-ratelimit-remaining-requests: 0`.
- Users report that bookings sometimes work, sometimes hang.

**Phase to address:**
Phase 2 (AI Agent): Implement rate-limit detection and fallback strategy. Phase 3 (Load Testing): Stress-test the entire system with realistic concurrency.

---

### Pitfall 5: Multi-Tenant Business Disambiguation Context Loss

**What goes wrong:**
A client sends "I want to book a pilates class" on the shared WhatsApp number. Your bot queries the database without filtering by tenant/business context and returns availability for ALL businesses, or books to the wrong one. Or: a business owner sends a message that should configure THEIR schedule, but the bot applies it to a different business because tenant context was lost between the message route and the database query.

**Why it happens:**
The shared-number architecture requires every action to carry a tenant ID (business ID). If the tenant context is not propagated through the LLM function-calling loop to the database, every query and write becomes a data leak risk. This is especially dangerous because it's silent—no error is thrown, but data goes to the wrong place.

**How to avoid:**
- **Tenant ID in headers:** Extract tenant context from the message metadata (WhatsApp Business Account ID or a business code embedded in the incoming message) and store it in a request-scoped context (e.g., Node.js AsyncLocalStorage).
- **Enforce tenant filtering at database layer:** Every query must include `WHERE tenant_id = ?`. Use an ORM hook or database view to make this automatic, so developers cannot forget it.
- **LLM tool definitions:** Include tenant_id as a required parameter (not optional) in every function definition the LLM can call. The LLM should receive tenant_id once and use it in all function calls.
- **Message routing:** Map incoming WhatsApp messages to a tenant BEFORE they reach the LLM. If you cannot determine the tenant (e.g., new client, no business code in message), ask the user to clarify ("Which business are you booking with?") before proceeding.
- **Audit log:** Log every database read/write with the tenant_id used. Periodically audit for cross-tenant access patterns.

**Warning signs:**
- A business owner reports that another business's bookings appeared in their calendar.
- Database queries run successfully but return data for the wrong business.
- The LLM calls a booking function but does not include business_id in the parameters.
- Client data appears mixed across businesses in logs.

**Phase to address:**
Phase 1 (Architecture): Design multi-tenancy from the start. This is a structural issue that is expensive to retrofit. Include a multi-tenancy audit in the Phase 1 completion checklist.

---

### Pitfall 6: Greek Date/Time Parsing Fails for Relative Expressions

**What goes wrong:**
Client writes "αύριο στις 5" (tomorrow at 5) or "την Παρασκευή" (Friday). Your NLP date parser (or LLM) misinterprets this, resulting in bookings for the wrong day or no day at all. In Greek, relative temporal expressions (αύριο, μεθαύριο, προχθές) have no standardized parsing outside of general-purpose NLP libraries, and generic parsers often fail on colloquial phrasing.

**Why it happens:**
Developers assume generic NLP libraries (like dateparser) or the LLM's built-in date understanding will handle Greek seamlessly. They don't; Greek morphology is complex, and relative expressions require context (what is "today" in the user's timezone?). Timezone is Europe/Athens, but the LLM may not know that.

**How to avoid:**
- **Pre-process Greek temporal expressions:** Before sending user input to the LLM, use a Greek-specific NLP library (e.g., gr-nlp-toolkit) or implement a simple mapping for common phrases:
  - "αύριο" → tomorrow (system date + 1 day)
  - "μεθαύριο" → day after tomorrow (system date + 2 days)
  - "πρόχθες" → day before yesterday
  - Days of the week: "Παρασκευή", "Σάββατο", etc. → next occurrence of that weekday
- **Enforce Europe/Athens timezone:** Store all times in UTC internally, but always parse user input as Europe/Athens. When displaying times back to users, convert to Europe/Athens.
- **Confirmation pattern:** After the LLM extracts a date, always confirm with the user: "Καταλαβαίνω ότι θέλεις Παρασκευή 4 Ιουλίου, 5 π.μ., σωστά;" (I understand you want Friday, July 4 at 5 a.m., correct?). Let them correct if wrong.
- **Test thoroughly:** Build a test corpus of Greek temporal phrases and verify the parser handles them correctly. This is not a generic NLP problem; it requires domain-specific tuning.

**Warning signs:**
- Bookings are consistently for the wrong day or time when clients use relative phrases.
- The LLM asks clarifying questions about dates repeatedly because it's uncertain.
- Users report that they booked "αύριο" but the system showed a different date.

**Phase to address:**
Phase 2 (AI Agent): Implement Greek-specific date parsing before the first user test. Test with real Greek temporal phrases from your target audience.

---

### Pitfall 7: Google Calendar Sync Fails Under Timezone/Timezone Conflicts

**What goes wrong:**
A business owner's appointment is booked at 5 p.m. (Europe/Athens, UTC+3). The event is synced to Google Calendar, but it appears at 3 p.m. or 7 p.m. due to timezone mismatch. Or: you attempt to update an existing event (based on event ID), but the update creates a duplicate event instead because the sync token is stale or the event ID mapping is lost.

**Why it happens:**
Google Calendar API requires explicit timezone handling. If you don't specify `timeZone: "Europe/Athens"` in the API call, the API assumes the calendar's default timezone (which may be different). Recurring events require timezone in the recurrence rule. If you don't track event IDs correctly, you lose the ability to update existing events.

**How to avoid:**
- **Always specify timezone:** Every calendar.events.insert() or update() call must include `timeZone: "Europe/Athens"` in the eventDateTime.
- **Store event IDs:** When syncing a booking to Google Calendar, store the Google Calendar event ID in your database, keyed to the booking ID. Never rely on reconstructing the event ID later.
- **Use sync tokens:** For incremental sync (checking for owner-side changes), use Google's syncToken mechanism to efficiently detect changes without polling all events.
- **Handle recurring events:** If a business offers recurring services, the recurrence rule must include the timezone. Do NOT omit timezone from recurrence rules.
- **Conflict detection:** Before inserting an event, query the calendar for overlapping events in the same time slot. Google Calendar does NOT enforce no-conflicts on insert; you must.
- **Test timezone edge cases:** Create bookings around timezone transition dates (DST changes in Greece, which occur in late March and late October). Verify times are correct before/after transitions.

**Warning signs:**
- Events appear at different times in Google Calendar vs. your WhatsApp booking message.
- After updating a booking, two calendar events exist (old and new) instead of one updated event.
- Event ID lookups fail because the stored ID doesn't match the Calendar API ID.
- Recurring bookings have timezone mismatches between the recurrence rule and event times.

**Phase to address:**
Phase 3 (Google Calendar Sync): Implement with timezone testing from day one. This is NOT a cosmetic issue; it breaks the core value of "owner's calendar updates automatically."

---

### Pitfall 8: Scheduled Reminder Jobs on fly.io Miss Runs or Send Duplicates

**What goes wrong:**
You set up a cron job on fly.io to send daily reminder messages (e.g., 8 a.m. each day for appointments that day). On some days, the job doesn't run at all, or it runs twice, sending duplicate reminders to clients. Machine resumes from suspend cause clock skew, causing the job to fire at the wrong time. Timezone handling is broken; the job runs at UTC but your business is in Europe/Athens, so reminders arrive at the wrong time.

**Why it happens:**
fly.io's edge network doesn't guarantee exactly-once execution for cron jobs without explicit coordination. When a Machine resumes from suspend, its system clock is temporarily out-of-sync, breaking time-based triggers. Developers often don't implement idempotency for scheduled jobs, assuming "it's just scheduled once," but fly.io's infrastructure can execute the job multiple times.

**How to avoid:**
- **Use fly.io Cron Manager (recommended):** fly.io's "batteries-included" solution spins up isolated Machines for each cron job, preventing configuration drift and duplicate executions. This is the safest approach for a production system.
- **Idempotency for cron jobs:** If implementing your own cron (e.g., node-cron), every job run must be idempotent. Before sending reminders, check if reminders were already sent for that date. Use a database table to track "reminder_job_run" with date + business_id + job_type to prevent duplicates.
- **Timezone handling:** Store the job's execution time in Europe/Athens, not UTC. Use a library like date-fns or day.js with timezone support to compute the next run time correctly.
- **Monitor and alert:** Log every cron job execution (start time, end time, number of reminders sent). Set up alerts if a job doesn't run for 24+ hours or if more reminders are sent than expected.
- **Graceful degradation:** If the reminder job fails, do NOT silently ignore it. Log the error and implement retry logic (but only after the 24-hour window is guaranteed to have closed).

**Warning signs:**
- A cron job scheduled for 8 a.m. runs at 7 a.m. or 9 a.m. on some days.
- Clients receive the same reminder message twice.
- Logs show the job was triggered multiple times in a single 5-minute period.
- The job doesn't run for a full day, then runs with a backlog of delayed messages.

**Phase to address:**
Phase 3 (Reminders & Notifications): Use fly.io Cron Manager from day one. Do NOT implement custom cron on fly.io; the built-in solution is purpose-built to avoid these pitfalls.

---

### Pitfall 9: GDPR Non-Compliance for Greek Client Data

**What goes wrong:**
You store Greek clients' phone numbers, booking history, and personal preferences in your Neon database without documenting a lawful basis for processing (e.g., consent, contract), without implementing access controls, and without a data retention policy. If a user asks for their data (Article 15 right of access) or requests deletion (Article 17 right to erasure), your system has no way to comply within 30 days. Or: a data breach occurs, and you have no incident response plan. The Hellenic Data Protection Authority (HDPA) fines you €5,000–€20 million.

**Why it happens:**
Developers focus on features and assume compliance is a "legal team problem." GDPR applies immediately to any EU-resident personal data processing, including Greek phone numbers. The law requires compliance from day one, not after launch. Small businesses often lack legal resources, so they assume "it's okay" until enforcement.

**How to avoid:**
- **Document lawful basis:** Your PoC needs a lawful basis for processing client data. Options:
  - **Consent:** Add a WhatsApp message during onboarding: "I consent to store my phone number for booking management." Only proceed after explicit consent.
  - **Contract:** If clients are entering into a booking contract, processing the phone number to fulfill that contract is lawful.
  - **Legitimate interest:** You could argue that storing phone numbers is necessary for your business (sending reminders), but this is weaker and requires a balancing test.
- **Data minimization:** Only store fields you actually need. Do NOT store browser history, IP addresses, or other tracking data.
- **Retention policy:** Define how long you keep booking data (e.g., 1 year after the appointment, then delete). Implement this in code (e.g., automated deletion job).
- **User rights implementation:** Implement endpoints/flows for data access (Article 15) and deletion (Article 17). Users should be able to request their data and get a JSON export within 30 days.
- **Breach notification:** Set up a procedure for notifying the HDPA (within 72 hours) and affected users if data is compromised.
- **No DPO required (probably):** You likely don't need a Data Protection Officer unless you're processing large-scale special categories of data or systematic monitoring. But read the GDPR to confirm.
- **Privacy policy:** Publish a privacy policy on your website (or in WhatsApp) explaining what data you collect, why, how long you keep it, and what rights users have.

**Warning signs:**
- No documentation of lawful basis or consent flow.
- Data retention is indefinite ("we keep everything").
- A user requests data deletion and you have no process to handle it.
- No privacy policy published anywhere.

**Phase to address:**
Phase 1 (Architecture & Setup): Define GDPR compliance framework before building the system. Add consent flow to Phase 2 (Message Flow). Implement data deletion jobs in Phase 3 (Admin & Maintenance). This is not deferrable; it's a legal requirement.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip Meta verification until "almost launch" | Faster prototyping | 1–6 week delay at critical moment, kills launch timeline | Never — start verification immediately |
| Implement custom cron jobs instead of fly.io Cron Manager | Avoid dependency on fly.io tool | Duplicate job runs, missed runs, timezone bugs, on-call incidents | Never — use Cron Manager |
| Omit idempotency keys in booking functions | Simpler code | Double-booking, data corruption under load | Never — idempotency is core |
| Store all data indefinitely (no retention policy) | No deletion logic needed | GDPR violation, audit/compliance nightmare, storage bloat | Never for production; at most for PoC with disclosure |
| Use Gemini free tier without rate-limit fallback | No cost | Silent failures under realistic load, user experience collapse | Only for proof-of-concept with <5 daily active users; upgrade before scaling |
| Assume LLM handles all date parsing (no pre-processing) | Fewer code paths | Frequent booking-time errors, poor UX | Never — implement Greek-specific preprocessing |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **WhatsApp Cloud API** | Assume message delivery is guaranteed; don't track sent/delivered status | Implement webhook for delivery confirmations; log and retry failed messages |
| **WhatsApp Cloud API** | Send reminders outside 24-hour window without approved templates | Pre-create and test all template approval flows; implement template fallback |
| **Gemini API** | Retry rate-limit errors immediately without backoff | Implement exponential backoff with jitter; track quota usage in real-time |
| **Gemini API** | Pass user input directly to LLM without pre-processing Greek dates | Pre-process relative temporal expressions; confirm dates with user |
| **Google Calendar** | Omit `timeZone` parameter in API calls | Always include `timeZone: "Europe/Athens"` in event operations |
| **Google Calendar** | Lose track of event IDs and reconstruct them later | Store event IDs in database keyed to booking ID; never reconstruct |
| **Neon PostgreSQL** | Trust LLM to construct SQL or sanitize queries | Use parameterized queries always; never interpolate user input |
| **fly.io** | Schedule cron jobs with node-cron or setInterval | Use fly.io Cron Manager; implement idempotency if rolling your own |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| LLM function-call loops without concurrency control | Sequential messaging works; parallel requests corrupt data | Implement database transactions and row-level locks | >5 concurrent booking requests |
| Polling Google Calendar every message instead of webhooks | Increased API quota usage; slow message responses | Use Google Calendar push notifications (webhooks) for real-time sync | >10 bookings per day |
| Storing large context windows in memory per request | Memory usage grows with number of concurrent clients | Implement request-scoped context (AsyncLocalStorage); do not retain state between requests | >20 concurrent messages |
| No caching of business profile/availability data | Every booking query re-fetches from database | Cache business config in-memory or Redis with 5-min TTL; invalidate on updates | >50 bookings per hour |
| Checking Gemini rate limits only on error | Silent failures when approaching quota | Proactively check quota headers; switch to fallback mode at 80% usage | >100 messages per day to LLM |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing phone numbers and booking data without encryption at rest | Data breach exposes PII; GDPR violation; loss of customer trust | Encrypt sensitive fields at rest (e.g., AES-256 in Neon); use HTTPS for all transport |
| No input validation on business configuration (hours, prices, etc.) | LLM can be tricked into booking invalid times; injection attacks | Validate all user-provided config data against strict schemas; reject malformed input |
| Tenant context not enforced in database queries | Cross-tenant data leaks; one business sees another's bookings | Make tenant filtering automatic at ORM/database layer; audit all queries for `WHERE tenant_id` |
| Storing Gemini/Google API keys in environment variables without rotation | Leaked keys allow attacker to impersonate your service | Use fly.io secrets for API keys; rotate quarterly; monitor for unusual API usage |
| No rate limiting on WhatsApp message sends | Attacker floods a business number, causing spam; account flagged by Meta | Implement per-business rate limiting (e.g., max 100 messages/hour); add WhatsApp abuse reporting |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Ambiguous business disambiguation (user doesn't know the business code) | Client gets lost; can't book anything; tries other platforms | Provide clear deep links with embedded business code; include business name in greeting message |
| Booking time displayed in UTC instead of Europe/Athens | Clients book wrong time; miss appointments; frustration | Always display times in user's timezone (Europe/Athens); confirm time with user before booking |
| No confirmation after booking | User unsure if booking succeeded; may re-book; double-booking | Send WhatsApp confirmation message immediately with booking details (date, time, business) |
| LLM asking the same clarifying question repeatedly | Frustrating conversation; users abandon; poor perceived AI quality | Store conversation context; implement memory of what's already been established; don't re-ask |
| Reminder message arrives at wrong time | Users miss appointments; no-show rate increases | Use fly.io Cron Manager with Europe/Athens timezone; test reminder delivery times |

---

## "Looks Done But Isn't" Checklist

- [ ] **Meta Verification:** Verify all four touchpoints match exactly (Meta Business Info, legal registration, website, address proof). Do NOT proceed to production without approved verification.
- [ ] **WhatsApp Message Templates:** Confirm all templates (confirmation, reminder, cancellation, daily agenda) are approved, not just submitted. Test template variables with real booking data.
- [ ] **Booking Concurrency:** Test with 10+ simultaneous booking requests to the same time slot. Verify only one books successfully; others fail gracefully. Automate this test.
- [ ] **Gemini Rate Limiting:** Simulate 20 concurrent messages and verify system degrades gracefully (does not silently fail or hang). Measure time to rate-limit error.
- [ ] **Date Parsing:** Test 20+ Greek temporal expressions (αύριο, Παρασκευή, "στις 3 μ.μ.", "αύριο το πρωί") and verify correctness. Do NOT ship without testing real Greek input.
- [ ] **Multi-Tenant Isolation:** Manually query the database and verify business A cannot see business B's bookings. Test with two businesses sharing the platform.
- [ ] **Google Calendar Sync:** Create a test booking, verify it appears in Google Calendar at the correct time (Europe/Athens), update the booking, verify calendar event updates (no duplicate). Test during DST transition.
- [ ] **Cron Job Reliability:** Run the reminder job 7 days in a row; verify each day it runs exactly once (no skips, no duplicates). Verify reminders arrive at the correct Europe/Athens time.
- [ ] **GDPR Consent:** Verify new users see a consent message before their data is stored. Test data export (Article 15) and deletion (Article 17) flows; verify they complete within 30 days.
- [ ] **Error Logging:** Verify all integration failures (WhatsApp send failure, Gemini 429, Google Calendar 403) are logged with full context (tenant ID, booking ID, error message). Do NOT rely on user reports to find errors.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Meta verification rejected | MEDIUM (1–2 weeks) | 1. Audit name mismatches, 2. Resubmit with corrected documents, 3. Be prepared to change business registration if legal structure is root cause |
| Double-booking already occurred | HIGH (data integrity cleanup) | 1. Manually identify conflicting bookings in database, 2. Cancel one and notify affected client via WhatsApp, 3. Refund if applicable, 4. Implement concurrency control for future bookings |
| Gemini quota exhausted mid-day | MEDIUM (1–2 hours) | 1. Implement fallback response ("We're handling lots of bookings; please try again in 1 hour"), 2. Upgrade to Gemini paid tier, 3. Monitor quota usage daily going forward |
| Google Calendar sync broken (events missing) | MEDIUM (1–2 days) | 1. Query database for bookings without calendar event IDs, 2. Manually sync missing events, 3. Verify event ID mapping is correct, 4. Test sync end-to-end |
| Cron job sent duplicate reminders | MEDIUM (1–2 days) | 1. Query database for duplicate reminder records, 2. Do NOT re-send duplicates, 3. Implement idempotency checks, 4. Switch to fly.io Cron Manager if rolling your own |
| GDPR deletion request received, no deletion tool exists | HIGH (1–2 weeks) | 1. Manually delete user data from database, 2. Verify deletion in backups, 3. Implement automated deletion flow, 4. Document procedure for future requests |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification Method |
|---------|------------------|------------|
| Meta verification delays | Phase 1 (Setup) | Approval email from Meta received; business account marked "verified" in Meta Business Manager |
| WhatsApp 24-hour window breaks reminders | Phase 2 (Message Flow) | All templates approved; test reminder delivery to 3 test numbers at known times |
| LLM double-booking | Phase 2 (Booking Flow) | Automate test: 10 concurrent requests to same slot; verify 1 books, others fail gracefully |
| Gemini free-tier rate limits | Phase 2 (AI Agent) | Load test with 20 concurrent messages; verify no silent failures; quota headers monitored |
| Greek date parsing fails | Phase 2 (AI Agent) | Test 20+ Greek temporal expressions; verify correct date/time in bookings |
| Multi-tenant context loss | Phase 1 (Architecture) | Manual audit: query database for cross-tenant data access; unit tests enforce tenant filtering |
| Google Calendar sync breaks | Phase 3 (Calendar Sync) | Create booking, verify calendar event at correct Europe/Athens time; update booking, verify no duplicates |
| Cron jobs miss runs or duplicate | Phase 3 (Reminders) | Run cron job 7 consecutive days; verify 1 run per day, no skips or duplicates |
| GDPR non-compliance | Phase 1 (Setup) | Document lawful basis; implement consent flow; verify data deletion in Phase 3 (Admin) |

---

## Sources

### Meta Business Verification & WhatsApp Cloud API
- [Meta Business Verification for WhatsApp API | 2026 Fix Guide](https://zaple.ai/blog/meta-business-verification-whatsapp/)
- [WhatsApp Business API Compliance 2026 - Simple Guide](https://gmcsco.com/your-simple-guide-to-whatsapp-api-compliance-2026/)
- [WhatsApp Cloud API Get Started - Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)

### WhatsApp 24-Hour Window & Message Templates
- [WhatsApp API Message Templates: Complete Guide [2026]](https://gurusup.com/blog/whatsapp-api-message-templates)
- [WhatsApp Business API: What is a Customer Care Window?](https://www.saysimple.com/blog/whatsapp-business-api-what-is-a-customer-care-window)
- [Template messages - Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/template-messages/)

### LLM Function Calling & Race Conditions
- [LLM Function Calling Explained — The $47k Mistake We Made | TheCodeForge](https://thecodeforge.io/ml-ai/llm-function-calling-explained/)
- [Handling Race Conditions in Multi-Agent Orchestration - MachineLearningMastery](https://machinelearningmastery.com/handling-race-conditions-in-multi-agent-orchestration/)
- [Race Conditions in Hotel Booking Systems](https://amitavroy.com/articles/race-conditions-in-hotel-booking-systems-why-your-technology-choice-matters-more-than-you-think)

### Gemini API Rate Limits
- [Gemini API Free Tier Limits 2026](https://yingtu.ai/en/blog/gemini-api-free-tier)
- [Rate limits | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/rate-limits)

### Greek Language & Timezone Handling
- [Local time in Greece](https://nationsgeo.com/time/europe/gr/)
- [Reading Dates and Days of the Week in Greek - GreekPod101](https://www.greekpod101.com/blog/2019/12/20/dates-in-greek/)
- [GR-NLP-TOOLKIT: Greek NLP for Python](https://github.com/nlpaueb/gr-nlp-toolkit)

### Multi-Tenant SaaS Isolation
- [Architecting SaaS Multi-Tenancy for Isolation and Scale - Educative](https://www.educative.io/newsletter/system-design/architecting-saas-multi-tenancy-for-isolation-and-scale)
- [Data isolation in multi-tenant SaaS - Redis](https://redis.io/blog/data-isolation-multi-tenant-saas/)
- [Tenant isolation in multi-tenant application - Logto blog](https://blog.logto.io/tenant-isolation)

### GDPR & Greek Data Protection
- [Data Protection Laws in Greece - DLP Piper](https://www.dlapiperdataprotection.com/?t=law&c=GR)
- [Data Protection & GDPR Compliance in Greece - Kanellos Legal](https://kanelloslegal.com/gdpr-compliance-greece/)

### Google Calendar API
- [Google Calendar API Timezone issue - GitHub](https://github.com/googleapis/google-api-php-client/issues/2468)
- [How to Avoid Cross-Country Time Zone Confusion in Google Calendar Events](https://lifetips.alibaba.com/tech-efficiency/google-calendars-event-time-zones-avoid-cross-country-t)
- [Calendars & events | Google Calendar | Google for Developers](https://developers.google.com/workspace/calendar/api/concepts/events-calendars)

### fly.io Cron & Scheduled Jobs
- [Task scheduling guide with Cron Manager - Fly Docs](https://fly.io/docs/blueprints/task-scheduling/)
- [Fly.io Cron Jobs Made Simple - Schedo.dev](https://www.schedo.dev/fly)
- [GitHub - fly-apps/cron-manager](https://github.com/fly-apps/cron-manager)

---

*Pitfalls research for: WhatsApp-native multi-tenant appointment booking platform for Greek service businesses*
*Researched: 2026-07-03*
*Overall confidence: HIGH*
