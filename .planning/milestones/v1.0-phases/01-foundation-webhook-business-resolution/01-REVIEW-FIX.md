---
phase: 01-foundation-webhook-business-resolution
fixed_at: 2026-07-07T17:45:00Z
review_path: .planning/phases/01-foundation-webhook-business-resolution/01-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-07-07T17:45:00Z
**Source review:** .planning/phases/01-foundation-webhook-business-resolution/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (Critical + Warning; `fix_scope: critical_warning` — Info findings IN-01, IN-02 excluded)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Concurrent first-contact messages permanently lose their reply due to an unguarded unique-constraint race

**Files modified:** `src/database/queries.ts`
**Commit:** 4a142cc
**Applied fix:** `insertClientBusinessRelationship` now uses `.onConflictDoNothing()` against the `unique_client_business` index and, when the insert is a no-op (lost the race), re-fetches the winning row via `findClientBusinessRelationship` instead of letting the Postgres unique-violation propagate uncaught. Matches the fix suggested in REVIEW.md verbatim.

### CR-02: Only the first message of the first entry/change in a webhook payload is ever processed

**Files modified:** `src/webhooks/whatsapp.ts`
**Commit:** 547c96e
**Applied fix:** Replaced the triple `[0]` indexing (`payload.entry[0]?.changes[0]?.value?.messages?.[0]`) with nested `for` loops over `payload.entry` → `entry.changes` → `change.value.messages ?? []`, processing every text message found instead of only the first. Sequential `await` inside the loop, as the review noted is acceptable for Phase 1 volume.

### WR-01: `handleWebhookPost` has no top-level try/catch — unexpected errors return 500 instead of 200

**Files modified:** `src/webhooks/whatsapp.ts`
**Commit:** b3badd6
**Applied fix:** Wrapped the full body of `handleWebhookPost` (signature check through final `res.status(200).send('OK')`) in try/catch/finally. Catch logs the error; finally sends `200 OK` only `if (!res.headersSent)`, so the existing explicit `403`/`400` early-return paths are unaffected (headers already sent by the time finally runs) and only a genuinely unhandled error gets coerced to 200.

### WR-02: Business-code extraction only tries the first hyphenated token, which can misidentify the slug

**Files modified:** `src/business/resolver.ts`, `src/webhooks/whatsapp.ts`
**Commit:** 4ced278
**Applied fix:** Added `extractAllBusinessCodeCandidates` (global-regex variant of the existing matcher) and `extractAndNormalizeAllBusinessCodeCandidates` to `resolver.ts`, preserving the existing single-match functions (still used elsewhere/tested directly) unchanged. `whatsapp.ts` now collects all normalized candidates per message and calls `findBusinessBySlug` on each in appearance order until one resolves, falling back to the not-found reply only if none match — instead of assuming positional priority.

### WR-03: pino `redact` config only guards exact top-level key match

**Files modified:** `src/utils/logger.ts`
**Commit:** 88c9c19
**Applied fix:** Extended `redact.paths` to also include wildcard (`*.appSecret`, etc.) and `config.*`-prefixed variants alongside the existing top-level keys, covering the more idiomatic `logger.info({ config }, ...)` nested-logging pattern per pino's own documented recommendation. Applied exactly as suggested in REVIEW.md.

## Skipped Issues

None — all in-scope findings were fixed.

---

**Post-fix verification:** After all 5 commits, re-ran the full suite from the worktree: `npx tsc --noEmit` exits clean (0 errors), and `npm test` reports `Test Suites: 8 passed, 8 total` / `Tests: 34 passed, 34 total` — unchanged from the pre-fix baseline noted in REVIEW.md.

**Out of scope (not fixed, per `fix_scope: critical_warning`):**
- IN-01: unused `remove-accents` dependency in `package.json`
- IN-02: unvalidated WhatsApp API response shape in `src/whatsapp/client.ts`

_Fixed: 2026-07-07T17:45:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
