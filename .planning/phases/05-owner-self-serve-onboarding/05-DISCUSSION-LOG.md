# Phase 5: Owner Self-Serve Onboarding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-14
**Phase:** 5-Owner-Self-Serve-Onboarding
**Areas discussed:** Registration gateway, Onboarding conversation driver, Hours input UX, ONB-04: fixture removal & test approach

---

## Registration Gateway

### Q1: How does an owner first submit their bot token to the platform?

| Option | Description | Selected |
|--------|-------------|----------|
| Platform onboarding bot | Separate PLATFORM_BOT_TOKEN env var. Owner DMs token to it; platform validates via getMe(), calls setWebhook. | ✓ |
| CLI / npm script | Operator runs `npm run register-bot -- --token <TOKEN>`. No chat UX for token submission. | |
| Owner's own bot + deep-link | Circular: platform needs token before first message. | |

**User's choice:** Platform onboarding bot
**Notes:** Keeps the "chat-only" principle. Platform bot is a separate Telegram bot with its own `PLATFORM_BOT_TOKEN`.

---

### Q2: How does the platform associate the sender's Telegram ID with the new business?

| Option | Description | Selected |
|--------|-------------|----------|
| Sender's Telegram ID is the owner | `from.id` → `businesses.ownerTelegramId`. Simple, no extra step. | ✓ |
| Explicit /start confirmation flow | Owner confirms control of the new bot by replying on their own bot. | |
| You decide | Claude picks simplest. | |

**User's choice:** Sender's Telegram ID is the owner
**Notes:** PoC-appropriate simplicity.

---

### Q3: After registration, handoff immediately or full onboarding in platform bot first?

| Option | Description | Selected |
|--------|-------------|----------|
| Handoff immediately | Platform bot confirms setWebhook, tells owner to open their own bot for setup. | |
| Full onboarding in platform bot first | Name/hours/services collected before setWebhook is called. | |
| You decide | Claude decides. | ✓ |

**User's choice:** You decide → Claude chose: Full onboarding in platform bot first, then setWebhook.
**Notes:** Prevents clients hitting an unconfigured bot. Consolidates registration + config state in one flow.

---

## Onboarding Conversation Driver

### Q4: What drives the multi-step onboarding conversation?

| Option | Description | Selected |
|--------|-------------|----------|
| State machine in DB | Explicit `current_step` in DB; bot reads step on every message. | ✓ |
| Gemini-driven free text | Owner describes everything naturally; AI extracts fields. | |
| You decide | Claude picks. | |

**User's choice:** State machine in DB
**Notes:** Reliable, deterministic, makes ONB-02 resume straightforward.

---

### Q5: Where is onboarding state stored?

| Option | Description | Selected |
|--------|-------------|----------|
| New onboarding_sessions table | `(business_id, current_step, collected_data JSON)` — clean, queryable. | ✓ |
| JSON column on businesses table | `onboarding_state TEXT` on existing table — fewer tables but mixes concerns. | |
| You decide | Claude picks. | |

**User's choice:** New onboarding_sessions table
**Notes:** Follows established schema pattern.

---

### Q6: How is an edit triggered post-setup (ONB-03)?

| Option | Description | Selected |
|--------|-------------|----------|
| Specific Greek keywords | `αλλαγή ωραρίου`, `νέα υπηρεσία`, `αλλαγή τιμής X` — no Gemini call for trigger. | ✓ |
| AI-detected intent via Gemini | Gemini routes setup intent from booking conversation. | |
| You decide | Claude picks. | |

**User's choice:** Specific Greek keywords
**Notes:** Predictable, testable, avoids adding complexity to the booking AI agent.

---

## Hours Input UX

### Q7: How does the owner specify weekly hours?

| Option | Description | Selected |
|--------|-------------|----------|
| Day-by-day sequential | Bot asks about each day in order. | ✓ |
| Free-text shorthand | Single prompt, Gemini parses "Δευ-Παρ 9-18, Σαβ 10-14, Κυρ κλειστά". | |
| Smart default + override | Bot proposes typical schedule, owner confirms/adjusts. | |

**User's choice:** Day-by-day sequential
**Notes:** Unambiguous, handles every edge case, matches 7-row `business_hours` structure directly.

---

### Q8: Format for open/close times per day?

| Option | Description | Selected |
|--------|-------------|----------|
| Two separate prompts HH:MM | "Ώρα έναρξης:" then "Ώρα λήξης:" — simple, matches DB format. | ✓ |
| Single prompt range | "Ωράριο (π.χ. 09:00-18:00):" — one less message, needs range parsing. | |
| You decide | Claude picks. | |

**User's choice:** Two separate prompts HH:MM
**Notes:** Avoids range parsing edge cases.

---

### Q9: Incremental DB writes per day vs batch-save all 7 at end?

| Option | Description | Selected |
|--------|-------------|----------|
| Save incrementally per day | Each day inserted to `business_hours` immediately. Resume picks up at next day. | ✓ |
| Batch-save all 7 days at end | Collect in JSON, insert on completion. Resume loses partially entered days. | |

**User's choice:** Save incrementally per day
**Notes:** Perfect alignment with ONB-02 resume requirement.

---

## ONB-04: Fixture Removal & Test Approach

### Q10: Test strategy after fixture removal?

| Option | Description | Selected |
|--------|-------------|----------|
| DB helper creates businesses directly | `insertTestBusiness()` writes to DB, bypasses onboarding flow. Fast, isolated. | ✓ |
| Tests call onboarding flow programmatically | Full state machine triggered in test setup. Realistic but slow/brittle. | |
| You decide | Claude picks. | |

**User's choice:** DB helper creates businesses directly
**Notes:** Keeps existing 208 tests fast. Onboarding flow gets its own dedicated integration tests.

---

### Q11: Per-test-file setup vs shared jest.setup.ts seed?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-test-file setup | Each test file calls DB helper in `beforeAll`/`beforeEach`. No shared state. | ✓ |
| Shared jest.setup.ts seed | Common test business inserted once. Faster but tests share state. | |
| You decide | Claude picks. | |

**User's choice:** Per-test-file setup
**Notes:** Prevents test cross-contamination.

---

### Q12: Bot credentials for onboarding flow integration tests?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated TEST_PLATFORM_BOT_TOKEN | Real Telegram test bot token. Needed for real API calls. | |
| Mock Telegram API calls | `jest.spyOn(callTelegramApi)` for getMe()/setWebhook. No real token needed. | |
| You decide | Claude picks. | ✓ |

**User's choice:** You decide → Claude chose: Mock `callTelegramApi` via `jest.spyOn`.
**Notes:** Follows Phase 4 test pattern. No `TEST_PLATFORM_BOT_TOKEN` needed in CI.

---

## Claude's Discretion

- **Post-registration flow location:** Full onboarding in platform bot (not immediate handoff) — keeps owner's bot quiet until configured.
- **`current_step` enum values:** Exact step names and sequence (e.g., `name → hours_0..6 → services → done`) — Claude decides.
- **`onboarding_sessions` upsert vs insert+unique:** Claude decides.
- **`seed.ts` restructuring after fixture removal:** Whether it becomes a test helper module or is deleted — Claude decides.
- **Onboarding flow test bot credentials:** Mock via `jest.spyOn(callTelegramApi)`.

## Deferred Ideas

- Web dashboard for owner config → out of scope per REQUIREMENTS.md
- Multi-staff / per-instructor calendars → v2.0
- WhatsApp bot registration → v1.2+ after Meta BV
- Reviewed todos not folded: "Pivot to per-business WhatsApp numbers" and "Meta BV not submitted" — both WhatsApp/Meta, explicitly out of v1.1 scope.
