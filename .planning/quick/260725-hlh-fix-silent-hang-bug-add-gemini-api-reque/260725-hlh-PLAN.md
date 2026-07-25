---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/onboarding/ai-onboarding-agent.ts
  - src/onboarding/ai-owner-agent.ts
  - src/conversation/ai-agent.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "A stalled Gemini HTTP call rejects after 25 seconds instead of hanging the webhook's DB transaction forever."
    - "Each affected file's existing try/catch error path (already logging + returning a Greek fallback string) is the mechanism that handles the timeout rejection — no new catch logic is introduced."
  artifacts:
    - "src/onboarding/ai-onboarding-agent.ts: GoogleGenAI construction includes httpOptions.timeout"
    - "src/onboarding/ai-owner-agent.ts: GoogleGenAI construction includes httpOptions.timeout"
    - "src/conversation/ai-agent.ts: GoogleGenAI construction includes httpOptions.timeout"
  key_links:
    - "new GoogleGenAI({ apiKey, httpOptions: { timeout } }) -> ai.interactions.create/ai.models.generateContent call sites already wrapped in existing try/catch in each file"
---

<objective>
Fix a confirmed silent-hang bug: three `GoogleGenAI` client constructions have no HTTP request timeout, so a stalled Gemini API response never resolves or rejects — the surrounding try/catch never fires, no error is logged, and (in the onboarding webhook path) the open Postgres transaction is held indefinitely.

Purpose: Bound every Gemini API call to a finite wall-clock duration so failures surface through the existing (already-correct) error-handling path instead of hanging the process.

Output: All three `GoogleGenAI` constructor call sites updated with `httpOptions: { timeout: 25000 }`. No other logic changed.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
This is a quick, fully-diagnosed bug fix — no research or discovery needed. Root cause (confirmed via production fly.io logs + SDK type defs):

- `src/onboarding/ai-onboarding-agent.ts:380` — `const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });` — used by `executeOnboardingTool` / the onboarding agent, called from inside `botTokenStore.run(...) -> withBusinessContext(...)` in `src/webhooks/telegram.ts:773-774`, which holds an open Postgres transaction (`src/database/queries.ts:97-112`) for the callback's full duration. The `ai.interactions.create(...)` await at line ~649 never times out today.
- `src/onboarding/ai-owner-agent.ts:36` — same pattern, same missing timeout, same risk (note: actual path is `src/onboarding/ai-owner-agent.ts`, not `src/owner/ai-owner-agent.ts`).
- `src/conversation/ai-agent.ts:8` — same pattern, same missing timeout, used by the client-facing booking conversation agent.

Fix confirmed via `node_modules/@google/genai/dist/node/node.d.ts`: `GoogleGenAIOptions.httpOptions?: types.HttpOptions`, and `HttpOptions.timeout?: number` (milliseconds, "Timeout for the request in milliseconds"). This is distinct from `CallableToolConfig.timeout` (only applies to tool remote calls) — do not confuse the two.

Existing try/catch blocks in all three files already log errors and return a Greek fallback message on failure — that error-handling path is correct and does NOT need to change. This fix only ensures the promise these blocks await can actually reject.

Existing tests mock `@google/genai` via `jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn().mockImplementation(() => ({...})) }))` (see `tests/ai-agent.test.ts` and `tests/onboarding/ai-onboarding-agent.test.ts`) — the mock constructor accepts any arguments, so adding `httpOptions` to the real constructor call does not require test changes.

@src/onboarding/ai-onboarding-agent.ts
@src/onboarding/ai-owner-agent.ts
@src/conversation/ai-agent.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Gemini API request timeout to all three GoogleGenAI client constructions</name>
  <files>src/onboarding/ai-onboarding-agent.ts, src/onboarding/ai-owner-agent.ts, src/conversation/ai-agent.ts</files>
  <action>
In each of the three files, locate the existing line constructing the Gemini client: `const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });`. Change it to pass a second constructor option `httpOptions: { timeout: 25000 }` alongside the existing `apiKey`, so the object literal becomes `{ apiKey: config.geminiApiKey, httpOptions: { timeout: 25000 } }`. This is a request-level timeout (milliseconds) on the underlying HTTP client used by the SDK — not the unrelated `CallableToolConfig.timeout` field (that one only bounds tool remote calls, not the API response itself).

Do not touch anything else in these files: no changes to imports, to the surrounding try/catch blocks, to the DB transaction/`withBusinessContext` structure in the webhook layer, or to any other constructor options. This is a single-line change per file, repeated three times.

Add a one-line comment directly above each modified constructor call explaining why the timeout exists, e.g. noting that a stalled Gemini HTTP response previously hung silently because the promise never settled, and that 25s bounds it so the existing catch block can log and fall back to a Greek message. Keep the comment short and file-local — do not duplicate the full bug narrative in all three files verbatim; paraphrase for each file's context (onboarding agent, owner agent, conversation agent).
  </action>
  <verify>
    <automated>grep -n "httpOptions: { timeout: 25000 }" src/onboarding/ai-onboarding-agent.ts src/onboarding/ai-owner-agent.ts src/conversation/ai-agent.ts | wc -l | grep -q "^3$" && echo PASS || echo FAIL</automated>
  </verify>
  <done>All three files contain `httpOptions: { timeout: 25000 }` in their `new GoogleGenAI(...)` constructor call, with no other lines in these files changed besides the added explanatory comment.</done>
</task>

<task type="auto">
  <name>Task 2: Verify build and existing tests are unaffected</name>
  <files>none (verification only)</files>
  <action>
Run the TypeScript build to confirm the added `httpOptions` field type-checks against the SDK's `GoogleGenAIOptions`/`HttpOptions` types, then run the existing Jest suites that exercise these three files to confirm the mocked `GoogleGenAI` constructor (which accepts arbitrary arguments) is unaffected by the new argument. Do not modify any test files — this task is verification-only. If the build or tests fail for reasons unrelated to this change (pre-existing failures), note them but do not attempt unrelated fixes; only fix a failure if it is directly caused by the `httpOptions` addition (e.g., a type error from a wrong field name).
  </action>
  <verify>
    <automated>npm run build && npx jest tests/ai-agent.test.ts tests/onboarding/ai-onboarding-agent.test.ts tests/webhooks/telegram-webhook.onboarding.test.ts tests/onboarding/edit-router.test.ts</automated>
  </verify>
  <done>`npm run build` exits 0 (no new TypeScript errors) and all listed Jest test files pass with no new failures attributable to this change.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Node process -> Gemini API (external HTTPS) | Outbound call to Google's Gemini endpoint; response latency/availability is untrusted and outside this process's control. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-01 | Denial of Service | Gemini API call sites (all 3 files) | high | mitigate | This fix: bound every `GoogleGenAI` HTTP call to 25s via `httpOptions.timeout`, so a stalled/slow upstream response can no longer hold a webhook request (and, for onboarding, an open Postgres transaction) open indefinitely. |
</threat_model>

<verification>
Confirm via `grep` that all three files contain the `httpOptions: { timeout: 25000 }` addition (Task 1 verify), then confirm `npm run build` succeeds and the relevant existing Jest suites for these three files pass with no new failures (Task 2 verify). No manual/human verification needed — this is a backend-only, non-behavioral-surface change (the only observable difference is that hangs now resolve within 25s via the pre-existing catch/fallback path).
</verification>

<success_criteria>
- `src/onboarding/ai-onboarding-agent.ts`, `src/onboarding/ai-owner-agent.ts`, and `src/conversation/ai-agent.ts` each construct `GoogleGenAI` with `httpOptions: { timeout: 25000 }`.
- No other code in these files (try/catch structure, DB transaction/`withBusinessContext` usage, imports) is changed.
- `npm run build` passes with no new TypeScript errors.
- Existing Jest tests covering these three files pass unchanged.
</success_criteria>

<output>
Create `.planning/quick/260725-hlh-fix-silent-hang-bug-add-gemini-api-reque/260725-hlh-SUMMARY.md` when done
</output>
