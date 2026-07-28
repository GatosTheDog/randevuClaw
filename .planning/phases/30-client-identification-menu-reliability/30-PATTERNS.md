# Phase 30: Client Identification & Menu Reliability - Pattern Map

**Mapped:** 2026-07-29
**Files analyzed:** 6 (3 modified existing files + 3 new test files)
**Analogs found:** 5/6 (existing code patterns reused; tests are new infrastructure)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/onboarding/ai-owner-agent.ts` | controller (Gemini tool handler) | request-response (tool-calling) | `src/onboarding/ai-owner-agent.ts` (self) | exact — same file, 4 tool schemas + executors to refactor |
| `src/onboarding/ai-onboarding-agent.ts` | controller (Gemini agent) | request-response + error handling | `src/onboarding/ai-onboarding-agent.ts` (self) | exact — same file, finish_onboarding function to enhance |
| `src/telegram/handlers/admin-menu.ts` | middleware (webhook callback handler) | request-response (Telegram callback) | `src/telegram/handlers/admin-menu.ts` (self) | exact — same file, add re-assertion logic to showAdminRootMenu case or menu:root branch |
| `tests/ai-owner-name-matching.test.ts` | test | N/A | `tests/billing-view-membership.test.ts` | structural match — Jest + withBusinessContext + test fixtures pattern |
| `tests/ai-owner-disambiguation.test.ts` | test | N/A | `tests/billing-view-membership.test.ts` | structural match — integration test with multi-turn Gemini agent |
| `tests/menu-button-reliability.test.ts` | test | N/A | `tests/telegram-client.test.ts` | structural match — mock Telegram API responses + error handling |

## Pattern Assignments

### `src/onboarding/ai-owner-agent.ts` (controller, request-response)

**Analog:** Same file — already contains all 4 tool schemas and executors to refactor

**Tool schema pattern** (lines 245-259, view_client_membership example):
```typescript
{
  type: 'function' as const,
  name: 'view_client_membership',
  description:
    'Εμφανίζει την ενεργή συνδρομή ενός πελάτη — υπόλοιπο συνεδριών και ημερομηνία λήξης.',
  parameters: {
    type: 'object',
    properties: {
      client_phone: {
        type: 'string',
        description: 'Τηλέφωνο ή Telegram ID του πελάτη',
      },
    },
    required: ['client_phone'],
  },
},
```

**Tool executor pattern** (lines 739-745, view_client_membership executor before refactor):
```typescript
case 'view_client_membership': {
  const clientPhone = String(args.client_phone ?? '');
  // Wrap in withBusinessContext so RLS enforcement applies (T-07-03)
  return withBusinessContext(business.id, () =>
    handleViewClientMembership(business.id, clientPhone)
  );
}
```

**Name-match pattern reused from existing code** (lines 621, 644, 723, 775 — service name matching):
```typescript
// From line 774-775 (create_recurring_session case):
const matchedService = svcList.find((s) =>
  s.name.toLowerCase().includes(svcNameArg.toLowerCase())
);
if (!matchedService) {
  return `Δεν βρέθηκε υπηρεσία με όνομα "${svcNameArg}".`;
}
```

**After UX-03 refactor (D-02, D-04, D-05 implementation):**
```typescript
// 1. Schema change: replace client_phone param with client_name
{
  type: 'function' as const,
  name: 'view_client_membership',
  description: 'Εμφανίζει την ενεργή συνδρομή ενός πελάτη.',
  parameters: {
    type: 'object',
    properties: {
      client_name: {
        type: 'string',
        description: 'Όνομα πελάτη (αρκεί μερικό ταίριασμα)',
      },
    },
    required: ['client_name'],
  },
}

// 2. Executor case: replace exact ID match with name-based disambiguation
case 'view_client_membership': {
  const clientName = String(args.client_name ?? '').trim();
  if (!clientName) return 'Δεν δόθηκε όνομα πελάτη.';
  
  // Fetch all clients for the business (RLS-scoped via withBusinessContext)
  const allClients = await getAllClientsForBusiness(business.id);
  const matches = allClients.filter(c =>
    c.clientName?.toLowerCase().includes(clientName.toLowerCase())
  );
  
  // D-03: generic error for zero matches (no special hints about first-message gate)
  if (matches.length === 0) {
    return 'Δεν βρέθηκε πελάτης με αυτό το όνομα.';
  }
  
  // D-04/D-05: text-based disambiguation (names only, no IDs)
  if (matches.length > 1) {
    const names = matches.map(m => m.clientName || '(χωρίς όνομα)').join(', ');
    return `Πολλοί πελάτες ταιριάζουν: ${names}. Δώστε ένα πιο συγκεκριμένο όνομα.`;
  }
  
  // Exact match: proceed with single client
  const clientPhone = matches[0].senderPhone;
  return withBusinessContext(business.id, () =>
    handleViewClientMembership(business.id, clientPhone)
  );
}
```

**Import additions** (to verify at refactor time):
```typescript
// Existing imports (no new ones needed — getAllClientsForBusiness already in scope)
import { getAllClientsForBusiness } from '../billing/queries';
```

**Applies to all 4 tools:**
- `view_client_membership` (schema 245-259, executor 739-745)
- `assign_client_to_session` (schema 362-383, executor 849-881)
- `send_renewal_reminder` (schema 412-423, executor 900-911)
- `list_slotless_requests` (schema 384-398, executor 883-892)

---

### `src/onboarding/ai-onboarding-agent.ts` (controller, request-response + error handling)

**Analog:** Same file — contains finish_onboarding function at lines 600-616

**Before D-06.1 refactor** (lines 600-616):
```typescript
// BOT-06: best-effort menu/command registration. Wrapped in its own
// try/catch so a Telegram API hiccup here never blocks activateBusiness
// or the onboardingCompleted DB write below (T-24-04).
try {
  await setMyCommands(
    business.botToken!,
    [{ command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' }],
    { type: 'chat', chat_id: ownerTelegramId }
  );
  await setMyCommands(business.botToken!, [
    { command: 'start', description: 'Έναρξη κράτησης ραντεβού' },
  ], { type: 'all_private_chats' });
  await setChatMenuButton(business.botToken!, ownerTelegramId);
  await setChatMenuButton(business.botToken!);
} catch (err) {
  logger.error({ err, businessId: business.id }, 'finish_onboarding: menu/command registration failed');
}
```

**D-06.1 refactor (add retry with exponential backoff):**
```typescript
// D-06.1: Retry logic with exponential backoff (3-5 attempts)
// Replaces the silent single try/catch above
const MAX_RETRIES = 3;
const BACKOFF_MS = 500;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    await setMyCommands(
      business.botToken!,
      [{ command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' }],
      { type: 'chat', chat_id: ownerTelegramId }
    );
    await setMyCommands(business.botToken!, [
      { command: 'start', description: 'Έναρξη κράτησης ραντεβού' },
    ], { type: 'all_private_chats' });
    await setChatMenuButton(business.botToken!, ownerTelegramId);
    await setChatMenuButton(business.botToken!);
    return; // Success
  } catch (err) {
    if (attempt === MAX_RETRIES) {
      logger.error(
        { err, businessId: business.id, attemptsExhausted: MAX_RETRIES },
        'finish_onboarding: menu/command registration failed after retries'
      );
      return; // Idempotent-safe to continue without menu button
    }
    const delayMs = BACKOFF_MS * Math.pow(2, attempt - 1);
    await new Promise(r => setTimeout(r, delayMs));
  }
}
```

**Import additions needed:**
```typescript
// Already imported at top of file:
import { setChatMenuButton, setMyCommands } from '../telegram/client';
// No new imports needed for D-06.1 (uses built-in setTimeout + Math.pow)
```

---

### `src/telegram/handlers/admin-menu.ts` (middleware, request-response)

**Analog:** Same file — contains menu callback dispatch at lines 557-702, particularly the `root` case at line 566-568

**Existing /menu handler pattern** (lines 566-568):
```typescript
case menuAction === 'root':
  await showAdminRootMenu(chatId, business);
  break;
```

**D-06.2 refactor (add re-assertion on /menu tap — best-effort, non-blocking):**
```typescript
// Add re-assertion after showAdminRootMenu returns (non-blocking)
case menuAction === 'root':
  await showAdminRootMenu(chatId, business);
  
  // D-06.2: best-effort re-assertion of menu button
  // Fire and forget via setImmediate; does not block the /menu response
  setImmediate(async () => {
    try {
      await setChatMenuButton(business.botToken!, chatId);
      await setMyCommands(
        business.botToken!,
        [{ command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' }],
        { type: 'chat', chat_id: chatId }
      );
      logger.debug({ chatId }, 'Menu button re-assertion succeeded');
    } catch (err) {
      logger.warn(
        { err, chatId },
        'Menu button re-assertion failed (non-blocking, idempotent-safe)'
      );
    }
  });
  break;
```

**Alternative wiring (text-command `/menu`)** — if Claude's discretion places re-assertion in both text + callback:

Check `src/webhooks/telegram.ts` for the `/menu` text-command handler branch and apply the same `setImmediate(async () => { ... })` pattern after sending the menu message.

**Import additions needed:**
```typescript
// Add to existing imports at top of admin-menu.ts:
import { setChatMenuButton, setMyCommands } from '../client';
```

---

## Shared Patterns

### Name-Based Client Matching (All 4 UX-03 Tools)

**Source:** `src/onboarding/ai-owner-agent.ts` lines 621, 644, 723, 775 (existing service-name matching pattern) + `src/billing/queries.ts` lines 283-297 (getAllClientsForBusiness query)

**Apply to:** All 4 tool executors in ai-owner-agent.ts that currently use `client_phone` param

**Concrete pattern (case-insensitive substring match):**
```typescript
const needle = 'γιώργος'; // owner input
const allClients = await getAllClientsForBusiness(business.id);
const matches = allClients.filter(c =>
  c.clientName?.toLowerCase().includes(needle.toLowerCase())
);

// Result type (from src/billing/queries.ts lines 267-272):
// AllTimeClient = {
//   clientBusinessRelationshipId: number;
//   clientName: string | null;  ← nullable, per D-02
//   senderPhone: string;         ← raw Telegram ID
// }
```

### Retry Pattern with Exponential Backoff

**Source:** Built-in JavaScript `setTimeout` + `Math.pow` (no external library)

**Apply to:** D-06.1 in ai-onboarding-agent.ts finish_onboarding

**Concrete pattern:**
```typescript
const MAX_RETRIES = 3;
const BACKOFF_MS = 500;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    // API call here
    await someApiCall(...);
    return; // Success
  } catch (err) {
    if (attempt === MAX_RETRIES) {
      logger.error({ err }, 'Exhausted retries');
      return; // Idempotent-safe
    }
    const delayMs = BACKOFF_MS * Math.pow(2, attempt - 1);
    // Delays: 500ms → 1000ms → 2000ms
    await new Promise(r => setTimeout(r, delayMs));
  }
}
```

### Non-Blocking Background Task (D-06.2 Re-assertion)

**Source:** Built-in `setImmediate` (fire-and-forget async task, does not block webhook response)

**Apply to:** D-06.2 in admin-menu.ts menu:root handler

**Concrete pattern:**
```typescript
// Send synchronous response first
await sendTelegramMessage(chatId, '...');

// Fire best-effort re-assertion in background, swallow errors
setImmediate(async () => {
  try {
    await someIdempotentApiCall(...);
  } catch (err) {
    logger.warn({ err }, 'Non-blocking task failed (safe to ignore)');
  }
});

// Webhook response returns immediately (does not wait for setImmediate)
```

### RLS-Scoped Client Lookup

**Source:** `src/onboarding/ai-owner-agent.ts` lines 755-757 and throughout (withBusinessContext pattern) + `src/billing/queries.ts` lines 283-297 (getAllClientsForBusiness)

**Apply to:** All 4 tool executors when filtering clients by name

**Concrete pattern:**
```typescript
// ALWAYS wrap the client lookup in withBusinessContext for RLS enforcement
const allClients = await withBusinessContext(business.id, () =>
  getAllClientsForBusiness(business.id)
);

// This ensures clients from OTHER businesses are never visible,
// even if the owner somehow crafted a name that would match across tenants.
```

---

## Test File Patterns

### `tests/ai-owner-name-matching.test.ts` (new, UX-03 coverage)

**Analog:** `tests/billing-view-membership.test.ts` (lines 1-100)

**Test structure pattern:**
```typescript
// 1. Setup database override (TEST_DATABASE_URL)
const TEST_DATABASE_URL = 'postgresql://manolis@localhost:5432/randevuclaw_test';
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

// 2. Import test helpers and code under test
const { withBusinessContext } = require('../src/database/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestClient } = require('./helpers/billing-fixtures'); // new, add as needed

// 3. Restore DATABASE_URL after all tests
afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

// 4. Test cases covering:
//    - Single name match (exact success path)
//    - 2+ name matches (disambiguation list returned)
//    - Zero matches (generic error)
//    - Case-insensitive matching (γιώργος vs Γιώργος)
//    - Whitespace handling (.trim())
describe('ai-owner: view_client_membership with name matching', () => {
  let businessId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
  });

  it('returns single match when name uniquely identifies one client', async () => {
    const clientPhone = `test-single-${Date.now()}`;
    await insertTestClient(businessId, { 
      senderPhone: clientPhone, 
      clientName: 'Γιώργος' 
    });

    const result = await withBusinessContext(businessId, () =>
      executeOwnerTool(business, 'view_client_membership', { client_name: 'γιώργος' })
    );

    expect(result).toContain('συνδρομή'); // Contains membership info
  });

  it('returns disambiguation list when 2+ clients match the name', async () => {
    const clientPhone1 = `test-multi-1-${Date.now()}`;
    const clientPhone2 = `test-multi-2-${Date.now()}`;
    await insertTestClient(businessId, { 
      senderPhone: clientPhone1, 
      clientName: 'Γιώργος' 
    });
    await insertTestClient(businessId, { 
      senderPhone: clientPhone2, 
      clientName: 'Γιώργος Παπαδόπουλος' 
    });

    const result = await withBusinessContext(businessId, () =>
      executeOwnerTool(business, 'view_client_membership', { client_name: 'γιώργος' })
    );

    expect(result).toContain('Πολλοί πελάτες ταιριάζουν');
    expect(result).toContain('Γιώργος');
  });

  it('returns generic error when zero matches found', async () => {
    const result = await withBusinessContext(businessId, () =>
      executeOwnerTool(business, 'view_client_membership', { client_name: 'Αλέξανδρος' })
    );

    expect(result).toContain('Δεν βρέθηκε πελάτης');
  });
});
```

**Key test cases for all 4 tools (view_client_membership, assign_client_to_session, send_renewal_reminder, list_slotless_requests):**
- Single match → success path
- 2+ matches → disambiguation list
- Zero matches → generic error (no hints about first-message gate)
- Case insensitivity (γ vs Γ)
- Whitespace tolerance

---

### `tests/ai-owner-disambiguation.test.ts` (new, D-04 re-ask flow)

**Analog:** `tests/onboarding-flow.test.ts` or similar multi-turn Gemini agent test (search for existing Gemini conversation tests)

**Test structure pattern (integration test with multi-turn agent):**
```typescript
// Multi-turn Gemini agent test (D-04 text-based re-ask)
describe('ai-owner: name-based disambiguation re-ask flow', () => {
  let businessId: number;
  let ownerTelegramId: string;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    ownerTelegramId = business.ownerTelegramId;

    // Setup: 2 clients with same name
    await insertTestClient(businessId, { 
      senderPhone: '111111', 
      clientName: 'Γιώργος' 
    });
    await insertTestClient(businessId, { 
      senderPhone: '222222', 
      clientName: 'Γιώργος Παπαδόπουλος' 
    });
  });

  it('narrates ambiguity and re-asks when owner says view_client_membership for γιώργος', async () => {
    // Turn 1: owner says "Show membership for Γιώργος"
    const response1 = await aiOwnerAgent(
      business,
      ownerTelegramId,
      'Δες τη συνδρομή του Γιώργου',
      isoDateInAthens()
    );

    // Gemini sees the disambiguation list from the tool and narrates it
    expect(response1).toContain('περισσότερος ένας Γιώργος');
    // Gemini asks the owner to be more specific

    // Turn 2: owner clarifies with fuller name
    const response2 = await aiOwnerAgent(
      business,
      ownerTelegramId,
      'Γιώργος Παπαδόπουλος',
      isoDateInAthens()
    );

    // Now the tool sees a single match and proceeds
    expect(response2).toContain('συνδρομή'); // Membership info
    expect(response2).not.toContain('περισσότερος ένας');
  });
});
```

**Test focus:**
- Multi-turn Gemini conversation (D-04: Gemini narrates ambiguity and re-asks)
- Tool result is "Πολλοί πελάτες ταιριάζουν: ..." (plain text, no IDs per D-05)
- Gemini's follow-up prompt to the owner is in Greek and asks for clarification
- Owner's next message triggers the same tool with narrower name
- Second call now sees single match and proceeds

---

### `tests/menu-button-reliability.test.ts` (new, ADMIN-05/D-06 coverage)

**Analog:** `tests/telegram-client.test.ts` (mock Telegram API responses + error scenarios)

**Test structure pattern (mock Telegram API):**
```typescript
// Unit test with mocked Telegram API (test retry + re-assertion logic)
describe('menu button reliability: D-06 retry + re-assertion', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    // Mock global fetch to simulate Telegram API responses
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  describe('D-06.1: retry on failure', () => {
    it('succeeds on first attempt if API responds immediately', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
      );

      await setChatMenuButton('test-token', '123456');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds on second attempt if first fails', async () => {
      // First attempt fails (transient error)
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Timeout' }), { status: 500 })
      );
      // Second attempt succeeds
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
      );

      // Call the retry wrapper (from ai-onboarding-agent.ts)
      const result = await retryMenuButtonSetup({
        botToken: 'test-token',
        ownerTelegramId: '123456',
        maxRetries: 3,
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Retried once
    });

    it('gives up after max retries and logs error', async () => {
      // All attempts fail
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: false, description: 'API down' }), { status: 503 })
      );

      const result = await retryMenuButtonSetup({
        botToken: 'test-token',
        ownerTelegramId: '123456',
        maxRetries: 3,
      });

      expect(result.success).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Tried all 3 times
    });
  });

  describe('D-06.2: re-assertion on /menu tap (idempotent)', () => {
    it('fires menu button re-assertion without blocking response', async () => {
      const mockSetImmediate = jest.fn((fn) => fn());
      const mockSendMessage = jest.fn().mockResolvedValue({ messageId: 1 });

      // Simulate admin-menu.ts menu:root handler
      await showAdminRootMenu('123456', business);
      
      // Re-assertion fires in background (setImmediate)
      // Verify idempotency: calling setChatMenuButton twice with same args
      // produces no duplicate side effects (Telegram ignores second call)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('setChatMenuButton'),
        expect.anything()
      );
      // No error thrown despite being idempotent (same args as first call)
    });
  });

  describe('Telegram API mocking utilities', () => {
    // Helper function to mock success response
    function mockTelegramSuccess() {
      return {
        ok: true,
        result: true,
      };
    }

    // Helper function to mock failure response
    function mockTelegramFailure(description: string) {
      return {
        ok: false,
        description,
      };
    }
  });
});
```

**Test focus:**
- D-06.1: Retry logic attempts N times before giving up
- Exponential backoff timing: 500ms → 1000ms → 2000ms (verify with jest.useFakeTimers)
- D-06.2: Re-assertion fires non-blocking (via setImmediate) and swallows errors
- Idempotency: calling the same setChatMenuButton args twice has no side effects beyond the first
- Telegram API mock patterns (success vs failure responses)

---

## No Analog Found

None. All modifications are to existing files and test patterns follow established Jest + fixture patterns in the codebase.

---

## Metadata

**Analog search scope:** `src/onboarding/`, `src/telegram/`, `src/billing/`, `tests/`

**Files scanned:** 6 primary (ai-owner-agent.ts, ai-onboarding-agent.ts, admin-menu.ts, client.ts, billing/queries.ts, test examples)

**Pattern extraction date:** 2026-07-29

**Confidence:** HIGH
- All modifications are to existing files with clear patterns (tool schemas, executors, error handling)
- Retry pattern uses standard JS primitives (setTimeout, Math.pow)
- Non-blocking pattern uses setImmediate (built-in, no external deps)
- Test patterns follow established Jest + fixtures conventions in codebase
- Name-matching reuses existing case-insensitive substring predicate from same file (lines 621, 644, 723, 775)

