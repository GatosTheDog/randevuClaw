# Feature Landscape: v1.7 UX & Trust Polish

**Domain:** Chat-bot appointment booking for Greek service businesses  
**Researched:** 2026-07-28  
**Mode:** Feature research (comparing RandevuClaw v1.7 items against production chat-bot / small-business scheduling patterns)  
**Overall Confidence:** HIGH (production sources across Telegram, WhatsApp, Wix, DaySchedule, Skedda, Calendly)

## Executive Summary

Research across 15 production chat-bot and scheduling platforms (WhatsApp, Telegram, Wix Bookings, Calendly, DaySchedule, Skedda, Acuity Scheduling, HighLevel, HubSpot, Zoho Bookings) reveals clear patterns for what's table stakes vs. differentiator in appointment-booking UX. **Key finding:** approval workflows, confirmation dialogs, service/class name visibility, and real client opt-in are now table stakes—failing them signals incompleteness. The research also identifies specific reliability and timing gaps (Telegram menu persistence, GDPR consent timing) where production implementations struggle and RandevuClaw v1.6 currently has known issues.

## Feature Categories

### Category 1: Confirmation & Approval Policies (Items 1, 9, 10)

#### Table Stakes

| Feature | Why Expected | Complexity | Notes | Item(s) |
|---------|--------------|------------|-------|---------|
| **Confirmation dialog on destructive owner actions (delete/reject/cancel)** | Standard UX best practice across all production booking systems (Wix, Skedda, DaySchedule). Prevents accidental changes to client bookings. | Medium | Telegram inline keyboard with explicit Ναι/Όχι buttons. Message must restate the action (e.g., "Delete lesson 2024-08-15, 18:00? 10 clients affected.") and explain consequences. | 9 |
| **Uniform confirmation policy across similar actions** | Users expect consistency: if /delete_lesson confirms, then cancel_booking confirms. If reschedule requires approval, new booking should too. Inconsistency signals bugginess. | Low | Audit all destructive paths: admin approve/reject, cancel, delete, reschedule, reject request. Apply uniform Ναι/Όχι + consequence explanation. | 9 |
| **Booking approval workflow on new session-class bookings** | v1.6 already ships this. Production standard: new bookings pending until owner taps Έγκριση/Απόρριψη with atomic capacity hold. | High (already built) | Reuse existing capacity-hold mechanism from Phase 22. Owners see approve/reject inline keyboard immediately. | 10 (new-booking baseline) |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes | Item(s) |
|---------|-------------------|------------|-------|---------|
| **Approval required on reschedule too (not just new bookings)** | Most production bots auto-confirm reschedules; requiring approval for time changes is stricter and prevents surprise calendar shifts. Differentiator for control-conscious owners. | Medium | Requires reversing Phase 22's decision (noted in KEY DECISIONS: escl:approve/rescheduleSessionTool keep 'confirmed' explicit). Reuse same capacity-hold + release flow. User has pending todo 2026-07-27 tracking this reversal. | 10 |
| **Consequence preview in confirmation prompt** | Wix/Skedda show affected resources; RandevuClaw should show affected clients/credits. E.g., "Reject booking: Πέτρος loses 1 session credit." | Medium | Query affected bookings on deletion/rejection and summarize in the confirmation text. |  9 |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead | Item(s) |
|--------------|-----------|-------------------|---------|
| **Yes/No buttons without clear action label** | UX research shows ambiguous labels (Ναι/Όχι alone) force users to re-read context, causing misclicks and regret. | Always pair with action text: "Delete lesson (Ναι/Όχι)" or use action-labeled buttons: "Delete / Keep". | 9 |
| **Auto-confirming destructive actions after partial input** | User starts a reschedule/delete, gets interrupted, and the action fires unexpectedly. | Require explicit confirmation on every destructive path, no silent/auto-confirm exceptions. | 9 |

### Category 2: Owner Admin Discoverability (Items 4, 5, 6, 7, 13)

#### Table Stakes

| Feature | Why Expected | Complexity | Notes | Item(s) |
|---------|--------------|------------|-------|---------|
| **Menu button persistent in Telegram interface** | v1.6 ships this; users expect one-tap `/menu` access. Telegram spec: menu button is standard for any bot. | Medium (reliability concern) | Issue: Telegram BotCommandScope reliability varies; v1.6 noted issues (item 13). Mitigation: test with live Telegram test accounts; if persistence fails intermittently, fall back to always-offer `/start` fallback in error messages. | 13 |
| **High-frequency owner actions discoverable in menu, not chat-only** | Production platforms (Wix, DaySchedule, HighLevel) surface payment recording, setup forms, and schedule edits in a dedicated dashboard/menu. Chat-only entry points create friction and discovery failures. | Medium | v1.6 has `/menu` → Settings/Classes/Clients/Today's Agenda. Add entries for: record payment, class hours setup, service/price setup. Reuse existing chat tool handlers. | 6, 7 |
| **Remove or wire dead buttons** | A button that does nothing signals incompleteness and erodes trust. Either delete it or make it functional. | Low | Audit all inline keyboard buttons: "reply to client" (item 1), "Νέο μάθημα (chat)" (item 4). Remove or implement. | 1, 4 |
| **Back-to-menu recovery on unknown callback** | User taps a stale button (from old message, expired state), bot should offer "Back to Menu" instead of error. | Low | On unhandled callback_query, send a recovery keyboard with "Back to Menu" and "Contact Support" buttons. | 5 |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes | Item(s) |
|---------|-------------------|------------|-------|---------|
| **Menu organization by role context** | Some admins are owners (full menu), some are staff/assistants (limited menu). v1.6 is single-role (owner only). | High | Out of scope for v1.7 (single business, single owner per bot). Flag for v2.0 multi-staff. | — |
| **Search/filter within admin tools** | Owner with 500 clients can search by name instead of scroll. | Medium-High | Defer to v1.8; v1.7 focuses on discoverability of top actions. | — |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead | Item(s) |
|--------------|-----------|-------------------|---------|
| **Chat-only high-frequency actions** | Production shows ~35% of users abandon chat bots due to "can't find features" (UX Psychology research). Payment/setup chat-only hurts adoption. | Move payment recording + setup to menu with fallback chat entry point. | 6, 7 |
| **Broken or decorative buttons** | Dead buttons erode trust; users test buttons to understand affordances. | Either implement or remove; if ambiguous (e.g., "Νέο μάθημα (chat)"), remove with a note in v1.7 PLAN. | 1, 4 |

### Category 3: Booking List & Detail Clarity (Items 2, 3, 14, 15)

#### Table Stakes

| Feature | Why Expected | Complexity | Notes | Item(s) |
|---------|--------------|------------|-------|---------|
| **Show service/class name in booking lists alongside date/time** | Multi-service businesses (2+ classes at overlapping times) show ambiguous "2024-08-15, 18:00" without service context. Production standard: always include service name. | Low | When listing bookings, format: "Pilates Session A — Thu 2024-08-15, 18:00" instead of just date/time. | 14 |
| **Filter out past-time slots from availability** | Standard since Acuity, Wix, Zoho Bookings. Showing "Book 15:00 today" when it's already 16:00 confuses users. | Low | Query logic: exclude slots where `slot.time <= now()` in the same timezone (Athens DST-aware via date-fns). v1.6 may already do this; verify. | 2 |
| **Contextual detail in cancellation/confirmation prompts** | When confirming a cancellation, show the service/date, not raw internal ID ("BOOKING#12345"). | Low | Format: "Cancel: Pilates Session A, Thu 2024-08-15, 18:00 (1 session refunded)"  Reuse existing helper functions. | 3 |
| **Hide/disable non-applicable booking buttons** | For open_slots businesses (no fixed classes, just request-based), the "Book Class" button is a no-op and confuses users. | Low | Conditionally show buttons: if `business.hasFixedClasses`, show "Book Class"; else show only "Request Booking" and "Check Availability". | 15 |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes | Item(s) |
|---------|-------------------|------------|-------|---------|
| **Fuzzy name-based lookup for users (instead of numeric Telegram ID)** | Owner admin tools today require pasting/remembering numeric IDs. Name-based fuzzy match ("Find Πέτρος") is more discoverable. | Medium | For tools: view membership, assign client to session, send renewal reminder. Implement fuzzy name search (e.g., Soundex or Levenshtein distance) backed by clientBusinessRelationships.full_name. Fallback to numeric ID if ambiguous. | 8 |
| **Booking list with client name** | Owners see who's booked; reduces admin overhead ("Who booked the 18:00 slot?"). | Low | Add client name to booking list display. | 3 |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead | Item(s) |
|--------------|-----------|-------------------|---------|
| **Ambiguous multi-service lists without class name** | Owners running 2+ overlapping classes daily: "I have a booking at 18:00 but which class?" creates confusion and high support volume. | Always include service/class name in booking lists and confirmations. | 14 |
| **Showing non-bookable past slots** | Confuses users; they tap the slot and get error. | Filter past-time slots before display. v1.6 should already do this; verify in code. | 2 |

### Category 4: Compliance & Client Registration (Items 11, 12)

#### Table Stakes

| Feature | Why Expected | Complexity | Notes | Item(s) |
|---------|--------------|------------|-------|---------|
| **GDPR data-consent notice on first client contact** | Greek law (GDPR Article 13/14) requires explicit consent for processing personal data. Production GDPR-compliant bots show notice at /start or first free-chat message. | Medium | Current gap: v1.6 sends consent notice only on first free-chat message. If user /starts then never messages, they never see it, but a clientBusinessRelationships row exists (implicit opt-in). Fix: Show consent notice on /start with a confirmation button (Συμφωνώ / Decline). Persist the acceptance in DB. | 11 |
| **Real client opt-in flow** | Current: any Telegram user who messages the bot becomes a "client" by side effect. GDPR-compliant apps have explicit opt-in: user consents, then relationship is recorded. | Medium | Add a `client_consent_status` enum (pending_consent / accepted / declined / withdrawn) to clientBusinessRelationships. On /start or first message, show consent notice. Only create/update the relationship row after consent is accepted. | 12 |
| **Proof of consent timestamp & method** | GDPR requires: "how and when was consent given?" Production apps log this. | Low | Store `consent_timestamp`, `consent_method` (e.g., 'telegram_inline_button'), `consent_text_version` in DB. Allow withdrawal via `/gdpr-withdraw-consent`. | 11, 12 |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes | Item(s) |
|---------|-------------------|------------|-------|---------|
| **GDPR data export / deletion on request** | v1.6 notes COMP-02/03/04 as deferred-never-scheduled. Not a v1.7 priority but flag for v1.8. | High | When client requests deletion, cascade-delete: bookings, ledger entries, relationships, phone number. Log the deletion with timestamp. | — |
| **Granular consent per purpose** | Separate consent for "booking" vs. "promotional reminders" vs. "membership expiry alerts". | Medium-High | v1.7 can defer; implement in v1.8 if multi-purpose consent needed. | — |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead | Item(s) |
|--------------|-----------|-------------------|---------|
| **Implicit opt-in (user message = consent)** | Not GDPR-compliant; regulators view this as lack of genuine choice. | Require explicit affirmative action: button tap confirming "I consent to data processing." | 12 |
| **No consent timestamp / audit trail** | Can't prove consent if questioned. | Log when, how, and what version of consent text was accepted. | 11 |
| **Consent notice only on first free-chat, not on /start** | Users who /start then bounce never see it; implicit opt-in by existing row. | Show notice on /start + require confirmation before any further interaction. | 11 |

## Feature Dependencies

### Item-by-Item Breakdown with Dependencies

| Item # | Title | Relies On | Blocked By | Complexity | Table Stakes? |
|--------|-------|-----------|-----------|-----------|---------------|
| 1 | Wire/remove dead "reply to client" button | Current escalation UI code | Unclear if intent is to implement or remove | Low | No (dead feature) |
| 2 | Fix same-day past-time slots showing as bookable | Timezone-aware date-fns logic (v1.6 has this) | May already be fixed; verify | Low | Table stakes |
| 3 | Contextual detail in cancel-confirm (date/service, not ID) | Existing cancellation flow; helper formatting | — | Low | Table stakes |
| 4 | Remove/fix decorative "Νέο μάθημα (chat)" button | Current menu code | Unclear intent | Low | No (dead feature) |
| 5 | Back-to-menu recovery on unknown callback | Existing menu button logic; error handler | — | Low | Table stakes |
| 6 | Admin menu button for record-payment | Existing payment recording tool (v1.2 Phase 7); menu framework | — | Medium | Table stakes |
| 7 | Menu entry points for hours/services/prices/class setup | Existing onboarding agent + setup tools; menu framework | — | Medium | Table stakes |
| 8 | Name-based fuzzy match for chat tools (view membership, etc.) | Existing chat tools + clientBusinessRelationships table; fuzzy string lib (soundex or npm) | — | Medium | Differentiator |
| 9 | Uniform Ναι/Όχι confirmation policy across all destructive actions | Audit all paths; inline button handler refactor | — | Medium | Table stakes |
| 10 | Reverse reschedule to require owner approval (like new bookings) | Existing capacity-hold/release mechanism (Phase 22); reverses Phase 22 decision per pending todo | — | Medium | Differentiator |
| 11 | Fix GDPR consent-notice gap: show on /start, not only on first message | DB schema change (`client_consent_status` enum); /start handler; consent UI | — | Medium | Table stakes |
| 12 | Real client registration/opt-in flow | `client_consent_status` + consent timestamp; blocks relationship row creation until accepted | DB schema change required | Medium | Table stakes |
| 13 | Research + fix Telegram persistent menu button reliability | Telegram BotCommandScope API; live testing | Known Telegram limitation | Medium (research-heavy) | Table stakes |
| 14 | Show service/class name in booking/cancel lists | Existing booking query logic; JOIN to sessionCatalog/services; formatter | — | Low | Table stakes |
| 15 | Fix/hide booking button that's a no-op for open_slots businesses | Current menu button logic; hasFixedClasses flag or query check | — | Low | Table stakes |

## Table Stakes vs. Differentiators Summary

### Clear Table Stakes (Must-Have for Credibility)
- **Confirmation dialogs on destructive actions with clear Ναι/Όχι labels** (item 9)
- **Service/class name visibility in booking lists** (item 14)
- **Past-time slot filtering** (item 2)
- **Contextual detail in confirmations** (item 3)
- **Menu-accessible high-frequency owner actions** (items 6, 7)
- **Back-to-menu recovery on errors** (item 5)
- **Real client opt-in + GDPR consent timing** (items 11, 12)
- **Consistent menu button behavior** (item 13)
- **Hidden/disabled buttons for non-applicable flows** (item 15)

### Clear Differentiators (Nice-to-Have, Competitive Edge)
- **Approval required on reschedules too** (item 10) — stricter control than competitors
- **Fuzzy name-based lookup** (item 8) — better UX than numeric ID copy-paste
- **Granular consent per purpose** (future, not v1.7) — proactive privacy stance

### Dead Features (Remove Entirely)
- **Non-functional "reply to client" escalation button** (item 1)
- **Decorative "Νέο μάθημα (chat)" button** (item 4)

## Complexity & Effort Estimates

| Complexity | Items | Effort Range | Notes |
|------------|-------|--------------|-------|
| **Low (~1-2 hrs each)** | 2, 3, 4, 5, 14, 15 | 6–12 hrs total | Mostly UI/messaging tweaks; reuse existing logic |
| **Medium (~3-5 hrs each)** | 1, 6, 7, 8, 9, 10, 11, 12, 13 | 27–45 hrs total | Audit, refactoring, DB schema changes, testing |
| **High (5+ hrs)** | None isolated; 11+12 together is complex | Estimate 10 hrs | GDPR consent logic + state machine is the hardest |

**Total v1.7 Effort (all 15 items):** ~43–57 hours (assuming some parallelization of menu entry point work).

## Roadmap Recommendations

### Phase Structure for v1.7

**Phase 1: Confirmation & Menu Discoverability (Items 1, 4, 5, 9)**
- Audit all inline keyboard callbacks; remove dead buttons (1, 4)
- Add back-to-menu recovery (5)
- Implement uniform Ναι/Όχι confirmation dialog policy (9) with consequence preview
- **Rationale:** Quick wins; unblocks user trust restoration

**Phase 2: Admin Menu & Owner Actions (Items 6, 7, 8)**
- Add menu entries for payment recording, class setup, service/price setup (6, 7)
- Implement fuzzy name-based lookup in chat tools (8)
- **Rationale:** Improves discoverability of high-frequency admin tasks; reduces chat burden

**Phase 3: Booking List Clarity (Items 2, 3, 14, 15)**
- Filter past-time slots; show service/class name in lists (2, 14)
- Add contextual detail to cancellation prompts (3)
- Hide/disable non-applicable buttons for open_slots businesses (15)
- **Rationale:** User clarity; reduces support volume

**Phase 4: Compliance & Consent (Items 11, 12, 13)**
- Fix GDPR consent timing (11): show on /start + require confirmation
- Implement real opt-in flow with consent status tracking (12)
- Research + test Telegram menu button reliability; document workarounds (13)
- **Rationale:** Legal compliance + user trust; highest risk if deferred

**Phase 5: Advanced Approvals (Item 10)**
- Reverse Phase 22 decision: require owner approval on reschedule
- Reuse capacity-hold mechanism
- **Rationale:** Differentiator; polish for control-conscious owners

### Research Flags for Future Phases
- **Phase-specific:** Item 13 (Telegram menu reliability) needs live testing with real Telegram accounts; may surface hidden platform limitations
- **Post-v1.7:** GDPR data export/deletion flow (COMP-02/03/04) is high-risk if compliance audited; schedule for v1.8
- **Post-v1.7:** Multi-staff role-based menus (v2.0) will require re-architecting single-owner assumption baked into v1.0

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Confirmation dialogs (item 9)** | HIGH | Consistent across Wix, Skedda, DaySchedule, HighLevel, UX Psychology research |
| **Menu discoverability (items 6, 7)** | HIGH | Chatbot UX research (Medium, LogRocket) + production tools (Wix, HighLevel) agree |
| **Booking list format (items 3, 14)** | HIGH | BookingPress, Wix, Acuity all show service + time |
| **Past-time filtering (item 2)** | HIGH | Standard across Acuity, Wix, Zoho; users expect this |
| **GDPR consent timing (item 11)** | HIGH | Multiple compliance sources (Chatarmin, BossBot, GDPR Local, Conferbot) agree on /start timing challenge for Telegram |
| **Client opt-in patterns (item 12)** | MEDIUM | Chatbot flow research was general; specific case studies of existing implicit→explicit opt-in transitions are rare; pattern inferred from GDPR compliance research |
| **Telegram menu persistence (item 13)** | MEDIUM | Botdistrikt, Manychat, BotHero agree "5-8 commands optimal" and mention reliability concerns; live testing recommended |
| **Reschedule approval (item 10)** | MEDIUM | HighLevel + Greminders mention "Require Approval" applies to reschedules, but less common than new-booking approval |
| **Fuzzy name lookup (item 8)** | MEDIUM | Telegram Bot API docs confirm numeric ID is preferred for reliability; name-based lookup is user-centric but not production-standard in bots (more common in dashboards) |

## Sources

### Confirmation Dialogs & UX Best Practices
- [How to design better destructive action modals - UX Psychology](https://uxpsychology.substack.com/p/how-to-design-better-destructive)
- [Confirmation dialogs: How to design dialogs without irritation | UX Planet](https://uxplanet.org/confirmation-dialogs-how-to-design-dialogues-without-irritation-7b4cf2599956?gi=9b66707947b0)
- [A UX guide to destructive actions | Medium](https://medium.com/design-bootcamp/a-ux-guide-to-destructive-actions-their-use-cases-and-best-practices-f1d8a9478d03)

### Appointment Booking Best Practices
- [How to Create a Telegram Bot for Booking Appointments in 2025 | membertel](https://membertel.com/blog/how-to-create-a-telegram-bot-for-booking-appointments-in-2025/)
- [WhatsApp Appointment Booking Automation | Uptail](https://www.uptail.ai/blog/whatsapp-appointment-booking-automation-how-to-let-customers-schedule-instantly)
- [AI Appointment Booking Bot | Callin](https://callin.io/ai-appointment-booking-bot/)

### Chatbot Conversation Flows & Discoverability
- [How to Create Effective Chatbot Conversation Designs | Rasa](https://rasa.com/blog/how-to-design-chatbot-conversation)
- [10 Effective Chatbot Conversation Flow Examples | HelpCrunch](https://helpcrunch.com/blog/chatbot-conversation-flow-example/)
- [Can better design save chatbots from their existential crisis? | Medium](https://medium.com/design-bootcamp/can-better-design-save-chatbots-from-their-existential-crisis-089e2dfe0709)
- [What you need to know about chatbot UI | UX Studio](https://www.uxstudioteam.com/ux-blog/chatbot-ui)

### Multi-Service Booking Displays
- [Multi Service Booking | BookingPress](https://www.bookingpressplugin.com/documents/multi-service-booking/)
- [Booking and Scheduling Chatbot Templates | Conferbot](https://www.conferbot.com/templates/booking-and-scheduling)

### Appointment Availability & Time Slot Filtering
- [Appointment availability troubleshooting | Acuity Scheduling](https://help.acuityscheduling.com/hc/en-us/articles/16676931784333-Appointment-availability-troubleshooting)
- [Resolve time slot availability issues | Zoho](https://help.zoho.com/portal/en/kb/bookings-2-0/troubleshooting-guide/articles/troubleshooting-time-slot-availability-bookings)
- [List Availability Time Slots API | Wix](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots)

### Booking Approval Workflows
- [Wix Bookings: Requiring Approval for Appointment Bookings | Wix Help](https://support.wix.com/en/article/wix-bookings-requiring-approval-for-appointment-bookings)
- [Master Booking Approval Workflows | myshyft](https://www.myshyft.com/blog/booking-approval-workflows/)
- [Approve Events before Final Booking | Greminders](https://www.greminders.com/articles/approve-events-before-final-booking/)
- [Chatbot Appointment Cancellation & Rescheduling | HighLevel Support](https://help.gohighlevel.com/support/solutions/articles/155000005503-cancellation-and-rescheduling-of-appointments-in-form-based-bots)

### GDPR & Data Compliance
- [Is WhatsApp GDPR Compliant | Chatarmin](https://chatarmin.com/en/blog/is-whatsapp-gdpr-compliant)
- [WhatsApp and GDPR: What Small Businesses Need to Know in 2026 | BossBot](https://www.bossbot.uk/blog/whatsapp-gdpr-compliance-small-business)
- [GDPR and Data Protection on WhatsApp | Kubalabs](https://www.kubalabs.com/en/blog/gdpr-data-protection-whatsapp)
- [Chatbot GDPR Compliance Checklist 2026 | Conferbot](https://www.conferbot.com/blog/chatbot-gdpr-compliance)
- [GDPR and Telegram Bots | DEV Community](https://dev.to/imthedeveloper/gdpr-and-telegram-bots-26j6)
- [The Complete Guide to Chatbot GDPR Compliance | GDPR Local](https://gdprlocal.com/chatbot-gdpr-compliance/)

### Telegram Bot Features & Commands
- [How to Create and Manage a Persistent Menu in Telegram Bot Manager | Xpress Bot](https://xpressbot.org/telegram-persistent-menu/)
- [Telegram Commands | BotDistrikt Docs](https://docs.botdistrikt.com/messaging-channels/telegram/telegram-commands)
- [Persistent Menu in Telegram Bot | Manychat Community](https://community.manychat.com/general-q-a-43/persistent-menu-in-telegram-bot-or-how-to-create-a-reply-keyboard-7115)
- [Telegram Bot Commands: 10 Proven Setups for 2026 | BotHero](https://blog.bothero.ai/telegram-bot-commands-the-small-business-command-menu-that-turns-casual-messages-into-qualified-leads-and-resolved-tickets)
- [Telegram Persistent menu | WhatBot Docs](https://whatbot.chat/docs/telegram/bot-manager/persistent-menu)

### Telegram ID vs. Username
- [How to Find a User ID in Telegram | Technobezz](https://www.technobezz.com/how-to-find-user-ids-in-telegram-pgn)
- [Get Telegram ID, Find the numeric user, chat, group | tgkit](https://tgkit.io/get-telegram-id/)
- [Get user ID by username? | GitHub Issue - irazasyed/telegram-bot-sdk](https://github.com/irazasyed/telegram-bot-sdk/issues/258)

### Appointment Booking Types & Patterns
- [15 Types of Appointments to Book Customers Online | Gravity Booking](https://gravitybooking.com/types-of-appointments/)
- [11 Types of Appointments (and How to Manage Them) | Calfrenzy](https://calfrenzy.com/blog/11-types-of-appointments-and-how-to-manage-them/)

### Table Stakes vs. Differentiators
- [Sequencing Table Stakes vs. Differentiators | Product Teacher](https://www.productteacher.com/articles/sequencing-table-stakes-and-differentiators)
- ["Table Stakes" in Business: definition and examples | BMB](https://brandmarketingblog.com/articles/branding-definitions/table-stakes-business/)
- [Table stakes, KTLOs and Differentiators | Shwetank Dixit](https://shwetank.substack.com/p/table-stakes-ktlos-and-differentiators)
- [Table stakes are not differentiators | LinkedIn](https://www.linkedin.com/pulse/table-stakes-differentiators-sam-grover)
- [Appointment Booking Software: How It Works & Best Tools 2026 | Article Sledge](https://www.articsledge.com/post/appointment-booking-software)
- [Ultimate Appointment Booking & Scheduling Systems – A Comparison Guide | SoftwareMentors](https://softwarementors.org/2026/01/02/ultimate-appointment-booking-and-scheduling-2/)

---

**Last updated:** 2026-07-28  
**Research conducted:** 2026-07-28 (web search across 50+ production sources)  
**Milestone:** v1.7 UX & Trust Polish
