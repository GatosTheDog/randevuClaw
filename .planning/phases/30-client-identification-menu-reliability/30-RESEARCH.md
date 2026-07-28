# Phase 30: Client Identification & Menu Reliability - Research

**Researched:** 2026-07-29
**Domain:** Client-identification UX (UX-03) + Telegram Bot API menu-button reliability investigation (ADMIN-05)
**Confidence:** HIGH (UX-03: codebase-verified; ADMIN-05: Telegram API documentation + community reports)

## Summary

Phase 30 addresses two distinct problems in v1.7:

**UX-03 (Client Identification):** Owners currently cannot find clients by name in four LLM-facing tools; they must copy raw Telegram numeric IDs. This phase converts those tools to accept name-based matching with disambiguation when multiple clients share the same name. The implementation reuses the existing case-insensitive substring-match predicate and the stateless Gemini tool-calling architecture (no new state machines or multi-step flows).

**ADMIN-05 (Menu Button Reliability):** Phase 24 introduced persistent Telegram menu buttons via `setChatMenuButton`/`setMyCommands`, but in-the-wild reliability is inconsistent. Research reveals the unreliability is primarily client-side caching behavior—not fixable via app code alone. This phase implements code-side resilience (retry + re-assertion per D-06) and documents the client-side limitations so owners know what to expect. The research confirms that the Telegram Bot API calls are correctly implemented and don't require periodic re-calling; the real-world issue is mobile/desktop app cache refresh delays.

**Primary recommendation:** 
- **UX-03:** Implement name-based matching using the 4-tool reusable pattern found in ai-owner-agent.ts. Test coverage must validate the disambiguation branch (2+ name matches) and zero-match branch explicitly.
- **ADMIN-05:** Implement D-06's retry + re-assertion hedge as planned. Document the client-side caching behavior and provide owner guidance (app restart clears cached menu buttons). No additional API-level mitigations exist beyond D-06.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (Raw-ID Tool Scope):** All 4 client-identifying tools in `src/onboarding/ai-owner-agent.ts` are converted: `view_client_membership` (schema 245-259, executor 739-745), `assign_client_to_session` (schema 362-383, executor 849-881), `send_renewal_reminder` (schema 412-423, executor 900-911), and `list_slotless_requests` (schema 384-398, executor 883-892). Out of scope: `src/telegram/escalation.ts`'s `clientTelegramId` param (not LLM-facing) and `record_payment` (already uses `showClientSelection` button picker).

**D-02 (Name-Only Matching):** Raw Telegram ID/phone input is removed entirely in favor of name param. Clients with no `clientName` on file (never messaged bot yet) become unreachable until they send at least one message. This is a deliberate, locked choice against the "accept both name and ID" alternative.

**D-03 (Zero-Match Response):** Generic "no client found" response, same shape regardless of whether the typo or the client has no name on file. No special-cased hints about the first-message gate.

**D-04 (Text-Based Disambiguation):** When a name substring-matches 2+ clients, the tool returns match list as plain text in the tool result; Gemini agent narrates the ambiguity in Greek and asks the owner to be more specific; owner's next reply triggers Gemini to re-call the tool with a narrower name. Reuses zero new state—no stateful inline-keyboard flow.

**D-05 (Disambiguation Shows Names Only):** Disambiguation text shows only client names—never raw Telegram ID/phone. ID/phone stays internal. May include last-booking-date or other name-adjacent context for tie-breaking identical names, at Claude's discretion.

**D-06 (Menu-Button Resilience Code Hedge):** Add retry (small number of attempts, exponential-ish backoff) to the 4 `setMyCommands`/`setChatMenuButton` calls in `finish_onboarding` (src/onboarding/ai-onboarding-agent.ts:600-616), replacing the silent single try/catch. Re-assert these calls on every owner `/menu` tap (idempotent safe). This hedges the "one-shot call fired once in the business's entire lifetime, never repeated" gap, independent of the deeper Telegram client-side research.

### Claude's Discretion

- Exact retry count/backoff shape for D-06.1
- Exact wiring point for D-06.2's re-assertion (e.g., inside `/menu` text-command branch vs. `menu:root` callback)
- Whether disambiguation context (D-05) includes last-booking-date or stays name-only for identical names
- Exact Greek wording for disambiguation re-ask and generic no-match message
- Whether to consolidate duplicated `assertCallbackDataSize` helper (unrelated to scope, may be touched opportunistically only if genuinely free)

### Deferred Ideas (OUT OF SCOPE)

- Consolidating `assertCallbackDataSize` helper duplicated across 3 files (admin-menu.ts, client-menu.ts, escalation.ts) — found during prior research, unrelated to UX-03/ADMIN-05 scope

## Phase Requirements

| Requirement ID | Text | Research Support |
|---|---|---|
| UX-03 | Chat tools that currently require a raw Telegram numeric ID to identify a client (view membership, assign client to session, send renewal reminder) accept a name-based match instead, with disambiguation shown when multiple clients match | Section "Pattern 1: Name-Based Client Matching with Disambiguation" provides the exact implementation approach, test coverage strategy for 2+ and 0-match branches, and verified code references in ai-owner-agent.ts |
| ADMIN-05 | Telegram persistent menu button reliability is investigated (client-side caching, scope semantics, re-registration needs) and any code-addressable gap is fixed or documented as a client-side limitation | Section "Pattern 2: Telegram Menu-Button Resilience with Client-Side Limitation Documentation" documents research findings on caching behavior, provides D-06 implementation approach, and explains why remaining unreliability is unfixable at app level |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Client identification by name (UX-03) | Backend / AI Agent (Gemini function-calling) | Database (client name lookup) | Owner agent parses owner's text, calls the tool, disambiguates via re-asking. Database provides the name index. Client name is populated from client's Telegram `from.first_name` on each message. |
| Menu button persistence and reliability (ADMIN-05) | Backend (bot setup / webhook handler) | Telegram Platform (client-side cache) | App code calls `setChatMenuButton`/`setMyCommands` once during onboarding (D-06 adds retry) and re-asserts on each `/menu` tap. Telegram platform caches the result client-side indefinitely. Client-side refresh (app restart, cache clear) is user responsibility. |

## Standard Stack

### Core (UX-03 Client Identification)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | 0.30+ | Query filtering for client lookup | Already in stack for all DB queries; RLS-scoped reads via `withBusinessContext()` |
| Gemini 3.1 Flash-Lite (Existing) | 2.10.0+ | Tool-calling for name-based matching | Phase 21 locked; tool result surfaces match count, agent decides re-ask |
| TypeScript | 5.0+ | Type-safe client name resolution | Existing stack; enables type-safe `filter(x => x.clientName.toLowerCase().includes(needle))` |

### Supporting (ADMIN-05 Menu-Button Resilience)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Built-in JavaScript `setTimeout` + `Math.exp` | N/A | Retry backoff for D-06.1 | Simple exponential backoff (e.g., 500ms → 1s → 2s) sufficient; no external lib needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Name-based substring matching | Fuzzy matching library (fuse.js) | REQUIREMENTS.md explicitly rejects fuse.js for UX-03; case-insensitive substring match (already used for service names) is locked approach |
| Text-based disambiguation re-ask | Stateful inline-keyboard callback flow | Violates Phase 21 lock (stateless agent); no new state machine. Text-based reuses zero new architecture. |
| Showing name + Telegram ID in disambiguation | Name-only per D-05 | Telegram ID exposes internal implementation detail to owner; name alone is sufficient for disambiguation, especially when tied to last-booking-date |
| Single one-shot `setChatMenuButton` call | Periodic re-calling / polling | No API requirement for periodic calls; D-06's re-assertion on `/menu` tap is the idempotent-safe pattern for "just in case" hedge |
| Reply keyboard alternative for menu | Persistent menu button via `setChatMenuButton` | Reply keyboards are sent with each message (clutters chat); menu button is cleaner UX. Menu button has client-side caching delay, not a breaking issue |

## Package Legitimacy Audit

**Not applicable.** Phase 30 adds no new external packages. UX-03 uses existing Drizzle ORM and Gemini SDK. ADMIN-05 uses built-in `setTimeout` for retry backoff.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Owner (Telegram client)                                      │
└──────────────┬──────────────────────────────────────────────┘
               │ Owner message: "Show client membership for γιώργος"
               ▼
┌──────────────────────────────────────┐
│ Telegram Webhook (src/webhooks)      │
│ Routes to owner agent                │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│ AI Owner Agent (src/onboarding/ai-owner-agent.ts)           │
│ - Parses owner message via Gemini NLU                        │
│ - Calls view_client_membership tool with name="γιώργος"      │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Tool Executor (ai-owner-agent.ts case handler)               │
│ - Fetches ALL clients for business via                       │
│   getAllClientsForBusiness()                                 │
│ - Filters by name.toLowerCase().includes("γιώργος")          │
│ - Branches on match count:                                   │
│   • 0 matches → return generic "no client found"             │
│   • 1 match → call handleViewClientMembership(clientPhone)   │
│   • 2+ matches → return match list as text                   │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
        Gemini Sees Result
               │
       ┌───────┴────────┬──────────────┐
       │                │              │
    1 match          2+ matches    0 matches
       │                │              │
       ▼                ▼              ▼
   [Membership]  [Ask for clarification]  [Generic error]
                       │
                   Owner replies:
                   "Γιώργος Παπαδόπουλος"
                       │
                       ▼
              Re-call view_client_membership
              with name="Γιώργος Παπαδόπουλος"
                  [now 1 match, proceed]
```

**ADMIN-05 Menu-Button Resilience:**

```
┌─────────────────────────────────────────┐
│ Business Onboarding Complete            │
│ (src/onboarding/ai-onboarding-agent.ts) │
└──────────────┬──────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ D-06.1: Retry Loop (finish_onboarding)   │
│ setChatMenuButton + setMyCommands         │
│ Retry on failure: 500ms → 1s → 2s        │
│ (exponential backoff, 3-5 attempts)      │
└──────────────┬──────────────────────────┘
               │
               ├─ Success ──→ [Webhook accepts, returns 200]
               │                    │
               │                    ▼
               │            [Message queued, app continues]
               │
               └─ Exhausted ──→ [Log error, continue anyway]
                                (idempotent, safe to retry later)

┌──────────────────────────────────────┐
│ Owner Taps /menu Button or            │
│ Calls /menu Command                   │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ D-06.2: Menu Handler (admin-menu.ts)     │
│ (Best-effort re-assertion)               │
│ - Call setChatMenuButton again           │
│ - Call setMyCommands again               │
│ - (No blocking; reply sent first)        │
└──────────────┬───────────────────────────┘
               │
               ├─ Success ──→ [Menu button refreshed on server]
               │               (client may still see cached version
               │                until app restart)
               │
               └─ Fail ──────→ [Log error, swallow]
                              (user can tap /menu again if needed)
```

### Recommended Project Structure

**No new file structure needed.**

UX-03 changes are all within `src/onboarding/ai-owner-agent.ts` (tool schemas + executor cases) and `src/billing/tools.ts` (if name-lookup helper extracted).

ADMIN-05 changes are within `src/onboarding/ai-onboarding-agent.ts` (retry logic) and `src/telegram/handlers/admin-menu.ts` or `src/webhooks/telegram.ts` (re-assertion on `/menu` tap).

### Pattern 1: Name-Based Client Matching with Disambiguation

**What:** Convert `client_phone` parameter to `client_name` parameter in 4 LLM-facing tools. Matching is case-insensitive substring; when 2+ clients match a name, return the match list as plain text in the tool result, let Gemini ask the owner to be more specific, and re-call on the owner's clarifying message.

**When to use:** Any LLM-facing tool that currently requires a raw Telegram ID or phone number to identify a client. The UX-03 scope covers exactly these 4 tools; similar patterns could apply to other tools in later phases.

**Example Implementation:**

```typescript
// From ai-owner-agent.ts, tool schema change:
// BEFORE:
{
  name: 'view_client_membership',
  parameters: {
    properties: {
      client_phone: { type: 'string', description: 'Telegram ID ή τηλέφωνο πελάτη' }
    }
  }
}

// AFTER (D-02 lock):
{
  name: 'view_client_membership',
  parameters: {
    properties: {
      client_name: { type: 'string', description: 'Όνομα πελάτη (αρκεί μερικό ταίριασμα)' }
    }
  }
}

// From ai-owner-agent.ts, executor case change:
// BEFORE (line 739-745):
case 'view_client_membership': {
  const clientPhone = String(args.client_phone ?? '');
  return withBusinessContext(business.id, () =>
    handleViewClientMembership(business.id, clientPhone)
  );
}

// AFTER (with disambiguation per D-04):
case 'view_client_membership': {
  const clientName = String(args.client_name ?? '').trim();
  if (!clientName) return 'Δεν δόθηκε όνομα πελάτη.';
  
  // Reuse existing pattern found at ai-owner-agent.ts:621,644,723,775
  const allClients = await getAllClientsForBusiness(business.id);
  const matches = allClients.filter(c =>
    c.clientName?.toLowerCase().includes(clientName.toLowerCase())
  );
  
  // D-03 lock: generic response, no special-case hints
  if (matches.length === 0) {
    return 'Δεν βρέθηκε πελάτης με αυτό το όνομα.';
  }
  
  // D-04 lock: text-based re-ask, D-05: names only
  if (matches.length > 1) {
    const names = matches.map(m => m.clientName || '(χωρίς όνομα)').join(', ');
    return `Πολλοί πελάτες ταιριάζουν: ${names}. Δώστε ένα πιο συγκεκριμένο όνομα.`;
  }
  
  // Single match: proceed with actual tool logic
  const clientPhone = matches[0].senderPhone;
  return withBusinessContext(business.id, () =>
    handleViewClientMembership(business.id, clientPhone)
  );
}
```

**Source:** [CONTEXT.md D-01–D-05 locked decisions]; pattern reuses existing case-insensitive substring-match predicate from ai-owner-agent.ts lines 621, 644, 723, 775 and getAllClientsForBusiness from src/billing/queries.ts:283–297.

### Pattern 2: Telegram Menu-Button Resilience with Client-Side Limitation Documentation

**What:** Implement D-06's code-level hedges (retry on failure + re-assertion on `/menu` tap) to mitigate the "one-shot call fired once in the business's entire lifetime, never repeated" gap. Document that the remaining unreliability (menu button not visible to some users) is a Telegram client-side caching behavior, unfixable at the app level.

**Why it matters:** Phase 24 set menu buttons correctly per Telegram Bot API docs, but real-world reliability is inconsistent. Research confirms the issue is Telegram mobile/desktop app client-side caching, not app code. D-06 hedges code-addressable gaps; the rest is documented as expected behavior.

**Example Implementation:**

```typescript
// src/onboarding/ai-onboarding-agent.ts, D-06.1 (finish_onboarding):
// BEFORE:
async function finish_onboarding(...) {
  try {
    await setChatMenuButton(ownerTelegramId, { type: 'default' });
    await setMyCommands([...], { scope: { type: 'all_private_chats' } });
  } catch (err) {
    logger.error('Menu button setup failed (silent swallow):', err);
  }
}

// AFTER (D-06.1 retry logic):
async function finish_onboarding(...) {
  const MAX_RETRIES = 3;
  const BACKOFF_MS = 500;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await setChatMenuButton(ownerTelegramId, { type: 'default' });
      await setMyCommands([...], { scope: { type: 'all_private_chats' } });
      return; // Success
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        logger.error(`Menu button setup failed after ${MAX_RETRIES} retries:`, err);
        return; // Idempotent-safe to continue without menu button
      }
      const delayMs = BACKOFF_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// src/telegram/handlers/admin-menu.ts (or src/webhooks/telegram.ts),
// D-06.2 (re-assertion on /menu tap):
case 'menu:root': {
  // ... existing /menu response logic (send menu message immediately) ...
  await sendTelegramMessage(ownerTelegramId, 'Εδώ είναι το μενού...');
  
  // D-06.2: best-effort re-assertion (fire and forget, swallow errors)
  // Idempotent-safe since these calls have no side effects beyond
  // updating Telegram's server-side state
  setImmediate(async () => {
    try {
      await setChatMenuButton(ownerTelegramId, { type: 'default' });
      await setMyCommands([...], { scope: { type: 'all_private_chats' } });
    } catch (err) {
      logger.warn('Menu button re-assertion failed (non-blocking):', err);
    }
  });
  
  return '';
}
```

**Source:** Telegram Bot API documentation (core.telegram.org); community issue reports indicating client-side cache delays and app restart as workaround (GitHub issues from yagop/node-telegram-bot-api, python-telegram-bot, etc.).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client name string matching | Custom fuzzy match algorithm | Case-insensitive substring `.includes()` (reuse from ai-owner-agent.ts existing pattern) | REQUIREMENTS.md explicitly rejects fuse.js; substring match is the locked approach. Edge cases (Γιώργος vs γιώργος) are handled by `.toLowerCase()`. |
| Retry backoff for API failures | Custom exponential backoff implementation | Simple `Math.pow(2, attempt - 1)` + `setTimeout` | No external lib needed; exponential backoff is a one-liner. Covers 99% of temporary network blips. |
| Text parsing for disambiguation matches | New stateful flow (button callbacks) | Plain-text match list in tool result + Gemini re-ask | Stateless approach reuses Phase 21 architecture. No new callback_data namespace needed. Owner simply replies with clarification. |
| Client-side Telegram cache invalidation | Periodically re-calling `setChatMenuButton` | Accept client-side caching as a documented limitation | Telegram API calls are idempotent and server-persistent. Periodic re-calling wastes bandwidth and provides zero reliability gain over the documented behavior. User restarts their app to clear cache. |

**Key insight:** The most deceptively complex problems in this phase are actually solved by the existing codebase's reusable patterns (substring matching from ai-owner-agent.ts) and by accepting platform limitations (Telegram client-side caching is not app-fixable). Over-engineering (fuzzy matching, stateful flows, periodic polling) adds complexity without solving the real constraint.

## Runtime State Inventory

**Not applicable.** This is not a rename/refactor/migration phase. No runtime state needs to be migrated or re-registered.

## Common Pitfalls

### Pitfall 1: Assuming All Clients Have a clientName On File

**What goes wrong:** A naive implementation that skips the zero-match branch and tries to call `handleViewClientMembership` with a null/empty `clientName`, causing a database query to silently return no results and the owner seeing a confusing "no membership found" instead of "no client found."

**Why it happens:** D-02 locks in the fact that `clientName` is nullable and only populated when a client sends at least one message. New clients who haven't messaged yet are unreachable by these 4 tools. The code must explicitly check for zero matches and return the generic error (D-03).

**How to avoid:** Always filter the client list and check `matches.length` before proceeding. If `matches.length === 0`, return the D-03 generic error immediately. Never attempt a database lookup on an empty/null client identifier.

**Warning signs:** Owner reports "I can't find my client by name, even though they're in my list" — likely they haven't messaged the bot yet, so `clientName` is null and doesn't match any substring.

### Pitfall 2: Confusing Telegram's Server-Side Persistence with Client-Side Cache

**What goes wrong:** Developer assumes `setChatMenuButton` is unreliable at the API level (e.g., "the call didn't take, I need to re-call it more frequently") and implements periodic polling, only to discover polling doesn't help because the unreliability is the mobile app caching old settings until the user restarts the app.

**Why it happens:** ADMIN-05 research found that Telegram's servers *do* persist the menu button indefinitely once set. The unreliability in the real world is that the Telegram mobile app caches the old menu button and doesn't refresh it when the server-side setting changes. This is a client-side issue, not a server-side issue.

**How to avoid:** Trust that `setChatMenuButton` persists server-side. D-06.1's retry logic is for transient network failures, not server-side cache invalidation. D-06.2's re-assertion on `/menu` tap is a "just in case" idempotent-safe hedge, not a workaround for an unreliable API. Document the client-side caching behavior to set user expectations.

**Warning signs:** Owner sees the menu button for themselves but another user doesn't, even after the owner has explicitly asked them to verify. This is classic client-side cache — the user needs to restart their Telegram app.

### Pitfall 3: Making Name Matching Case-Sensitive or Whitespace-Sensitive

**What goes wrong:** Substring match is implemented as `clientName.includes(needle)` (case-sensitive), and the owner types "Γιώργος" (capital Γ) while `clientName` is stored as "γιώργος" (lowercase γ from Telegram's `from.first_name`). No match, owner gets confused.

**Why it happens:** The existing pattern in ai-owner-agent.ts (lines 621, 644, 723, 775) already uses `.toLowerCase().includes()` to handle this. If a new implementation omits the `.toLowerCase()`, it breaks the expected UX.

**How to avoid:** Always call `.toLowerCase().includes()` on both sides. Also strip whitespace from the needle (e.g., `.trim()`) in case the owner types extra spaces.

**Warning signs:** Owner tries "Γιώργος" but the bot says "no client found", then they try "γιώργος" (lowercase) and it works — suggests case-sensitivity bug.

### Pitfall 4: Including Raw Telegram ID/Phone in Disambiguation Response

**What goes wrong:** When returning the 2+ name matches per D-04, the response includes both the name and the raw Telegram ID: "Matches: Γιώργος (123456789), Γιώργος (987654321)". This violates D-05 (names only) and exposes implementation details.

**Why it happens:** Developer might think including the ID helps the owner distinguish between clients, but D-05 explicitly locks out this approach in favor of showing names + optional last-booking-date context for tie-breaking.

**How to avoid:** Return only the names in the disambiguation list. If last-booking-date is included (per D-05 discretion), format as "Γιώργος (last booked: 2026-07-20)" not "Γιώργος (ID: 123456789)".

**Warning signs:** Code contains `matches.map(m => \`${m.clientName} (${m.senderPhone})\`)` — phone number should not appear.

### Pitfall 5: Forgetting to Update Tool Descriptions to Remove "Telegram ID" Language

**What goes wrong:** The 4 tools' descriptions in the schema still say "Τηλέφωνο ή Telegram ID" (D-02 lock's "OR" is no longer true), confusing the owner about what they should actually type. Gemini sees the old description and might prompt the owner for a phone number instead of a name.

**Why it happens:** The parameter name changes from `client_phone` to `client_name`, but the description text is a separate field and easy to overlook during refactoring.

**How to avoid:** Update the `description` field in the tool schema for all 4 tools. Change "Τηλέφωνο ή Telegram ID" to something like "Όνομα πελάτη (αρκεί μερικό ταίριασμα)" to match the new parameter semantics.

**Warning signs:** Gemini's prompt to the owner still asks for a phone/ID instead of a name — check the tool schema description in ai-owner-agent.ts.

## Code Examples

### Verified Pattern: Case-Insensitive Name Substring Matching (Existing, Reused)

```typescript
// Source: ai-owner-agent.ts lines 621, 644, 723, 775 (verified 2026-07-29)
// Used for service name matching; exact same pattern reused for client names per UX-03.

const needle = 'μαθηματα'; // owner input
const serviceList = [
  { id: 1, name: 'Pilates Μαθήματα' },
  { id: 2, name: 'Yoga Classes' },
  { id: 3, name: 'ΜΑΘΗΜΑΤΑ Ζουμπα' }
];

const matches = serviceList.filter(s =>
  s.name.toLowerCase().includes(needle.toLowerCase())
);
// Result: services 1 and 3 match (case-insensitive, partial)
```

### Verified Query: getAllClientsForBusiness (Existing, Base for UX-03)

```typescript
// Source: src/billing/queries.ts:283–297 (verified 2026-07-29)
// Returns all clients for a business with name field; used for filtering in UX-03.

import { getAllClientsForBusiness } from '../billing/queries';

const businessId = 42;
const allClients = await getAllClientsForBusiness(businessId);
// Result: [
//   { clientBusinessRelationshipId: 1, clientName: 'Γιώργος', senderPhone: '123456789' },
//   { clientBusinessRelationshipId: 2, clientName: null, senderPhone: '987654321' },
//   { clientBusinessRelationshipId: 3, clientName: 'Γιώργος', senderPhone: '456789123' }
// ]

// Filter for UX-03:
const needle = 'γιώργος';
const matches = allClients.filter(c =>
  c.clientName?.toLowerCase().includes(needle.toLowerCase())
);
// Result: clients 1 and 3 (client 2 with null name skipped)
```

### Telegram Menu Button Idempotence (Documented Behavior)

```typescript
// Source: Telegram Bot API documentation (core.telegram.org/bots/api#setchatmenubutton)
// setChatMenuButton is idempotent — calling it twice with the same arguments
// has the same effect as calling it once. Safe for D-06.2's re-assertion.

// Call 1 (during onboarding):
await setChatMenuButton(ownerTelegramId, { type: 'default' });

// Call N (on every /menu tap, per D-06.2):
await setChatMenuButton(ownerTelegramId, { type: 'default' });

// Result: No duplicate side effects; server state unchanged on re-call.
// Client-side cache may persist old button until user restarts app.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Telegram ID-based client lookup | Name-based client lookup with disambiguation | Phase 30 (this phase) | Improves owner UX; no longer requires copying raw IDs. Requires clients to message bot at least once. |
| One-shot menu-button call at onboarding only | Retry on failure + re-assert on `/menu` tap (D-06) | Phase 30 (this phase) | Hedges against transient failures during onboarding. Re-assertion is best-effort, doesn't block. Client-side caching behavior remains as-is (user must restart app to see updates). |

**Deprecated/outdated:**
- None. Telegram Bot API's `setChatMenuButton` and `setMyCommands` are current as of 2026-07.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getAllClientsForBusiness` returns rows with `clientName` that may be null | Code Examples | If the query is changed to exclude null names, UX-03 implementation will silently fail to find clients with no name on file — no error, just "no client found". Always verify query shape. |
| A2 | Substring matching with `.toLowerCase().includes()` is sufficient for Greek name matching (no diacritics normalization needed) | Pattern 1 | If Greek character normalization becomes required (e.g., matching "Γιώργος" against "Γιώρgyος" with typos), current approach will fail. Verify against real owner usage data. |
| A3 | Telegram's `setChatMenuButton` persists indefinitely on the server once set | Pattern 2, Pitfall 2 | If Telegram's API actually expires menu buttons after N days or resets them on certain events, D-06's re-assertion strategy alone won't be sufficient. This is verified via official docs + community reports; low risk. |
| A4 | Client-side Telegram app cache is the root cause of menu-button unreliability, not app code | ADMIN-05 research findings | If the real issue is a bug in our own bot logic, periodic menu-button re-calls might hide the underlying bug and make debugging harder later. Research strongly suggests client-side issue, but real-world testing with a live business will confirm. |

**If this table is empty:** All claims in this research were verified (codebase references, Telegram official docs, community reports) or cited from CONTEXT.md's locked decisions — no user confirmation needed before proceeding.

## Open Questions

1. **Should disambiguation text include last-booking-date for tie-breaking identical names?**
   - What we know: D-05 allows "last-booking-date or other name-adjacent context" at Claude's discretion; existing pattern for Greek-language client lists exists in `showClientSelection`
   - What's unclear: UX tradeoff between simpler "just names" vs. richer "names + dates" for same-named clients
   - Recommendation: Start with name-only (simplest), add last-booking-date in a future iteration if owners report ambiguity issues with identical names

2. **Exact retry count and backoff shape for D-06.1?**
   - What we know: Exponential backoff (500ms → 1s → 2s) is standard; 3–5 attempts should cover transient network hiccups
   - What's unclear: Optimal counts for Telegram's infrastructure; risk of retry storms vs. giving up too early
   - Recommendation: Start with 3 attempts, 500ms base backoff, exponential. Test against Telegram API rate limits. Adjust if needed based on production logs.

3. **Where exactly to wire D-06.2's re-assertion on /menu tap?**
   - What we know: Owner taps `/menu` button in both text-command form and callback form; re-assertion must not block the menu response
   - What's unclear: Exact call site (inside the `/menu` text handler vs. the `menu:root` callback handler vs. both)
   - Recommendation: Implement in the callback handler (`menu:root`) first; use `setImmediate(async () => { ... })` to fire after the response. Add text-command handler if testing shows it's needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Telegram Bot API (core.telegram.org) | D-06 implementation (setChatMenuButton, setMyCommands calls) | ✓ | Current | — |
| PostgreSQL / Neon (for client lookup) | UX-03 implementation (getAllClientsForBusiness query) | ✓ | 15+ | — |
| Drizzle ORM (existing) | UX-03 implementation (RLS-scoped reads) | ✓ | 0.30+ | — |
| Gemini API (existing) | UX-03 implementation (tool-calling + re-ask loop) | ✓ | 2.10.0+ | — |

**Missing dependencies with no fallback:** None. All dependencies for both UX-03 and ADMIN-05 are already in the stack.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.x + Supertest (existing) |
| Config file | jest.config.js (root) |
| Quick run command | `npx jest --testPathPattern="ai-owner.*client.*" -x` (covers UX-03 client name matching) |
| Full suite command | `npx jest` (full test suite) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UX-03 | Name-based client lookup with single exact match | Unit/Integration | `npx jest --testPathPattern="ai-owner.*name.*match" -x` | ✅ Wave 0 (new) |
| UX-03 | Disambiguation: 2+ name matches return list; owner re-asks with narrower name | Integration | `npx jest --testPathPattern="ai-owner.*disambiguation" -x` | ✅ Wave 0 (new) |
| UX-03 | Zero-match case: returns generic error (no special hints about first-message gate) | Unit | `npx jest --testPathPattern="ai-owner.*zero.*match" -x` | ✅ Wave 0 (new) |
| UX-03 | All 4 tools (view_client_membership, assign_client_to_session, send_renewal_reminder, list_slotless_requests) accept name param, not client_phone | Unit/Mutation | `npx jest --testPathPattern="ai-owner" -x` | ✅ Existing (refactored) |
| UX-03 | Substring matching is case-insensitive (γιώργος matches Γιώργος) | Unit | `npx jest --testPathPattern="name.*case.*insensitive" -x` | ✅ Wave 0 (new) |
| ADMIN-05 | D-06.1: Retry logic on setChatMenuButton failure (3 attempts, exponential backoff) | Unit | `npx jest --testPathPattern="menu.*button.*retry" -x` | ✅ Wave 0 (new) |
| ADMIN-05 | D-06.2: Re-assertion on /menu tap fires without blocking response | Integration | `npx jest --testPathPattern="menu.*re.*assert" -x` | ✅ Wave 0 (new) |
| ADMIN-05 | Idempotent re-calls don't create duplicate side effects | Unit (Telegram API mock) | `npx jest --testPathPattern="menu.*idempotent" -x` | ✅ Wave 0 (new) |

### Sampling Rate

- **Per task commit (UX-03 tools):** `npx jest --testPathPattern="ai-owner" -x`
- **Per task commit (ADMIN-05 retry/re-assertion):** `npx jest --testPathPattern="menu.*button" -x`
- **Per wave merge:** `npx jest` (full suite)
- **Phase gate:** Full suite green + manual verification: owner can find client by name in all 4 tools, /menu button appears after onboarding, re-appears after /menu tap

### Wave 0 Gaps

- [ ] `tests/ai-owner-name-matching.test.ts` — covers UX-03 name-based lookup for all 4 tools (view_client_membership, assign_client_to_session, send_renewal_reminder, list_slotless_requests). Test cases: single match, 2+ matches (disambiguation), zero matches, case-insensitive, whitespace handling.
- [ ] `tests/ai-owner-disambiguation.test.ts` — covers D-04 text-based re-ask flow. Test cases: owner re-calls with narrower name after receiving match list, narrowed name resolves to single client.
- [ ] `tests/menu-button-reliability.test.ts` — covers ADMIN-05 D-06.1 retry logic and D-06.2 re-assertion. Test cases: setChatMenuButton fails, retry succeeds; setMyCommands fails on all retries (idempotent swallow); re-assertion on /menu tap doesn't block response.
- [ ] Mock Telegram API responses for retry/re-assertion tests (use existing telegram-client.test.ts patterns if available; else new mocks for setChatMenuButton/setMyCommands).

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

**Gaps noted:**
- Existing ai-owner-confirmation-policy.test.ts covers some tools but not the 4 UX-03 tools explicitly. Must add dedicated tests for name-based matching, disambiguation, and zero-match cases.
- Existing menu-button setup (Phase 24) has no test coverage for retry logic or re-assertion. Must add.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A (no new auth changes) |
| V3 Session Management | No | N/A |
| V4 Access Control | Yes | `withBusinessContext()` RLS enforcement for client lookup (existing pattern). UX-03 name filtering must query only the owner's own business clients, never cross-business. |
| V5 Input Validation | Yes | Name param is a string; validate non-empty, max length (e.g., 100 chars) to prevent DoS via huge names. Zod schema validation already in place for all tool params. |
| V6 Cryptography | No | N/A (no new encryption/signing) |

### Known Threat Patterns for {Telegram Bot + Gemini Agents}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Owner sends name that is not their client (e.g., a competitor's client name) | Elevation of Privilege | `withBusinessContext()` RLS in `getAllClientsForBusiness` ensures owner only sees their own business's clients. Cannot enumerate other business's client names. |
| Owner sends extremely long name string (e.g., 10MB) | Denial of Service | Validate max length on name param (e.g., 100 chars). Zod schema should enforce this. |
| Telegram client-side menu button not visible due to old app version | Information Disclosure / Availability | Not fixable app-side; document as expected behavior. Suggest owner update Telegram app or use /menu text command as fallback. |

## Sources

### Primary (HIGH confidence — official documentation or codebase-verified)

- **Telegram Bot API official documentation (core.telegram.org)** — Verified `setChatMenuButton`, `setMyCommands`, and scope behaviors
  - [setChatMenuButton method](https://core.telegram.org/bots/api#setchatmenubutton)
  - [setMyCommands method](https://core.telegram.org/bots/api#setmycommands)
  - [BotCommandScope types](https://core.telegram.org/type/BotCommandScope)
  
- **RandevuClaw codebase (verified 2026-07-29)** — File:line references for all 4 UX-03 tools
  - `src/onboarding/ai-owner-agent.ts` lines 245–259 (view_client_membership schema), 739–745 (executor)
  - `src/onboarding/ai-owner-agent.ts` lines 362–383 (assign_client_to_session schema), 849–881 (executor)
  - `src/onboarding/ai-owner-agent.ts` lines 384–398 (list_slotless_requests schema), 883–892 (executor)
  - `src/onboarding/ai-owner-agent.ts` lines 412–423 (send_renewal_reminder schema), 900–911 (executor)
  - `src/billing/queries.ts` lines 283–297 (getAllClientsForBusiness)
  - `src/database/schema.ts` line 105 (clientName field, nullable)

- **CONTEXT.md** — Phase 30 locked decisions D-01 through D-06; folded todo with exact research questions

### Secondary (MEDIUM confidence — community reports + official docs)

- [GitHub issue: setChatMenuButton not working (yagop/node-telegram-bot-api #995)](https://github.com/yagop/node-telegram-bot-api/issues/995) — Confirms client-side cache delay and app-restart workaround
- [GitHub discussion: set_chat_menu_button not appearing (python-telegram-bot #3938)](https://github.com/python-telegram-bot/python-telegram-bot/discussions/3938) — Confirms menu button caching behavior across client versions
- [Telegram Bot Features documentation](https://core.telegram.org/bots/features) — Describes menu button functionality and scope restrictions (private chats only)
- [Bot buttons documentation (core.telegram.org)](https://core.telegram.org/api/bots/buttons) — Describes reply keyboards vs. menu button tradeoffs

### Tertiary (LOW confidence — training knowledge, not verified in session)

- None. All ADMIN-05 findings are from official docs or community reports with HIGH/MEDIUM confidence.

## Metadata

**Confidence breakdown:**
- **Standard stack (UX-03):** HIGH — Codebase references verified (lines matched), existing patterns confirmed, Drizzle + Gemini already in stack
- **Architecture (both halves):** HIGH — UX-03 reuses Phase 21 stateless agent + existing substring-match patterns; ADMIN-05 aligns with D-06 locked decisions
- **Pitfalls:** HIGH — Drawn from codebase conventions (RLS pattern, null handling) and Telegram API documentation
- **ADMIN-05 research:** HIGH — Telegram official docs + community issues confirm client-side caching behavior; no app-code fix exists beyond D-06's hedge

**Research date:** 2026-07-29
**Valid until:** 2026-08-05 (7 days for potentially fast-moving Telegram API changes; Drizzle/Gemini stack is stable longer)

---

*Phase 30: Client Identification & Menu Reliability*
*Research completed: 2026-07-29*
