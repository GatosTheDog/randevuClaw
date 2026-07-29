---
phase: 30-client-identification-menu-reliability
fixed_at: 2026-07-29T00:15:00Z
review_path: .planning/phases/30-client-identification-menu-reliability/30-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 30: Code Review Fix Report

**Fixed at:** 2026-07-29T00:15:00Z
**Source review:** .planning/phases/30-client-identification-menu-reliability/30-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (all Warning; 0 Critical this iteration; IN-01 explicitly excluded per instructions — additional test coverage, non-blocking, optional)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: Identical-name collision is a permanent disambiguation dead end with no escape hatch

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** a079d18
**Applied fix:** `formatClientDisambiguation` now detects when two or more matches share a byte-identical `clientName` (`new Set(names).size < names.length`). When duplicates are present, it returns a distinct message pointing the owner at the existing `/menu` → Πελάτες client-list escape hatch ("Δεν μπορώ να τους ξεχωρίσω — χρησιμοποιήστε τη λίστα πελατών στο μενού (/menu → Πελάτες).") instead of asking for a "more specific name" that cannot exist for identically-named clients. The non-duplicate ambiguous case keeps the original "give a more specific name" wording, since that request is still satisfiable when names actually differ.

### WR-02: Dead `?? clientPhone` fallback is a latent D-05 leak trap

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** fcfec70
**Applied fix:** Replaced `resolved.match.clientName ?? clientPhone` with `resolved.match.clientName ?? '(χωρίς όνομα)'` at all three call sites (`assign_client_to_session`, `list_slotless_requests`/`send_renewal_reminder` handlers — original review line numbers 931/967/990, now 943/984/1012 after the WR-01 edit shifted line numbers). This removes the dormant path that would leak the raw Telegram ID (`senderPhone`) into owner-facing text if `resolveClientByName`'s matching predicate is ever relaxed to allow a null-named match through, and aligns the fallback placeholder with the one `formatClientDisambiguation` already uses, per D-05.

### WR-03: Disambiguation list has no length/count cap

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** 4bfa31c
**Applied fix:** `formatClientDisambiguation` now caps the rendered name list at 20 entries and appends a `...και N ακόμα.` suffix when there are more matches than that. The cap value (20) was chosen to match this codebase's actual established convention rather than the review's suggested illustrative value of 15 — confirmed against two existing precedents in the same phase's code: `list_sessions` in this same file (`ai-owner-agent.ts`, caps at 20, appends "... και N ακόμα μαθήματα.") and `showClientsList` in `src/telegram/handlers/admin-menu.ts` (caps the client-list menu itself at 20, `Πελάτες (${Math.min(clients.length, 20)} εμφανίζονται):`). The duplicate-name check from WR-01 still evaluates against the full (uncapped) match set so a duplicate beyond position 20 is not silently missed.

## Verification

- `npx tsc --noEmit` — clean after each of the 3 fixes (no errors).
- Scoped test run: `npx jest --testPathPattern "ai-owner-name-matching|ai-owner-confirmation-policy"` with `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test` — 2 suites, 22 tests, all passing. No existing test asserted the exact wording of `formatClientDisambiguation`'s output, so no test updates were required for the WR-01/WR-03 message-text changes.
- Full test suite was intentionally NOT run (project convention: full suite run crashes the local machine; scoped `--testPathPattern` runs used instead).

## Skipped Issues

None — all 3 in-scope findings were fixed. IN-01 was excluded from scope per the task instructions (additional test coverage for the ambiguous-match branch across 3 of 4 tools; non-blocking, optional, left for a future iteration).

---

_Fixed: 2026-07-29T00:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
