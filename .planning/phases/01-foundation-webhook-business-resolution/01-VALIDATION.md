---
phase: 1
slug: foundation-webhook-business-resolution
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-07
audited: 2026-07-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (Node.js + TypeScript) |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npm test -- --testPathPattern="webhook\|business-resolver\|idempotency\|consent\|fixtures\|config"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~9 seconds (all mocked; no network calls) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="webhook|business-resolver|idempotency|consent|fixtures|config"`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green, plus one manual real WhatsApp deep-link message to a test number
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | PLAT-01, COMP-01 | T-01-01 | Env config fails fast with zod error naming missing secret; optional vars default correctly | unit | `npm test -- --testPathPattern=config.test.ts` | ✅ | ✅ green |
| 01-01-T2 | 01 | 1 | PLAT-01 | T-01-02, T-01-03 | Schema pushed live: businesses/messages/client_business_relationships with UNIQUE + composite index | integration | `information_schema.tables` check (run manually against Neon) | N/A | ✅ green (manual) |
| 01-01-T3 | 01 | 1 | PLAT-01 | T-01-04 | generateSlug normalizes + deduplicates; seed() idempotent; findBusinessBySlug resolves fixture rows | unit | `npm test -- --testPathPattern=fixtures.test.ts` | ✅ | ✅ green |
| 01-02-T1 | 02 | 2 | PLAT-01 | — | sendWhatsAppMessage posts to Graph API; throws on non-2xx | unit | `npm test -- --testPathPattern=whatsapp-client.test.ts` | ✅ | ✅ green |
| 01-02-T2 | 02 | 2 | PLAT-01 | V5/V11 | Business code extracted from Greek message text; normalized (NFD diacritics stripped, lowercase, dash variants); unrecognized returns null | unit | `npm test -- --testPathPattern=business-resolver.test.ts` | ✅ | ✅ green |
| 01-02-T3 | 02 | 2 | PLAT-01 | V6/V13 | Signature verified via timingSafeEqual (length guard prevents RangeError); GET echoes hub.challenge; invalid/missing sig → 403; recognized slug → Greek reply; unknown code → not-found reply | unit | `npm test -- --testPathPattern=webhook.test.ts` | ✅ | ✅ green |
| 01-03-T1 | 03 | 3 | PLAT-01 | V11/D-08 | Duplicate message ID → insertOrIgnoreMessage returns 'ignored' → 200, no reply; markMessageProcessed called only after sendWhatsAppMessage succeeds | unit | `npm test -- --testPathPattern=idempotency.test.ts` | ✅ | ✅ green |
| 01-03-T2a | 03 | 3 | COMP-01 | V8/D-09 | First contact for (phone, business) pair → consent notice prepended before business-found reply; one send, not two | unit | `npm test -- --testPathPattern=consent.test.ts` | ✅ | ✅ green |
| 01-03-T2b | 03 | 3 | COMP-01 | V8 | Second contact for same (phone, business) pair → no consent notice | unit | `npm test -- --testPathPattern=consent.test.ts` | ✅ | ✅ green |
| 01-03-T2c | 03 | 3 | COMP-01 | V8/D-12 | consentGiven=true and consentTimestamp recorded on client_business_relationships row | unit | `npm test -- --testPathPattern=consent-schema.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `jest.config.js` — TypeScript test setup, module resolution
- [x] `tests/webhook.test.ts` — signature verification, payload parsing, business resolution, not-found
- [x] `tests/business-resolver.test.ts` — code extraction, NFD normalization, Greek diacritics
- [x] `tests/idempotency.test.ts` — UNIQUE constraint dedup behavior, markMessageProcessed ordering
- [x] `tests/consent.test.ts` — first-contact detection, consent notice prepend, second-contact skip
- [x] `tests/consent-schema.test.ts` — consentGiven flag + consentTimestamp recorded on relationship row
- [x] `tests/fixtures.test.ts` — seed script produces two businesses with correct slugs, idempotent re-run

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real end-to-end WhatsApp deep-link round trip | PLAT-01 | Requires a live Meta test number + real message delivery; not mockable in CI | Send `wa.me/<test-number>?text=<fixture-slug>` from a phone, confirm Greek reply names the right business |
| Meta Business Verification submission | Roadmap SC5 | External Meta Business Manager workflow, not a codebase behavior | Owner confirms submission status in Meta Business Manager dashboard |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09

---

## Validation Audit 2026-07-09

| Metric | Count |
|--------|-------|
| Requirements mapped | 10 |
| Gaps found | 0 |
| Resolved | 0 |
| Manual-only | 2 |
| Test files present | 7/7 |
| Tests passing | 56/56 |
