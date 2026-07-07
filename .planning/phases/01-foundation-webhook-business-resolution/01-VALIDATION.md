---
phase: 1
slug: foundation-webhook-business-resolution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (Node.js + TypeScript) — no existing lock, standard choice for this PoC |
| **Config file** | `jest.config.js` (created in Wave 0 — greenfield project, no test infra exists yet) |
| **Quick run command** | `npm test -- --testPathPattern="signature\|parser\|business-resolver"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90 seconds (no network calls; WhatsApp API mocked) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="signature|parser|business-resolver"`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green, plus one manual real WhatsApp deep-link message to a test number
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (planner-assigned) | TBD | TBD | PLAT-01 | V5/V11 | Deep-link business code extracted, normalized (lowercase/trim/de-accent), matched exactly | unit | `npm test -- --testPathPattern=business-resolver.test.ts` | ❌ Wave 0 | ⬜ pending |
| TBD (planner-assigned) | TBD | TBD | PLAT-01 | V11 | Business lookup returns correct business ID or "not found" reply, never a crash/silence | unit | `npm test -- --testPathPattern=business-queries.test.ts` | ❌ Wave 0 | ⬜ pending |
| TBD (planner-assigned) | TBD | TBD | PLAT-01 | V6/V13 | Webhook payload signature verified (X-Hub-Signature-256, timingSafeEqual); sender phone + message ID parsed | unit | `npm test -- --testPathPattern=webhook-parser.test.ts` | ❌ Wave 0 | ⬜ pending |
| TBD (planner-assigned) | TBD | TBD | PLAT-01 | V11 | Reply sent via WhatsApp API; message marked "processed" only after send succeeds (D-08) | integration | `npm test -- --testPathPattern=webhook-integration.test.ts` | ❌ Wave 0 | ⬜ pending |
| TBD (planner-assigned) | TBD | TBD | PLAT-01 | V11 | Duplicate WhatsApp message ID hits UNIQUE constraint, silent no-op (HTTP 200, log, no reply) (D-05/D-07) | unit | `npm test -- --testPathPattern=idempotency.test.ts` | ❌ Wave 0 | ⬜ pending |
| TBD (planner-assigned) | TBD | TBD | COMP-01 | V8 | First contact for (phone, business) pair triggers consent notice (D-09) | unit | `npm test -- --testPathPattern=consent.test.ts` | ❌ Wave 0 | ⬜ pending |
| TBD (planner-assigned) | TBD | TBD | COMP-01 | V8 | Second contact for same (phone, business) pair does NOT repeat consent notice | unit | `npm test -- --testPathPattern=consent.test.ts::second-contact` | ❌ Wave 0 | ⬜ pending |
| TBD (planner-assigned) | TBD | TBD | COMP-01 | V8 | Consent flag + timestamp recorded on client-business relationship row (D-12) | integration | `npm test -- --testPathPattern=consent-schema.test.ts` | ❌ Wave 0 | ⬜ pending |

*Planner assigns concrete Task ID / Plan / Wave values when PLAN.md files are written; rows above are the requirement-to-test contract those tasks must satisfy.*

---

## Wave 0 Requirements

- [ ] `jest.config.js` — TypeScript test setup, module resolution
- [ ] `tests/webhook.test.ts` — signature verification, payload parsing stubs
- [ ] `tests/business-resolver.test.ts` — business code extraction, normalization, Greek diacritics stubs
- [ ] `tests/idempotency.test.ts` — UNIQUE constraint behavior stubs
- [ ] `tests/consent.test.ts` — first-contact detection, consent flag logic stubs
- [ ] `tests/fixtures.test.ts` — seed script produces two businesses with correct slugs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real end-to-end WhatsApp deep-link round trip | PLAT-01 | Requires a live Meta test number + real message delivery; not mockable in CI | Send `wa.me/<test-number>?text=<fixture-slug>` from a phone, confirm Greek reply names the right business |
| Meta Business Verification submission | Roadmap SC5 | External Meta Business Manager workflow, not a codebase behavior | Owner confirms submission status in Meta Business Manager dashboard |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
