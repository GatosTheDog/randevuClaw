# Phase 7: Billing Configuration & Payment Recording - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 07-billing-configuration-payment-recording
**Areas discussed:** Package creation UX, Client lookup in payment, Billing command routing

---

## Package creation UX

| Option | Description | Selected |
|--------|-------------|----------|
| NLU via Gemini | Owner types Greek natural language; Gemini parses all 4 fields and calls create_package tool | ✓ |
| Guided steps | Bot asks each field one at a time; follows onboarding steps pattern | |
| Hybrid | NLU for full-spec input; guided prompts for missing fields | |

**User's choice:** NLU via Gemini

---

| Option | Description | Selected |
|--------|-------------|----------|
| Inline keyboard button (Απεριόριστες / Με αριθμό) | Bot shows button to choose session type after intent detected | |
| NLU recognizes keywords | Gemini maps "απεριόριστες", "χωρίς όριο" etc. → null session_count | ✓ |
| You decide | Researcher/planner picks | |

**User's choice:** NLU recognizes keywords

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — always confirm | Bot echoes parsed fields and waits for Ναι/Όχι before writing to DB | ✓ |
| No — create immediately | Bot creates package and replies with confirmation | |

**User's choice:** Yes — always confirm

---

## Client lookup in payment

| Option | Description | Selected |
|--------|-------------|----------|
| Recent bookers as inline buttons | Bot shows last N clients from past 30 days; owner taps the right one | ✓ |
| Store Telegram first_name on first contact | Capture and store display name; schema addition needed | (also chose this for button labels) |
| Owner types partial name or date | Text-based search | |

**User's choice:** Recent bookers as inline buttons (last 30 days), with Telegram display names as labels

---

| Option | Description | Selected |
|--------|-------------|----------|
| Last 30 days of unique clients | Wider window; captures all active clients | ✓ |
| Last 7 days only | Shorter, more recent list | |
| You decide | Researcher/planner picks | |

**User's choice:** Last 30 days

---

| Option | Description | Selected |
|--------|-------------|----------|
| Service + date of last booking | No new fields needed | |
| Telegram display name (capture on first contact) | Store first_name in new client_name column | ✓ |
| You decide | Researcher/planner picks | |

**User's choice:** Telegram display name — implies adding `client_name text` column to `client_business_relationships` and capturing from `from.first_name` on each incoming message

---

## Billing command routing

| Option | Description | Selected |
|--------|-------------|----------|
| Extend ai-owner-agent with billing tools | Add billing Gemini tools to existing ai-owner-agent.ts | ✓ |
| New billing-router.ts parallel to edit-router.ts | Separate router with own keyword trigger | |

**User's choice:** Extend ai-owner-agent

---

| Option | Description | Selected |
|--------|-------------|----------|
| Client first, then package | Owner selects who paid → then which package | ✓ |
| Package first, then client | Owner selects package → then who bought it | |

**User's choice:** Client first, then package

---

## Claude's Discretion

None — all areas had clear user decisions.

## Deferred Ideas

- Payment gateway (Viva Wallet/Stripe) — v2.0
- Multiple simultaneous memberships per client — post-PoC
- Refunds, proration — v1.3
- ENFC-01 enforcement_policy column on businesses — Phase 8 adds this (not Phase 7 schema)

## User Notes (freeform)

- "Important we will NOT handle any payments" — confirmed Phase 7 is manual admin logging only; no money processing flows through the system
