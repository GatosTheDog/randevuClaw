---
phase: 19-class-setup-onboarding
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/conversation/ai-agent.ts
  - src/conversation/function-executor.ts
  - src/onboarding/ai-owner-agent.ts
  - src/onboarding/router.ts
  - src/onboarding/steps.ts
  - src/scheduler/session-cancellation.ts
  - tests/onboarding-flow.test.ts
  - tests/onboarding/class-setup-steps.test.ts
  - tests/onboarding/steps.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-07-24
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 19 shipped two pieces of work: (1) six new `class_setup_*` onboarding
steps that wire class-schedule creation into the existing session catalog
(`buildRRuleString` / `createSessionCatalogWithExpansion`), and (2) a
terminology sweep replacing "σεζόν" with "μάθημα" in all bot-facing Greek
copy across `ai-agent.ts`, `function-executor.ts`, `ai-owner-agent.ts`, and
`session-cancellation.ts`.

The terminology sweep itself is clean — every replaced string is correct
Greek and none of the changed strings are used for exact-match parsing
(Gemini tool schemas use free-text `description` fields, not string
matching, so the wording change is safe there). However, the same commit
(`c050a7a`) silently changed the Gemini model constant in **both**
`ai-agent.ts` and `ai-owner-agent.ts` from `gemini-2.5-flash-lite` to
`gemini-3.5-flash-lite` — a change with zero relation to the stated
terminology-fix scope, undocumented in the commit message, and untested.
This is the standout finding of this review (see CR-01).

The new class-setup state machine (CLSS-01–04) is otherwise well-guarded:
capacity is validated 1-99 before any DB write, `serviceId`/`weekdays`/
`startTime` are defensively re-checked before calling
`createSessionCatalogWithExpansion`, and `listServicesForBusiness` /
`findServiceById` are always scoped by `business.id` from session context
(never from user text), closing the cross-tenant vector called out in the
code comments (T-19-02). Two input-validation gaps remain in
`handleClassSetupServiceStep` (see WR-01, WR-02) that are inconsistent with
the blank-input guards used everywhere else in this same file.

## Critical Issues

### CR-01: Gemini model version silently changed from 2.5 to 3.5 inside a terminology-only commit

**File:** `src/conversation/ai-agent.ts:10`, `src/onboarding/ai-owner-agent.ts:37`
**Issue:**
Commit `c050a7a` ("fix(19-02): replace σεζόν with μάθημα across all
user-visible Greek bot strings") changes, in addition to the stated Greek
copy, this unrelated line in **both** files:

```diff
-const GEMINI_MODEL = 'gemini-2.5-flash-lite';
+const GEMINI_MODEL = 'gemini-3.5-flash-lite';
```

This is a config/behavior change smuggled into an i18n-scoped commit — the
commit message explicitly claims "TypeScript identifiers (variable/
function/property names) unchanged" and describes only string replacements,
yet the actual model ID used for every single Gemini call (both the
client-facing booking agent and the owner management agent) was changed.
Per this project's own `CLAUDE.md` stack notes, `gemini-2.5-flash-lite` is
the documented free-tier model (Pro was cut from the free tier); there is no
mention anywhere in the project's tech stack docs of a `gemini-3.5` model
being available/validated for this project. If `gemini-3.5-flash-lite` is
not a valid/accessible model ID, **every** Gemini call in the app (booking
agent AND owner agent) will fail from this commit onward — a total outage
of the core product value ("book/cancel via chat") and of all owner
management functionality. No test in the repo asserts the model string
(`grep -rn "GEMINI_MODEL"` shows only the two definition/usage sites), so
CI would not have caught this.

Even if `gemini-3.5-flash-lite` turns out to be valid, this is still a
process/quality defect: an unrelated, unreviewed, undocumented behavioral
change riding inside a commit scoped and reviewed as "strings only."

**Fix:** Revert the model constant in both files to `gemini-2.5-flash-lite`
(or, if a deliberate model upgrade was intended, split it into its own
commit with its own test/verification and update `CLAUDE.md`'s stack
section accordingly):

```diff
-const GEMINI_MODEL = 'gemini-3.5-flash-lite';
+const GEMINI_MODEL = 'gemini-2.5-flash-lite';
```

## Warnings

### WR-01: `handleClassSetupServiceStep` treats blank/whitespace-only input as a match for the first service

**File:** `src/onboarding/steps.ts:652-680`
**Issue:** When the numeric-index branch fails (`isNaN(numericIndex)`), the
handler falls back to a case-insensitive substring match:

```ts
const lower = trimmed.toLowerCase();
matched = svcList.find((s) => s.name.toLowerCase().includes(lower)) ?? null;
```

If `trimmed === ''` (e.g. the owner sends a message with no text — a photo,
sticker, or an accidental blank send), `lower` is `''`, and
`s.name.includes('')` is `true` for *every* service name in JavaScript. The
handler therefore silently matches the **first** service in `svcList` and
advances the flow, attributing the class schedule to a service the owner
never actually selected. Every other text-collecting step in this same file
(`handleNameStep`, `handleSvcNameStep`) explicitly guards against blank
input (`if (!trimmed || ...)`); this handler is the one inconsistent case.

**Fix:** Reject empty input before attempting either match:

```ts
const trimmed = text.trim();
if (!trimmed) {
  const listText = svcList.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
  await sendTelegramMessage(ownerTelegramId, `Διαθέσιμες υπηρεσίες:\n${listText}\n\nΠοια υπηρεσία;`);
  return;
}
```

### WR-02: `handleClassSetupServiceStep` numeric parsing accepts trailing garbage

**File:** `src/onboarding/steps.ts:660-666`
**Issue:** `parseInt(trimmed, 10)` on an input like `"1abc"` returns `1`
(not `NaN`), so the handler treats `"1abc"` as a valid numeric selection of
the first service instead of falling through to substring matching or
re-asking. This silently accepts malformed input as a confident selection.

**Fix:** Use a strict numeric check before treating input as an index:

```ts
const isStrictNumeric = /^\d+$/.test(trimmed);
const numericIndex = isStrictNumeric ? parseInt(trimmed, 10) : NaN;
```

### WR-03: `handleClassSetupWeekdaysStep` does not de-duplicate repeated weekday input

**File:** `src/onboarding/steps.ts:711-743`
**Issue:** `parts.filter((p) => WEEKDAY_NAMES_SET.has(p))` keeps every
occurrence of a recognized day name, so input like `"Δευτέρα, Δευτέρα"`
produces `weekdays: ['Δευτέρα', 'Δευτέρα']`. This is passed straight to
`buildRRuleString(weekdays, startTime)`, which will emit a duplicated
`BYDAY` code (e.g. `BYDAY=MO,MO`). Downstream RRule expansion behavior for
a duplicated `BYDAY` token is not verified here (out of this phase's file
scope), but at minimum it is dead weight in the stored `collectedData` and
the confirmation message (`weekdays.join(', ')` will show the day twice to
the owner).

**Fix:** De-duplicate before storing:

```ts
weekdays = [...new Set(weekdays)];
```

## Info

### IN-01: No test coverage for blank-input / malformed-numeric-input to `handleClassSetupServiceStep`

**File:** `tests/onboarding/steps.test.ts`, `tests/onboarding/class-setup-steps.test.ts`
**Issue:** Both test files cover "name match", "numeric selection", and
"no match" for `handleClassSetupServiceStep`, but neither exercises an
empty-string or `"1abc"`-style input, so WR-01 and WR-02 above shipped
without a failing test to catch them.
**Fix:** Add cases asserting that blank text and non-strictly-numeric text
do not silently select a service.

### IN-02: Duplicate test coverage across two onboarding test files

**File:** `tests/onboarding/steps.test.ts`, `tests/onboarding/class-setup-steps.test.ts`
**Issue:** Both files independently re-implement near-identical mocks
(`jest.mock('../../src/database/db', ...)`, typed mock references, business/
session builders) and test the same six `class_setup_*` handlers plus
`handleConfigLastSessionThresholdStep` with overlapping scenarios (compare
`class-setup-steps.test.ts` tests A–N against `steps.test.ts`'s describe
blocks — they cover the same Ναι/Όχι/unrecognized/valid/invalid paths for
every handler). This is pure duplication with no differentiating coverage,
increasing maintenance cost (a behavior change requires updating assertions
in two places) without adding confidence.
**Fix:** Consolidate into a single test file, or clearly document why two
suites exist (e.g. one is a holdover from an earlier draft and should be
deleted).

### IN-03: `handleClassSetupServiceStep` has no defensive handling for an empty service list

**File:** `src/onboarding/steps.ts:652-680`
**Issue:** If `listServicesForBusiness(business.id)` ever returns an empty
array while in `class_setup_service` (currently unreachable in the
happy-path flow, since `svc_name`/`svc_price`/`svc_duration` guarantee at
least one service exists before `config_booking_mode` is reached), the
"no match" branch renders an empty numbered list (`svcList.map(...).join
('\n')` on `[]` is `''`) and, combined with WR-01, an owner sending blank
text would match against nothing meaningful while any non-blank text loops
forever with no way to exit class setup short of `/start` (which resets the
*entire* onboarding flow, not just class setup, re-prompting for business
name/hours even though those are already persisted). Not exploitable today,
but there is no guard if this invariant is ever weakened (e.g. a future
"delete service" tool becoming reachable mid-onboarding).
**Fix:** Add an explicit empty-list branch that skips class setup with a
message, mirroring the `svcList.length > 0 ? ... : '(δεν βρέθηκαν
υπηρεσίες)'` fallback already used in `handleClassSetupQuery`.

---

_Reviewed: 2026-07-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
