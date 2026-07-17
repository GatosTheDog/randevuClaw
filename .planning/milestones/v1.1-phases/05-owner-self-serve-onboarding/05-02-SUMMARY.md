---
phase: 05-owner-self-serve-onboarding
plan: "02"
subsystem: telegram-client, onboarding
tags: [telegram-api, drizzle-orm, platform-bot, onboarding, security]

requires:
  - phase: 05-01
    provides: onboardingSessions schema export; config.platformBotToken/platformWebhookSecret/webhookBaseUrl; admin db

provides:
  - callTelegramApiDirect (private) — explicit-token Telegram API helper bypassing botTokenStore
  - getMeBotInfo, registerBotWebhook, unregisterBotWebhook — exported from src/telegram/client.ts
  - src/onboarding/queries.ts — full session CRUD + business helpers (6 functions + 1 interface)

affects:
  - 05-03 (onboarding state machine calls findActiveSessionByOwnerTelegramId, createOrResetOnboardingSession, updateOnboardingStep)
  - 05-04 (platform.ts uses getMeBotInfo, registerBotWebhook, unregisterBotWebhook + findActiveSessionByOwnerTelegramId)

tech-stack:
  added: []
  patterns:
    - "callTelegramApiDirect: explicit-token variant of callTelegramApi; logs method only, never logs token (T-05-03)"
    - "onboarding/queries.ts uses admin db directly (not appDb/getConn) — cross-tenant platform bot context"
    - "createOrResetOnboardingSession: onConflictDoUpdate on businessId unique index — handles re-registration atomically"

key-files:
  created:
    - src/onboarding/queries.ts
  modified:
    - src/telegram/client.ts

key-decisions:
  - "callTelegramApiDirect is private (unexported) — getMeBotInfo/registerBotWebhook/unregisterBotWebhook are the public API; callers never construct URLs directly"
  - "onboarding/queries.ts imports Business interface from src/database/queries.ts — reuses existing interface rather than duplicating"
  - "activateBusiness updates only webhookId+webhookSecret — separated from createBusinessForOnboarding to support re-registration without duplicate rows"

requirements-completed:
  - BOT-01
  - ONB-02

coverage:
  - id: T1
    description: "callTelegramApiDirect appended to src/telegram/client.ts; logs { method } only, never botToken; mirrors callTelegramApi fetch/parse/throw pattern"
    requirement: BOT-01
    verification:
      - kind: other
        ref: "grep -c 'callTelegramApiDirect' src/telegram/client.ts returns 4+"
        status: pass
      - kind: other
        ref: "grep 'logger.*method' src/telegram/client.ts returns matches in callTelegramApiDirect"
        status: pass
    human_judgment: false
  - id: T2
    description: "getMeBotInfo, registerBotWebhook, unregisterBotWebhook exported from src/telegram/client.ts; TypeScript compiles"
    requirement: BOT-01
    verification:
      - kind: unit
        ref: "npm test -- --testPathPattern=telegram-client --no-coverage (5/5 pass)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit exits 0"
        status: pass
    human_judgment: false
  - id: T3
    description: "src/onboarding/queries.ts created with 7 exports (1 interface + 6 functions); all use admin db; onConflictDoUpdate in createOrResetOnboardingSession"
    requirement: ONB-02
    verification:
      - kind: other
        ref: "grep -c '^export' src/onboarding/queries.ts returns 7"
        status: pass
      - kind: other
        ref: "grep 'onConflictDoUpdate' src/onboarding/queries.ts returns 1 functional call"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit exits 0"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-14
status: complete
---

# Phase 05 Plan 02: Telegram API Helpers + Onboarding Query Layer Summary

**Four platform-bot API helpers added to src/telegram/client.ts; new src/onboarding/queries.ts with six CRUD functions and OnboardingSession interface for the onboarding state machine**

## Performance

- **Duration:** 8 min
- **Completed:** 2026-07-14
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- Appended `callTelegramApiDirect<T>(botToken, method, body)` (private) to `src/telegram/client.ts` — mirrors `callTelegramApi` but accepts an explicit `botToken` parameter instead of reading from `botTokenStore`; security requirement T-05-03 met: `logger.debug({ method }, ...)` logs only the method name, never the token
- Exported `getMeBotInfo(botToken)` — calls `getMe`, returns `{ id, username, firstName }` mapped from Telegram's `first_name` field
- Exported `registerBotWebhook(botToken, webhookUrl, secretToken)` — calls `setWebhook` with `url` + `secret_token`
- Exported `unregisterBotWebhook(botToken)` — calls `deleteWebhook`; must be called before `registerBotWebhook` on re-registration (STATE.md blocker)
- Created `src/onboarding/queries.ts` with `OnboardingSession` interface and six exported functions, all using admin `db` (bypasses RLS for cross-tenant platform bot operations):
  - `findBusinessByOwnerTelegramId` — select businesses where ownerTelegramId matches
  - `findActiveSessionByOwnerTelegramId` — inner join + filter `currentStep != 'done'`
  - `createOrResetOnboardingSession` — upsert via `onConflictDoUpdate` targeting businessId unique index
  - `updateOnboardingStep` — advance step + persist collectedData
  - `createBusinessForOnboarding` — insert placeholder businesses row at token-validation time
  - `activateBusiness` — update webhookId + webhookSecret after successful `setWebhook`

## Task Commits

1. **Task 1: Telegram API helpers in client.ts** - `cbac4b1` (feat)
2. **Task 2: Onboarding session query layer** - `72d9824` (feat)

## Files Created/Modified

- `src/telegram/client.ts` — Appended `callTelegramApiDirect` + 3 exported helpers (74 lines added)
- `src/onboarding/queries.ts` — New file: OnboardingSession interface + 6 CRUD functions (130 lines)

## Decisions Made

- `callTelegramApiDirect` is private (unexported) — the public API surface is `getMeBotInfo`, `registerBotWebhook`, `unregisterBotWebhook`; callers never need to construct Telegram URLs directly
- `OnboardingSession` interface imports `Business` from `src/database/queries.ts` — reuses the existing interface rather than duplicating the shape
- `activateBusiness` updates only `webhookId` and `webhookSecret` — separated from `createBusinessForOnboarding` so re-registration can update credentials without inserting a duplicate businesses row

## Deviations from Plan

None — plan executed exactly as written.

One minor note on the `onConflictDoUpdate` acceptance criterion: the criterion states `grep "onConflictDoUpdate" src/onboarding/queries.ts` returns 1 match. The function's JSDoc comment also uses the word for documentation purposes, so a raw `grep` returns 2 lines. The functional code has exactly 1 `onConflictDoUpdate` call (in `createOrResetOnboardingSession`). This is correct behavior, not a bug.

## Security (Threat Model Coverage)

| Threat | Status |
|--------|--------|
| T-05-03: Bot token logged in callTelegramApiDirect URL | Mitigated — `logger.debug({ method }, ...)` logs only method; botToken never in log fields |
| T-05-04: getMeBotInfo accepts arbitrary string | Accepted — Telegram 401 is thrown as Error; no pre-validation needed |
| T-05-05: createOrResetOnboardingSession resets active session | Mitigated — only callable after valid `getMeBotInfo()` in platform handler |
| T-05-SC: No new npm packages | Confirmed — all imports use project-existing drizzle-orm, pg, crypto |

## Self-Check: PASSED

- `src/telegram/client.ts` present: YES
- `src/onboarding/queries.ts` present: YES
- Task 1 commit `cbac4b1` exists: YES
- Task 2 commit `72d9824` exists: YES
- `npx tsc --noEmit` exits 0: YES
- `npm test -- --testPathPattern=telegram-client` 5/5 pass: YES
