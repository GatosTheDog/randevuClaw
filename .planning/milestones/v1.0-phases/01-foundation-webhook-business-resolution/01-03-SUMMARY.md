---
plan: 01-03
phase: 01-foundation-webhook-business-resolution
status: complete
completed_at: "2026-07-07"
---

# Plan 01-03 Summary

## What was built

**Task 1 — Idempotent message dedup** (updated `src/webhooks/whatsapp.ts`, updated `src/database/queries.ts`)
- `handleWebhookPost` refactored into two private helpers (`handleFoundBusiness`, `handleNotFoundBusiness`) to keep cognitive complexity within limits
- Business-found path: `insertOrIgnoreMessage` called first; `'ignored'` result → log + 200, no reply; `'inserted'` → continue with consent + reply
- `markMessageProcessed` called only AFTER `sendWhatsAppMessage` succeeds (D-08 — narrow duplicate-reply risk accepted over silent message loss)
- Business-not-found path: `findMessageByWhatsappId` (new helper in queries.ts) does a read-only existence check; prior row → suppress duplicate not-found reply; no row → send `BUSINESS_NOT_FOUND_REPLY_GREEK`; `insertOrIgnoreMessage` never called on this path (no FK-safe businessId)
- In-code comment documents the accepted limitation: permanently-unresolvable code may repeat the not-found reply on Meta retries

**Task 2 — First-contact consent notice** (`src/consent/checker.ts`, updated `src/webhooks/whatsapp.ts`)
- `CONSENT_NOTICE_GREEK_TEMPLATE(businessName)`: contract-necessity framing, no opt-out/STOP phrasing (D-11)
- `getOrCreateClientRelationship(businessId, senderPhone)`: wraps `findClientBusinessRelationship` + `insertClientBusinessRelationship` from Plan 01-01 queries; returns `{ isFirstContact, consentGiven }`
- First contact: reply = `${CONSENT_NOTICE_GREEK_TEMPLATE}\n\n${buildBusinessFoundReplyGreek}` — one message, not two sends
- Subsequent contacts: reply = `buildBusinessFoundReplyGreek` only

## Test results

34/34 tests pass (8 suites: config, fixtures, whatsapp-client, business-resolver, webhook, idempotency, consent, consent-schema)

## Must-have verification

- ✅ Duplicate message ID (found-business path) → exactly one reply, one row
- ✅ `sendWhatsAppMessage` throw → `markMessageProcessed` never called
- ✅ Not-found path → no `insertOrIgnoreMessage`; existence check before reply; prior row suppresses duplicate
- ✅ First contact → consent notice prepended; second contact → no consent notice
- ✅ Consent row has `consentGiven: true` and `consentTimestamp` as Date
- ✅ No "reply STOP" phrasing in consent text
- ✅ `npm run build` exits 0
