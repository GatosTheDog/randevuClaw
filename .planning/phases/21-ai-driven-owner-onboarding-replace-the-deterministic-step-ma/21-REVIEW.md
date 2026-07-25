---
phase: 21-ai-driven-owner-onboarding-replace-the-deterministic-step-ma
reviewed: 2026-07-25T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/onboarding/ai-onboarding-agent.ts
  - tests/onboarding/ai-onboarding-agent.test.ts
  - src/onboarding/ai-owner-agent.ts
  - src/webhooks/telegram.ts
  - tests/webhooks/telegram-webhook.onboarding.test.ts
  - tests/onboarding/edit-router.test.ts
  - src/onboarding/queries.ts
  - tests/admin-menu.test.ts
  - tests/webhooks/client-menu.test.ts
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-07-25
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the new Gemini tool-calling onboarding agent (`ai-onboarding-agent.ts`), its rewiring into `telegram.ts`, the trimmed `onboarding/queries.ts`, and associated tests. The Gemini loop structure, MAX_TOOL_ROUNDS guard, `''`-signals-own-reply convention, and RLS wrapping for most mutations are implemented correctly and mirror the established `ai-owner-agent.ts` pattern well. Test coverage for `executeOnboardingTool` and the Gemini round-trip loop is solid.

However, one tool handler (`set_business_name`) performs its cross-tenant slug-uniqueness check *inside* the RLS-scoped `withBusinessContext`, which silently defeats the very check it's trying to perform — this is a genuine, provable BLOCKER that will permanently fail onboarding for any business whose name collides with another tenant's slug. Several other findings relate to schema/handler required-field mismatches between the new onboarding tool schemas and the shared billing-tools Zod validators, missing bounds validation on Gemini-supplied `day_of_week`, and code duplication.

The collateral test-mock cleanup in `tests/admin-menu.test.ts` and `tests/webhooks/client-menu.test.ts` (removal of the stale `jest.mock('../../src/onboarding/router')` line) is clean — no leftover references to the deleted `router`/`steps` modules remain in either file, and their `jest.mock('.../onboarding/ai-owner-agent')` mocks are intact.

## Critical Issues

### CR-01: `set_business_name` slug-uniqueness check is silently broken by RLS scoping

**File:** `src/onboarding/ai-onboarding-agent.ts:401-408`
**Issue:**

```js
return await withBusinessContext(business.id, async () => {
  const existingSlugsRows = await getConn().select({ slug: businesses.slug }).from(businesses);
  const existingSlugs = existingSlugsRows.map((r) => r.slug);
  const slug = generateSlug(name, existingSlugs);
  await getConn().update(businesses).set({ name, slug }).where(eq(businesses.id, business.id));
  return `OK: το όνομα ορίστηκε σε "${name}"`;
});
```

`getConn()` inside `withBusinessContext` returns the RLS-scoped `appDb` transaction. The `businesses` table's RLS policy (`migrations/0003_phase4_per_bot.sql:153-157`) is:

```sql
CREATE POLICY businesses_isolation ON businesses
  FOR ALL
  USING (id = current_setting('app.current_business_id', true)::INTEGER)
  ...
```

So `getConn().select(...).from(businesses)` here can only ever return **the current business's own row** — never any other tenant's slug. `existingSlugs` is therefore always `[this business's own placeholder slug]` (e.g. `pending-abc123`), which will essentially never collide with the freshly-derived slug, so `generateSlug()` always returns the unsuffixed base slug and never detects a real cross-tenant collision.

Since `businesses.slug` has a `UNIQUE` constraint (`migrations/0000_cloudy_expediter.sql:7`), any two businesses that pick the same name (very plausible for common Greek business names, e.g. "Pilates Athens") will both compute the same base slug. The second business's `UPDATE` throws a unique-constraint violation, which is caught by the outer `try/catch` in `executeOnboardingTool` (line 597) and turned into the generic `'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.'`. Because the owner will keep resending the same business name, this failure is **permanent and unrecoverable** without manual DB intervention — the business can never finish the "set name" step of onboarding.

This is untested: `tests/onboarding/ai-onboarding-agent.test.ts`'s `set_business_name` test mocks `getConn().select(...).from(...)` to resolve `[]` unconditionally, so it can't catch the RLS-scoping defect.

**Fix:** Perform the cross-tenant slug lookup with the admin connection (`db`), *before* entering the RLS-scoped `withBusinessContext`, then only do the actual per-tenant `UPDATE` inside the RLS context:

```ts
import { db } from '../database/db';
// ...
case 'set_business_name': {
  const name = args.name?.trim();
  if (!name) return 'Μη έγκυρο όνομα.';
  if (name.length > 100) return 'Το όνομα είναι πολύ μεγάλο (μέγιστο 100 χαρακτήρες).';

  // Cross-tenant slug lookup MUST use the admin connection — businesses_isolation
  // RLS would otherwise scope this SELECT to just this business's own row.
  const existingSlugsRows = await db.select({ slug: businesses.slug }).from(businesses);
  const existingSlugs = existingSlugsRows.map((r) => r.slug);
  const slug = generateSlug(name, existingSlugs);

  return await withBusinessContext(business.id, async () => {
    await getConn().update(businesses).set({ name, slug }).where(eq(businesses.id, business.id));
    return `OK: το όνομα ορίστηκε σε "${name}"`;
  });
}
```

## Warnings

### WR-01: `set_cancellation_cutoff` / `set_last_session_threshold` tool schemas advertise optional fields the shared Zod handlers require unconditionally

**File:** `src/onboarding/ai-onboarding-agent.ts:158-171`, `184-199`, `526-530`, `546-550`
**Issue:** `ONBOARDING_TOOLS`' `set_cancellation_cutoff` only requires `['enabled']` (line 169), with `hours` documented as "Απαιτείται όταν enabled=true" (required only when enabling). But the shared validator it delegates to, `SetCancellationCutoffSchema` (`src/billing/tools.ts:186-189`), is:

```ts
const SetCancellationCutoffSchema = z.object({
  enabled: z.boolean(),
  hours: z.number().int().min(1).max(168),
});
```

`hours` is unconditionally required — there's no `.optional()` or refinement keyed on `enabled`. So if the owner says "απενεργοποίησε το όριο ακύρωσης" (a completely legitimate disable request) and Gemini follows the tool's documented contract by omitting `hours`, `handleSetCancellationCutoff`'s `safeParse` fails and returns `'Μη έγκυρα δεδομένα. Απαιτείται enabled (true/false) και hours (1-168).'` — confusing, since the owner never wanted to set hours at all.

The `set_last_session_threshold` onboarding schema has the same shape mismatch (`required: ['enabled']` only, line 197), but its handler, `handleSetLastSessionThreshold` (`src/billing/tools.ts:275-280`), uses `SetLastSessionThresholdSchema.parse(args)` — a **throwing** parse, not `safeParse`. If `count` is omitted, this throws a `ZodError` uncaught inside `handleSetLastSessionThreshold`, propagates up, and is swallowed by `executeOnboardingTool`'s generic catch (line 597-600), surfacing only `'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.'` — no indication of what actually went wrong.

Contrast with `ai-owner-agent.ts`, whose equivalent tool schemas require **both** fields (`required: ['enabled', 'hours']` at line 248, `required: ['enabled', 'count']` at line 359), which avoids this exact gap.

**Fix:** Either make `hours`/`count` truly optional in the shared Zod schemas (defaulting or refining based on `enabled`), or match `ai-owner-agent.ts`'s stricter `required` arrays in `ONBOARDING_TOOLS` so Gemini always supplies the value:

```ts
// billing/tools.ts
const SetCancellationCutoffSchema = z.object({
  enabled: z.boolean(),
  hours: z.number().int().min(1).max(168).optional(),
}).refine((v) => !v.enabled || v.hours !== undefined, {
  message: 'hours is required when enabled=true',
});
```

### WR-02: No bounds validation on Gemini-supplied `day_of_week` in `set_business_hours` / `close_day`

**File:** `src/onboarding/ai-onboarding-agent.ts:411-459`
**Issue:** Both handlers only check `day_of_week === undefined`, never that it's within `0..6`:

```js
if (day_of_week === undefined || !open_time || !close_time) return 'Μη έγκυρα δεδομένα ωραρίου.';
```

If Gemini ever hallucinates an out-of-range value (e.g. `7`), the row is inserted as-is (no DB constraint enforces the range in the reviewed schema), `GREEK_WEEKDAYS[day_of_week]` renders as `undefined` in the confirmation text, and — more importantly — `computeOnboardingCompleteness`'s `hasAllHours = hoursList.length === 7` (line 231) can become `true` while a real weekday (e.g. Sunday) is still unconfigured. This directly corrupts the D-02 "stateless completeness re-derivation" invariant this phase is built around, letting `finish_onboarding` succeed with an incomplete weekly schedule.

**Fix:**
```js
if (day_of_week === undefined || day_of_week < 0 || day_of_week > 6 || !open_time || !close_time) {
  return 'Μη έγκυρα δεδομένα ωραρίου.';
}
```

### WR-03: `finish_onboarding` has no compensating action between the external webhook registration and the DB write that records it

**File:** `src/onboarding/ai-onboarding-agent.ts:568-583`
**Issue:**
```js
await unregisterBotWebhook(business.botToken!);
await registerBotWebhook(business.botToken!, `${config.webhookBaseUrl}/webhooks/telegram/${webhookId}`, webhookSecret);
await activateBusiness(business.id, webhookId, webhookSecret);
```
If `activateBusiness` (a DB write) throws after `registerBotWebhook` has already succeeded (a Telegram-side side effect), the business's Telegram bot is now pointed at a `webhookId` that `findBusinessByWebhookId` will never find (the DB still has the old/null `webhookId`). Every subsequent Telegram update to that bot 404s at `src/webhooks/telegram.ts:724-729`, and the business is left in a broken half-activated state with no automatic recovery path. The comment says this mirrors the deleted `steps.ts`'s `handleActivate`, so the risk pre-dates this phase, but it is carried unchanged into the new code path and is worth closing here since this phase already touched every line around it.

**Fix:** Wrap in a retry/rollback, or re-order so the DB write happens first with a `pending` flag flipped only after Telegram confirms, or at minimum log at `error` (not just swallow) so an on-call human can catch it — today a partial failure here returns the same generic `'Σφάλμα κατά την εκτέλεση...'` as any other tool error, giving no signal that a compensating unregister is needed.

### WR-04: Gemini wrapper types duplicated verbatim between `ai-owner-agent.ts` and `ai-onboarding-agent.ts`

**File:** `src/onboarding/ai-onboarding-agent.ts:352-373`, cf. `src/onboarding/ai-owner-agent.ts:858-878`
**Issue:** `GeminiCreateParams`, `GeminiFunctionResultInput`, and `GeminiInteractionResult` are copy-pasted between the two files (the comment even says "mirror ai-owner-agent.ts"). `GEMINI_MODEL` was correctly extracted to a single exported constant in `ai-owner-agent.ts` specifically to avoid this kind of drift risk (see the comment at `ai-owner-agent.ts:37-39`), but the type definitions right next to it were not given the same treatment.
**Fix:** Extract these three interfaces (and the `ai`/`MAX_TOOL_ROUNDS` constants, which are also duplicated) into a shared `src/onboarding/gemini-types.ts` (or similar) module imported by both agents.

### WR-05: Missing/weak input bounds checks in `add_service` and `create_class_schedule`

**File:** `src/onboarding/ai-onboarding-agent.ts:461-475`, `501-524`
**Issue:**
- `add_service` validates only `name` and `duration_min !== undefined`, never that `duration_min > 0`. A Gemini-supplied `duration_min: 0` or negative value is inserted as-is.
- `create_class_schedule` defaults `service_name` to `''` when absent (`args.service_name ?? ''`, line 502) even though `service_name` is a `required` field per the tool schema. `''.toLowerCase().includes(''.toLowerCase())` is always `true`, so an empty/missing `service_name` silently matches the *first* service in `svcList` rather than failing with a clear "no service specified" message.

**Fix:**
```js
if (!name || duration_min === undefined || duration_min <= 0) return 'Μη έγκυρα δεδομένα υπηρεσίας.';
```
```js
const svcNameArg = (args.service_name ?? '').trim();
if (!svcNameArg) return 'Δεν δόθηκε όνομα υπηρεσίας.';
```

## Info

### IN-01: `src/onboarding/edit-router.ts` is dead code with only its own test as a consumer

**File:** `tests/onboarding/edit-router.test.ts:1` (source: `src/onboarding/edit-router.ts:79-92`)
**Issue:** `routeOwnerEdit` and `hasPendingEditState` are exported from `edit-router.ts` but are not called anywhere in `src/` (`grep -rn "routeOwnerEdit\|hasPendingEditState" src/` returns only the definitions and a stale doc-comment). This became unreachable back in commit `14fe0d1` ("AI-powered owner agent — Gemini NLU replaces keyword matching"), which predates Phase 21, so it is not a regression introduced by this phase. Given Phase 21's explicit mandate to retire the deterministic onboarding step machine in favor of Gemini tool-calling, this leftover keyword-router module (and its dedicated test file, which is the file actually in this review's scope) is a natural companion cleanup candidate.
**Fix:** Confirm `edit-router.ts` has no remaining callers and delete it + `tests/onboarding/edit-router.test.ts` in a follow-up cleanup pass (or file a backlog item if intentionally kept for a future revert path).

### IN-02: Stale comments referencing deleted `src/onboarding/steps.ts`

**File:** `src/onboarding/ai-onboarding-agent.ts:569`, `tests/onboarding/ai-onboarding-agent.test.ts:235`
**Issue:** Both comments reference `src/onboarding/steps.ts`, which this same phase deleted (commit `01e67b1`). The references are harmless (they're citing prior art for a pattern), but will confuse future readers who `grep` for the file and find nothing.
**Fix:** Update the comments to reference the git history/commit instead of a path that no longer exists, e.g. "mirrors the pre-Phase-21 handleActivate pattern (see git history)".

---

_Reviewed: 2026-07-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
