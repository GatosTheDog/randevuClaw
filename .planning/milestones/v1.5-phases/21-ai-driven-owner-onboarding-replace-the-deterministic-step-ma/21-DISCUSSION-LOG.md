# Phase 21: AI-Driven Owner Onboarding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 21-AI-Driven Owner Onboarding
**Areas discussed:** Replacement scope, Resumability, Fallback behavior

---

## Replacement scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full agent, like aiOwnerAgent | Whole flow (name, hours, services, class setup, config toggles) becomes one freeform Gemini tool-calling conversation — owner can answer several things in one message. | ✓ |
| Hybrid — AI only for free-text-prone fields | Keep existing step sequence and Ναι/Όχι buttons as-is; swap Gemini in only for parsing hours and service price/duration answers. | |

**User's choice:** Full agent, like aiOwnerAgent
**Notes:** Matches the original ask ("make onboarding use ai too") and the roadmap goal text already written for this phase.

---

## Resumability

| Option | Description | Selected |
|--------|-------------|----------|
| Stateless, re-derive from DB | No step tracking — same pattern aiOwnerAgent already uses. Agent reads whatever's saved (business name, hours, services) each turn and figures out what's missing. | ✓ |
| Keep coarse progress marker | Track a rough phase in onboarding_sessions, fed into the agent's system prompt. | |

**User's choice:** Stateless, re-derive from DB
**Notes:** Preserves the existing ONB-03 "owner can drop off and resume" guarantee (PROJECT.md ADR) without a separate state machine to keep in sync with the new agent.

---

## Fallback when Gemini can't parse

| Option | Description | Selected |
|--------|-------------|----------|
| Gemini asks its own clarifying question | Natural, matches aiOwnerAgent's conversational style. Costs one more Gemini call; needs the same MAX_TOOL_ROUNDS-style cap. | ✓ |
| Fixed Greek error message re-ask | Same deterministic fallback text used today. Zero extra Gemini cost, fully predictable. | |

**User's choice:** Gemini asks its own clarifying question
**Notes:** Must reuse aiOwnerAgent's MAX_TOOL_ROUNDS cap to avoid infinite back-and-forth on unparseable input.

---

## Claude's Discretion

- Exact tool schema/field names for each onboarding action.
- Whether the onboarding agent is a separate Gemini agent/system-prompt from aiOwnerAgent, or the same agent in an onboarding mode.
- Whether the `/start` mid-onboarding reset command becomes a tool call or stays a hardcoded intercept.

## Deferred Ideas

- `src/onboarding/edit-router.ts` (post-onboarding settings editing) uses the same regex free-text pattern — same AI treatment could apply, but not named in this phase's roadmap goal. Flagged for planner to scope explicitly.
- Dropping/migrating the `onboardingSessions.currentStep`/`collectedData` columns once stateless resume lands — deferred to planning.
- Two todos reviewed but not folded (unrelated: WhatsApp per-business numbers pivot, Meta Business Verification submission) — keyword-only matches, no relevance to this phase.
