---
phase: 02-ai-booking-conversations-owner-alerts
plan: 2
subsystem: messaging
tags: [telegram, express, fetch, jest, supertest]

requires:
  - phase: 02-ai-booking-conversations-owner-alerts (plan 1)
    provides: telegramBotToken/telegramWebhookSecret Config, insertOrIgnoreTelegramUpdate/findTelegramUpdateById/markTelegramUpdateProcessed query functions, businesses.ownerTelegramId
provides:
  - Telegram Bot API outbound client (sendTelegramMessage, sendTelegramMessageWithKeyboard, answerCallbackQuery, editTelegramMessageReplyMarkup)
  - Telegram inbound webhook at /webhooks/telegram — secret-token auth, update_id dedup, business resolution + consent reuse, Greek reply
  - Real end-to-end Telegram round trip proven (mocked network), ready for Plan 02-04 to layer AI conversation handling on top
affects: [02-03, 02-04, 02-05]

tech-stack:
  added: []
  patterns:
    - "Telegram JSON envelope check (response.ok AND parsed body.ok) before trusting a Bot API call — Telegram can return HTTP 200 with { ok: false, description }"
    - "Channel-agnostic core reuse: Telegram webhook imports Phase 1's resolver.ts, consent/checker.ts, and even whatsapp.ts's Greek copy constants unmodified (D-03)"
    - "Telegram secret-token check is direct string equality (Telegram's own documented mechanism), not an HMAC/timingSafeEqual comparison like WhatsApp's signature"

key-files:
  created:
    - src/telegram/client.ts
    - src/webhooks/telegram.ts
    - tests/telegram-client.test.ts
    - tests/telegram-webhook.test.ts
  modified:
    - src/server.ts

key-decisions:
  - "sendTelegramMessage's chatId parameter is populated from the sender's Telegram user id (update.message.from.id), not a separately-tracked chat.id — correct for this phase's private one-on-one bot chats where chat.id and from.id are identical; would need revisiting if group-chat support is ever added"
  - "BUSINESS_NOT_FOUND_REPLY_GREEK and buildBusinessFoundReplyGreek are imported directly from src/webhooks/whatsapp.ts rather than duplicated, keeping the Greek copy single-sourced across both channel adapters"
  - "callback_query updates are deduped and accepted (200) but otherwise untouched this plan — full owner accept/reject handling is explicitly Plan 02-05's scope"

patterns-established:
  - "Pattern: channel adapter reuses core Greek copy/business-resolution/consent modules verbatim; only the webhook shape (auth header, update envelope, outbound client signature) differs per channel"

requirements-completed: [BOOK-01, ASK-01, ASK-02]

coverage:
  - id: D1
    description: "Telegram Bot API client wrapper (sendTelegramMessage, sendTelegramMessageWithKeyboard, answerCallbackQuery, editTelegramMessageReplyMarkup) checking both HTTP and Telegram-envelope-level errors"
    requirement: "ASK-01"
    verification:
      - kind: unit
        ref: "tests/telegram-client.test.ts (5 tests, mocked fetch)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Telegram webhook handler: secret-token verification, update_id dedup, business resolution via unchanged Phase 1 resolver, consent reuse via unchanged Phase 1 checker, Greek reply, callback_query pass-through"
    requirement: "BOOK-01"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts (6 tests, supertest against exported Express app, all dependencies mocked)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Real end-to-end Telegram round trip (live bot, live webhook) confirming recognized/unrecognized business codes and consent notice"
    requirement: "ASK-02"
    verification: []
    human_judgment: true
    rationale: "Requires a deployed fly.io app, a registered Telegram webhook (per this plan's user_setup), and a live Telegram message — not mockable in CI, matches Phase 1's Manual-Only Verification precedent for the WhatsApp equivalent. Deferred to end-of-phase human verification per project config (human_verify_mode: end-of-phase)."

duration: ~15min
completed: 2026-07-08
status: complete
---

# Phase 2 Plan 2: Telegram Channel Adapter Summary

**Telegram Bot API client (4 primitives) + inbound webhook at /webhooks/telegram reusing Phase 1's business resolver and consent checker unchanged, proving the full Telegram round trip before any AI/booking logic exists**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2/2 completed
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `src/telegram/client.ts`: 4 outbound Bot API primitives (`sendTelegramMessage`, `sendTelegramMessageWithKeyboard`, `answerCallbackQuery`, `editTelegramMessageReplyMarkup`), every call checking both the HTTP status and Telegram's own JSON `ok` envelope field before trusting a response
- `src/webhooks/telegram.ts`: POST-only webhook mirroring Phase 1's `whatsapp.ts` shape — secret-token verification (403 before any parsing) → `update_id` dedup → business resolution (reusing `extractAndNormalizeAllBusinessCodeCandidates` verbatim) → consent reuse (`getOrCreateClientRelationship`/`CONSENT_NOTICE_GREEK_TEMPLATE` verbatim) → Greek reply → mark-processed-after-send, always resolving 200 to Telegram
- `callback_query` updates (owner button taps) are deduped and accepted without crashing, explicitly deferred to Plan 02-05
- `src/server.ts` mounts the new router at `/webhooks/telegram` alongside the existing `/webhooks/whatsapp` mount
- Full regression suite: 57/57 tests pass (11 new + 46 prior), `npx tsc --noEmit` clean

## Task Commits

1. **Task 1: Telegram Bot API client wrapper** - `5ef751b` (test, RED) → `019784b` (feat, GREEN)
2. **Task 2: Telegram webhook handler** - `fb0fef9` (test, RED) → `b1040d9` (feat, GREEN)

_Both tasks followed the TDD RED→GREEN cycle: tests written and confirmed failing (module/route not found) before implementation._

## Files Created/Modified
- `src/telegram/client.ts` - 4 Telegram Bot API primitives via native `fetch`, no SDK, mirroring `src/whatsapp/client.ts`'s conventions
- `src/webhooks/telegram.ts` - Webhook handler: `verifyTelegramSecretToken`, `handleTelegramWebhookPost`, default-exported `express.Router()`
- `src/server.ts` - Mounts `telegramWebhookRouter` at `/webhooks/telegram`
- `tests/telegram-client.test.ts` - 5 tests, mocked `fetch`
- `tests/telegram-webhook.test.ts` - 6 tests, supertest against the exported app with `database/queries` and `telegram/client` mocked

## Decisions Made
- `sendTelegramMessage`'s `chatId` argument is populated directly from the sender's Telegram user id (`update.message.from.id`), since this phase's bot only handles private one-on-one chats where `chat.id` and the sender's `from.id` coincide — the plan's `<action>` text never separately introduced a `chat.id` field, so this keeps the implementation faithful to spec without inventing untested surface
- Reused `BUSINESS_NOT_FOUND_REPLY_GREEK` and `buildBusinessFoundReplyGreek` directly from `src/webhooks/whatsapp.ts` rather than duplicating the Greek copy, per D-03's channel-agnostic-core mandate
- `verifyTelegramSecretToken` is a plain string-equality check (no `timingSafeEqual`), per Telegram's own documented spec for this header — it is a shared-secret bearer-style comparison, not an HMAC signature

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Own test bug: `undefined` used as the "omit header" sentinel in a default-parameterized test helper**
- **Found during:** Task 2, running `tests/telegram-webhook.test.ts` for the first time after implementation (GREEN attempt)
- **Issue:** `postWebhook(body, secret: string | undefined = SECRET)` — calling it with an explicit `undefined` second argument (intended to mean "send no secret header") silently triggered JavaScript's default-parameter substitution, so the "missing header" test case actually sent the correct `SECRET` header and got 200 instead of the expected 403
- **Fix:** Changed the sentinel type/default to `string | null = SECRET` and updated the test call site to pass `null` for the missing-header case; `null` does not trigger default-parameter substitution
- **Files modified:** tests/telegram-webhook.test.ts
- **Verification:** All 6 webhook tests pass; Test 4 now genuinely exercises both the missing-header and wrong-header 403 paths
- **Committed in:** b1040d9 (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, a bug in the test harness itself, not in production code)
**Impact on plan:** No scope creep — fix was necessary for the test to actually verify what it claimed to verify.

## Issues Encountered
None beyond the test-harness bug documented above.

## User Setup Required

**External services require manual configuration — not blocking for continuing development, only for live verification.**
- Once the fly.io app is deployed with `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` set (from Plan 02-01's user_setup), register the webhook:
  `curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<fly-app>.fly.dev/webhooks/telegram&secret_token=$TELEGRAM_WEBHOOK_SECRET"`
- After registration, the plan's human-check (send a real Telegram message containing `pilates-athens`, then an unrecognized code) confirms the live round trip — deferred to end-of-phase verification per this project's `human_verify_mode: end-of-phase` config setting, matching Phase 1's precedent for the equivalent WhatsApp checkpoint.

## Next Phase Readiness
- `src/telegram/client.ts` and `src/webhooks/telegram.ts` contracts are locked exactly as specified in this plan's `<interfaces>` block — Plans 02-03 through 02-05 can import verbatim
- Plan 02-05 (owner approval) has a clear `// TODO Plan 02-05` insertion point in `handleTelegramWebhookPost` for `callback_query` handling, and `answerCallbackQuery`/`editTelegramMessageReplyMarkup` are already available for it
- Plan 02-04 (AI conversation router) will replace the current business-found/not-found-only reply in `handleFoundBusiness` with real Gemini-driven conversation handling
- **Blocker for going live (not for continuing development):** the live Telegram webhook registration and real-message verification are still pending user/deployment action (see "User Setup Required" above)

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*

## Self-Check: PASSED

All claimed files verified present: src/telegram/client.ts, src/webhooks/telegram.ts, tests/telegram-client.test.ts, tests/telegram-webhook.test.ts, src/server.ts.
All claimed commits verified present: 5ef751b, 019784b, fb0fef9, b1040d9.
