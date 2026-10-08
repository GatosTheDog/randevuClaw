---
status: resolved
trigger: "the chat is like having no memory at all for example i the bot aske me if he want me to do this action that is suggesting then i say yes and the it starts welcoming me from the beggining like the request never happend. We need to be a unified chat experiece with memory and everything that the llm can provide. And we need also a way to manage the context window"
created: 2026-10-08
updated: 2026-10-08
resolved: 2026-10-08
commit: "b24b1aa (migration 0014 + schema + queries), b897138 (memory module, agent wiring, tests)"
---

## Symptoms
- expected: Bot remembers prior turns. After bot proposes an action and user says "yes", bot executes it. Unified chat with LLM memory; context window managed (trim/summarize/token budget).
- actual: After user replies "yes" to a bot suggestion, bot restarts with welcome/greeting as if request never happened.
- errors: none reported
- timeline: unknown
- reproduction: Chat with bot (Telegram), let it propose an action, answer "yes".

## Current Focus
hypothesis: CONFIRMED - aiOwnerAgent and aiOnboardingAgent initialise `currentInteractionId` to undefined on every call and never persist/restore it, so every owner/onboarding message is a brand-new Gemini interaction with zero history. Client path chained via conversation_turns but had no context-window management and no recovery from an expired/rejected chain.
test: regression test tests/ai-owner-memory.test.ts "REGRESSION" fails on the original ai-owner-agent.ts (Expected previous_interaction_id "int-A", received undefined) and passes with the fix.
expecting: n/a
next_action: none - user confirmed fixed on the real bot (migration 0014 applied to the real DB, app deployed to fly.io); session archived to resolved/

reasoning_checkpoint:
  hypothesis: "Owner/onboarding agents lose memory because the Gemini interaction chain head (previous_interaction_id) is never persisted between webhook calls, so each user message starts a new interaction; the client agent loses memory after chain expiry/rejection and has no context bound."
  confirming_evidence:
    - "ai-owner-agent.ts / ai-onboarding-agent.ts: `let currentInteractionId: string | undefined;` is function-local and only assigned from interaction.id inside the same call's tool loop; nothing reads/writes the DB."
    - "Regression test against the ORIGINAL owner agent: second turn's first Gemini call has previous_interaction_id undefined instead of the first turn's interaction id."
    - "Client path: only findLatestConversationTurn().interactionId; no token bound, null interactionId on error turns breaks the chain, 404 retry drops history with no summary."
  falsification_test: "If the second turn were sent with the first turn's interaction id (and still greeted from scratch) the hypothesis would be wrong; test shows the id is missing, and with the fix the id is sent."
  fix_rationale: "Persist the chain head per (business, role, participant) and manage the window client-side (token budget from API usage, turn cap, idle reset, 404/400 recovery) with a rolling summary + verbatim tail seeding every fresh chain, so rollover never loses a pending question."
  blind_spots: "Not verified against the live Gemini API (no key access): behaviour of a dangling function_call on a chain is assumed to be rejected (handled by closing the call + 400/404 recovery); `store:false` on the summarizer call and `usage.total_input_tokens` field presence are taken from SDK typings. Concurrent messages from the same user can fork the chain (last writer wins)."

## Evidence
- timestamp: 2026-10-08
  checked: src/onboarding/ai-owner-agent.ts aiOwnerAgent() and src/onboarding/ai-onboarding-agent.ts aiOnboardingAgent()
  found: `let currentInteractionId: string | undefined;` declared inside the function, only set from interaction.id inside the tool loop (within a single turn). Never read from / written to DB. First Gemini call of every user message has previous_interaction_id undefined.
  implication: owner + onboarding agents are stateless across turns => "yes" to a prior suggestion arrives with no context => model greets from scratch. This is the reported symptom.
- timestamp: 2026-10-08
  checked: src/conversation/router.ts + ai-agent.ts (client path)
  found: client path reads findLatestConversationTurn(business, sender).interactionId and passes as previous_interaction_id; inserts conversation_turns row after each turn. So chaining exists for clients, but: (a) no context-window management at all (server-side chain grows unbounded; Gemini free tier retains stored interactions only ~1 day then 404), (b) a 404 silently drops memory with no summary carry-over, (c) turns with null interactionId break the chain, (d) conversation_turns is keyed (business, clientPhone) only - no role dimension, (e) MAX_TOOL_ROUNDS abort persisted a dangling (function_call-terminated) interaction id.
  implication: client has partial memory but no window management; owner/onboarding have none.
- timestamp: 2026-10-08
  checked: webhook routing src/webhooks/telegram.ts handleFoundBusiness
  found: owner w/ onboardingCompleted=false -> aiOnboardingAgent; owner otherwise -> aiOwnerAgent (after slash-command shortcuts); everyone else -> routeConversationMessage -> aiBookingAgent. Second aiOnboardingAgent call site near L1629 (callback_query branch).
  implication: wiring lives inside the 3 agent functions, so both onboarding call sites are covered automatically.
- timestamp: 2026-10-08
  checked: baseline test run (npx jest)
  found: 83 suites, 11 failed suites / 12 failed tests pre-existing and unrelated (TS type errors in test fixtures for scheduler-*, expiry-poller, function-executor; config.test; calendar-*; session-* DB-dependent). 817 passed. Baseline saved in scratchpad baseline.json.
  implication: regression gate = no NEW failures beyond this set.
- timestamp: 2026-10-08
  checked: tools that reply to the user themselves (owner: keyboard tools return ''; onboarding: finish_onboarding)
  found: agent loop returned immediately on '' WITHOUT sending a function_result, leaving the interaction ending in an unanswered function_call. Chaining from such an interaction is malformed.
  implication: persisting that id naively would turn the memory fix into a new bug (400s on the next message). Fixed by closing the call with a throw-away model call (owner) / dropping the chain (onboarding finish) and by treating 400/404 on a stored chain as "restart seeded".
- timestamp: 2026-10-08
  checked: sandbox/RLS facts relevant to the design
  found: owner/onboarding agents run OUTSIDE withBusinessContext (admin conn), client agent runs INSIDE a txn (idle_in_transaction timeout 15s; a failed statement would abort the whole webhook txn).
  implication: all memory DB access goes through runIsolated() (savepoint inside a txn, direct outside), queries are filtered by explicit (business, role, participant), and any failure degrades to the old stateless behaviour.

## Eliminated
- hypothesis: client path also loses memory because findLatestConversationTurn / RLS hides rows
  evidence: router passes previousTurn.interactionId and ai-agent.test.ts Test 5 proves it reaches previous_interaction_id; conversation_turns RLS policy is business-scoped and the call is inside withBusinessContext. Client chain works until expiry/abort - fixed separately.
  timestamp: 2026-10-08
- hypothesis: system prompts instruct the model to greet on every turn
  evidence: grep of the three system prompts found no greeting instruction; greeting was the model's default with an empty history. A continuity rule was still added to all three prompts as defence in depth.
  timestamp: 2026-10-08

## Resolution
root_cause: Owner and onboarding agents never persisted the Gemini interaction chain head between messages (function-local `currentInteractionId`), so every message started a brand-new interaction with no history; the client agent chained via conversation_turns but had no context-window bound, no recovery from an expired/rejected chain, and could persist a malformed (function_call-terminated) chain.
fix: |
  New persisted, role-aware memory (table conversation_memory, migration 0014) + src/conversation/memory.ts used by all three agents:
  chain head per (business, role, participant); context window managed by per-role prompt-token budget (from API usage), 30-turn cap, 20h idle reset and 400/404 recovery; every fresh chain is seeded with an LLM rolling summary (deterministic fallback) + last 4 exchanges verbatim; tool-replied turns are closed so chains stay well-formed; everything best-effort and savepoint-isolated; GDPR erase also deletes memory; continuity rule added to the 3 system prompts.
verification: |
  Self-verified (2026-10-08):
  - Regression test tests/ai-owner-memory.test.ts "REGRESSION" FAILS on the original ai-owner-agent.ts (second turn previous_interaction_id undefined) and PASSES with the fix; same scenario covered for onboarding (tests/onboarding/ai-onboarding-memory.test.ts) and client (tests/ai-agent.test.ts M1-M7).
  - New tests: conversation-memory.test.ts (40, policy/seed/summary/persistence), conversation-memory-db.test.ts (6, REAL local Postgres: migration idempotency, upsert/role isolation, savepoint isolation inside withBusinessContext, round trip + token-budget rollover, legacy fallback, GDPR erase, timestamp skew), ai-owner-memory.test.ts (8), ai-onboarding-memory.test.ts (3), ai-agent.test.ts (+7). All pass.
  - tsc --noEmit clean.
  - Full suite vs baseline: no genuine regressions. The pre-existing real-DB suites that appear as "new failures" in a full run (TS2451/TS6200 global-scope redeclarations between script-style test files sharing a ts-jest worker, plus one load-induced 5s timeout) are scheduling flakes: the same 10 suites pass 49/49 when each runs in its own worker. Baseline itself varied between 11 and 26 failing suites run to run.
  - Migration 0014 applied twice (idempotent) to the LOCAL randevuclaw_test DB only. NOT applied to the real/production DB.
  Human verification (2026-10-08): migration 0014 applied to the real DB and the app deployed to fly.io by the main session; user confirmed "confirmed fixed" on the real bot (bot now acts on "yes" to its own suggestion instead of re-greeting).
  Committed as b24b1aa (db layer) and b897138 (memory module, agent wiring, tests). Not pushed.
files_changed:
  - src/conversation/memory.ts (new)
  - src/conversation/ai-agent.ts
  - src/onboarding/ai-owner-agent.ts
  - src/onboarding/ai-onboarding-agent.ts
  - src/database/schema.ts
  - src/database/queries.ts
  - migrations/0014_conversation_memory.sql (new)
  - tests/conversation-memory.test.ts (new)
  - tests/conversation-memory-db.test.ts (new)
  - tests/ai-owner-memory.test.ts (new)
  - tests/ai-agent.test.ts
  - tests/onboarding/ai-onboarding-memory.test.ts (new)
