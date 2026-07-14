# Phase 5: Owner Self-Serve Onboarding - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning

<domain>
## Phase Boundary

A business owner registers their Telegram bot with the platform and configures their entire business profile (name, weekly hours, services with prices and durations) through a guided chat conversation with the platform onboarding bot. The onboarding state is persisted so owners can resume mid-flow. After full setup, the platform calls `setWebhook` and the owner's bot goes live. Owners can edit their config post-setup via their own bot using specific Greek keywords. All hardcoded fixture businesses are removed — every business in the system results from owner onboarding.

**Requirements in scope:** BOT-01, ONB-01, ONB-02, ONB-03, ONB-04
**Out of scope:** GDPR deletion (Phase 6), Gemini rate-limit resilience (Phase 6), any WhatsApp work (v1.2+)

</domain>

<decisions>
## Implementation Decisions

### D1: Registration Gateway

- **D-01:** A **platform onboarding bot** (separate `PLATFORM_BOT_TOKEN` env var, separate `PLATFORM_WEBHOOK_SECRET`) handles all owner registration. This is a new bot distinct from any per-business bot. Owner DMs their Telegram bot token to this platform bot to begin onboarding.
- **D-02:** The **sender's Telegram user ID** (`from.id`) becomes `businesses.ownerTelegramId`. Whoever sends the bot token to the platform bot is the owner — no extra confirmation step needed.
- **D-03:** The platform bot runs the **full onboarding flow** (name → hours → services) before calling `setWebhook`. The owner's bot is not activated until all required config is complete. This prevents clients from hitting an unconfigured bot.

### D2: Onboarding Conversation Driver

- **D-04:** A **DB-backed state machine** drives the guided setup. `onboarding_sessions` table stores `(business_id, current_step, collected_data JSON)`. The platform bot reads `current_step` on every message and asks the matching question.
- **D-05:** A new **`onboarding_sessions` table** persists onboarding state. Columns: `id`, `business_id` (FK to `businesses`), `current_step` (text enum), `collected_data` (text, JSON), `created_at`, `updated_at`. This is the canonical resume anchor for ONB-02.
- **D-06:** Post-setup config edits (ONB-03) are triggered by **specific Greek keywords** in the owner's own bot (e.g., `αλλαγή ωραρίου`, `νέα υπηρεσία`, `αλλαγή τιμής`). No Gemini call needed for the trigger — keyword detection is a simple string match before routing to the booking agent.

### D3: Hours Input UX

- **D-07:** Hours are collected **day-by-day sequentially**, in JS `Date.getDay()` order (0=Sunday … 6=Saturday, matching `business_hours.day_of_week` convention). Bot asks: "Είστε ανοιχτά τη Δευτέρα;" — if yes, follows up for times; if no, marks `isClosed: true`.
- **D-08:** Open/close times collected via **two separate prompts** ("Ώρα έναρξης (π.χ. 09:00):" then "Ώρα λήξης (π.χ. 18:00):"). Time is stored as `"HH:MM"` 24h text, matching `business_hours.openTime`/`closeTime`.
- **D-09:** Each confirmed day is **written to `business_hours` immediately** (incremental DB writes). `onboarding_sessions.current_step` advances to the next day. If the owner drops off after day 3, resume picks up at day 4 using the `current_step` tracker.

### D4: Fixture Removal & Test Approach (ONB-04)

- **D-10:** All hardcoded `FIXTURES`, `SERVICE_FIXTURES`, and `HOURS_FIXTURES` constants are **removed from `src/database/seed.ts`**. `seed.ts` itself may be repurposed or removed — no fixture-seeded businesses exist after Phase 5.
- **D-11:** Tests that previously depended on `pilates-athens`/`hair-salon-athens` are updated to use a **`insertTestBusiness()` DB helper** that writes directly to `businesses`, `services`, and `business_hours` tables, bypassing the onboarding chat flow. Keeps existing tests fast and isolated.
- **D-12:** Each test file creates its own test business in `beforeAll`/`beforeEach` (**per-test-file setup**, not shared `jest.setup.ts` seed). Prevents hidden shared state.
- **D-13:** Onboarding flow integration tests **mock `callTelegramApi`** (for `getMe()` and `setWebhook`) via `jest.spyOn`, following the Phase 4 test pattern. No real `TEST_PLATFORM_BOT_TOKEN` needed for CI.

### Claude's Discretion

- Exact shape of `onboarding_sessions.current_step` enum values and the full step sequence (e.g., `'name' → 'hours_0' → 'hours_1' → ... → 'hours_6' → 'services' → 'done'` or a coarser structure).
- Whether to use `upsert` or `insert + unique` for `onboarding_sessions` (one active session per business).
- How `seed.ts` is restructured after fixture removal — could become a test-only helper module or be deleted entirely.
- Greek day names used in prompts (Κυριακή/Δευτέρα/Τρίτη/Τετάρτη/Πέμπτη/Παρασκευή/Σάββατο) — bot should prompt in correct Greek order for a Greek business owner.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/ROADMAP.md` §"Phase 5: Owner Self-Serve Onboarding" — Goal, 5 success criteria, requirements BOT-01/ONB-01/ONB-02/ONB-03/ONB-04
- `.planning/REQUIREMENTS.md` — BOT-01, ONB-01, ONB-02, ONB-03, ONB-04 requirement specs

### Prior Phase Context (infrastructure this phase builds on)
- `.planning/phases/04-per-bot-foundation/04-CONTEXT.md` — D-01 through D-12: Telegraf per-bot registry, UUID-keyed routing, HMAC verification, RLS, schema 0003 additions (`bot_token`, `webhook_id`, `webhook_secret`)

### Existing Implementation (read before touching)
- `src/telegram/registry.ts` — `getOrCreateBotInstance(webhookId, botToken)`: must be called for the platform bot AND each owner bot at startup
- `src/telegram/client.ts` — `callTelegramApi`, `sendTelegramMessage`: the platform bot uses these for outbound messages; `getMe()` and `setWebhook` are new Telegram API calls to add here
- `src/database/schema.ts` — `businesses`, `services`, `businessHours` tables; migration 0004 adds `onboarding_sessions`
- `src/database/seed.ts` — FIXTURES removed in this phase (D-10); handle carefully — existing tests depend on slug-based fixture data
- `src/webhooks/telegram.ts` — per-bot webhook handler; platform bot gets its own webhook route (separate from `/webhooks/telegram/:webhookId`)
- `src/conversation/router.ts` — `routeConversationMessage`: owner's bot must NOT route onboarding/edit commands through the booking AI agent — keyword detection must happen BEFORE calling this

### Schema Conventions
- `src/database/schema.ts` — nullable column pattern with comments (follow `ownerTelegramId`, `googleRefreshToken` comment style for any new nullable columns)
- `dayOfWeek` convention: `0=Sunday … 6=Saturday` (JS `Date.getDay()`) — CRITICAL: do not use `1=Monday` convention

### State & Blockers
- `.planning/STATE.md` §"Blockers/Concerns" — "deleteWebhook must be called before setWebhook on any re-registration to prevent 'another webhook is active' conflicts"

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/telegram/client.ts` — `callTelegramApi`: extend with `getMe(botToken)` and `setWebhook(botToken, webhookUrl, secretToken)` helpers for registration flow
- `src/telegram/registry.ts` — `getOrCreateBotInstance`: reuse for the platform onboarding bot (its own webhookId/botToken pair)
- `src/database/seed.ts` — `generateSlug(name, existingSlugs)`: reuse to generate `businesses.slug` from owner-provided name during onboarding
- `src/database/queries.ts` — `withBusinessContext` / `botTokenStore`: all onboarding DB writes for a business use the existing RLS wrapper

### Established Patterns
- Nullable column additions with schema comment (why nullable): follow `ownerTelegramId`/`googleRefreshToken` pattern for `onboarding_sessions` FK reference on `businesses`
- Migration applied to both Neon live DB and local `randevuclaw_test` DB simultaneously (Phase 3 pattern)
- `insertOrIgnoreTelegramUpdate` dedup pattern: the platform bot's incoming messages should use the same `telegram_updates` dedup-insert flow
- Test teardown: `clearBotRegistry()` in `afterEach` to reset Telegraf registry between tests

### Integration Points
- `src/server.ts` — add platform bot webhook route: `app.post('/webhooks/telegram/platform', platformBotWebhookHandler)` alongside the existing `app.use('/webhooks/telegram', telegramWebhookRouter)` (or equivalent)
- `src/index.ts` / startup — load platform bot `PLATFORM_BOT_TOKEN` from config, call `getOrCreateBotInstance` for it at server start
- `src/config.ts` — add `PLATFORM_BOT_TOKEN` and `PLATFORM_WEBHOOK_SECRET` env vars (following D-08 pattern from Phase 04)

</code_context>

<specifics>
## Specific Ideas

- Owner interaction with the platform bot is entirely in Greek — all prompts, confirmations, and error messages in Greek.
- The `setWebhook` URL for each owner's bot: `https://{fly-app-domain}/webhooks/telegram/{webhookId}` — the platform generates the `webhookId` UUID at registration time, same as Phase 4's seeded fixture approach.
- `deleteWebhook` must be called before `setWebhook` on re-registration (STATE.md blocker) — wrap in a helper: `await deleteWebhook(botToken); await setWebhook(botToken, url, secret)`.
- For the service collection step: bot should prompt for each service one-by-one with name → price (in euro cents) → duration (minutes), then ask "Άλλη υπηρεσία;" to add more. Minimum 1 service required before onboarding can complete.

</specifics>

<deferred>
## Deferred Ideas

- Web dashboard for owner config management → explicitly out of scope per REQUIREMENTS.md
- Multi-staff / per-instructor calendars → v2.0 per PROJECT.md
- Owner-initiated WhatsApp bot registration → v1.2+ after Meta BV

### Reviewed Todos (not folded)

- **"Pivot to per-business WhatsApp numbers post-PoC"** — WhatsApp explicitly out of v1.1 scope (REQUIREMENTS.md Out of Scope). Deferred to v1.2+.
- **"Meta Business Verification not yet submitted"** — WhatsApp/Meta work deferred to v1.2+. No action in Phase 5.

</deferred>

---

*Phase: 5-Owner-Self-Serve-Onboarding*
*Context gathered: 2026-07-14*
