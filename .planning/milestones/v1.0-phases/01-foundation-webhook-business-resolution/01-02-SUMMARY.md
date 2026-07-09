---
plan: 01-02
phase: 01-foundation-webhook-business-resolution
status: complete
completed_at: "2026-07-07"
---

# Plan 01-02 Summary

## What was built

**Task 1 — WhatsApp Cloud API client** (`src/whatsapp/client.ts`)
- `sendWhatsAppMessage(recipientPhone, text)` using native Node 20 `fetch`
- POST to `https://graph.facebook.com/v20.0/{phoneNumberId}/messages`
- Throws on non-2xx; caller (webhook handler) logs and continues

**Task 2 — Business code extraction & normalization** (`src/business/resolver.ts`, `src/utils/diacritics.ts`)
- `extractBusinessCode`: regex `/\b[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+\b/` — requires at least one hyphen, so standalone Greek words are never mismatched
- `normalizeBusinessCode`: NFD-based diacritic stripping (Unicode `\p{M}`) + lowercase + dash variant normalization
- `extractAndNormalizeBusinessCode`: pre-normalizes en/em-dash in the full message before extraction, then normalizes the extracted token
- **Deviation from plan**: `remove-accents` replaced by built-in `String.prototype.normalize('NFD').replace(/\p{M}/gu, '')` — the package did not strip Greek tonos (Ά → Α), the native approach does

**Task 3 — Webhook handler, Express server, entry point** (`src/webhooks/whatsapp.ts`, `src/utils/validation.ts`, `src/server.ts`, `src/index.ts`)
- `verifyWhatsAppSignature`: HMAC-SHA256 with length guard before `timingSafeEqual` (prevents RangeError on malformed headers)
- `handleWebhookGet`: hub.verify_token comparison, echoes hub.challenge on match
- `handleWebhookPost`: signature → Zod payload validation → message type check → business lookup → Greek reply via sendWhatsAppMessage (try/catch so a failed send never blocks the 200 ack to Meta)
- Express app: webhook router at `/webhooks/whatsapp` (POST uses `express.raw({ type: 'application/json' })`), `/healthz`, generic error middleware
- fly.io deploy: `npm run build` succeeds; `fly deploy` is the outstanding manual step (requires `fly auth login` or `FLY_API_TOKEN`)

## Test results

24/24 tests pass (5 suites: config, fixtures, whatsapp-client, business-resolver, webhook)

## Must-have verification

- ✅ Recognized slug → Greek business-found reply (Test 3)
- ✅ Unrecognized code → Greek not-found reply (Test 4)
- ✅ Missing/invalid/short signature → 403, sendWhatsAppMessage never called (Tests 5a, 5b)
- ✅ Non-text message type → 200, no reply sent (Test 6)
- ✅ `npm run build` exits 0

## Outstanding manual step

Deploy to fly.io via `fly deploy` once `fly auth login` is available. Then send a real WhatsApp message with "pilates-athens" to verify the end-to-end round trip (per the plan's human-check).
