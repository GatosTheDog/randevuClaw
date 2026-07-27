# Phase 24: Bot Access & Diagnostics Polish - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 6 (2 modified source files + 2 modified webhook/service files + 2 new test files)
**Analogs found:** 6/6 ✓

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/telegram/client.ts` | service/utility | request-response (HTTP API) | `registerBotWebhook` (same file, lines 194–212) | exact |
| `src/onboarding/ai-onboarding-agent.ts` | service | request-response | `finish_onboarding` case (lines 568–609, same file) | exact |
| `src/conversation/ai-agent.ts` | service | error-handling | Error catch block (lines 396–422) + `botTokenStore.run` pattern | role-match |
| `src/webhooks/telegram.ts` | controller/webhook | request-response + error-handling | `handleFoundBusiness` catch (lines 159–180, same file) | exact |
| `tests/BOT-06.test.ts` | test | testing | `tests/function-executor.test.ts` (jest mocking pattern) | role-match |
| `tests/DIAG-01.test.ts` | test | testing | `tests/function-executor.test.ts` (jest mocking pattern) | role-match |

## Pattern Assignments

### `src/telegram/client.ts` (service/utility, request-response)

**Analog:** `src/telegram/client.ts` — lines 194–212 (`registerBotWebhook`, `unregisterBotWebhook`)

**Existing HTTP wrapper pattern** (lines 132–170):
```typescript
async function callTelegramApiDirect<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;

  const startedAt = Date.now();
  logger.debug({ method }, 'Calling Telegram API');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(
      { err, method, elapsedMs, timeoutMs: TELEGRAM_API_TIMEOUT_MS },
      'Telegram API fetch failed or timed out (direct)'
    );
    throw err;
  }

  const data = (await response.json()) as TelegramApiResponse<T>;
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error({ method, status: response.status, description, elapsedMs }, 'Telegram API call failed');
    throw new Error(description);
  }

  logger.debug({ method, elapsedMs }, 'Telegram API call succeeded (direct)');
  return data.result as T;
}
```

**Existing public wrapper functions** (lines 194–212):
```typescript
export async function registerBotWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string
): Promise<void> {
  await callTelegramApiDirect<boolean>(botToken, 'setWebhook', {
    url: webhookUrl,
    secret_token: secretToken,
  });
}

export async function unregisterBotWebhook(botToken: string): Promise<void> {
  await callTelegramApiDirect<boolean>(botToken, 'deleteWebhook', {});
}
```

**Pattern to replicate for BOT-06:** Add `setChatMenuButton` and `setMyCommands` as public functions following the same pattern — call `callTelegramApiDirect` with the bot token, method name, and optional parameters.

**Key details:**
- Use `callTelegramApiDirect` (not `callTelegramApi`) because these are out-of-band registration calls during onboarding (explicit bot token, not from botTokenStore)
- Return type: `Promise<void>` for both (Telegram returns `{ ok: true, result: true }` but we only care about success/error)
- Optional parameters (like `chatId`, `menuButton`, `scope`) should be conditionally added to the request body: `if (param) body.param = param;`
- Log at debug level with relevant context (method name, scope type, command count)

---

### `src/onboarding/ai-onboarding-agent.ts` (service, request-response)

**Analog:** `src/onboarding/ai-onboarding-agent.ts` — lines 568–609 (`finish_onboarding` tool case)

**Context where registerBotWebhook is called** (lines 587–592):
```typescript
// Always unregister before registering to prevent webhook conflicts
await unregisterBotWebhook(business.botToken!);
await registerBotWebhook(
  business.botToken!,
  `${config.webhookBaseUrl}/webhooks/telegram/${webhookId}`,
  webhookSecret
);
```

**Post-activation pattern** (lines 594–607):
```typescript
await activateBusiness(business.id, webhookId, webhookSecret);

// ARCH-03 pattern: persist onboardingCompleted=true under RLS before sending
// the congratulatory message.
await withBusinessContext(business.id, async () => {
  await getConn().update(businesses).set({ onboardingCompleted: true }).where(eq(businesses.id, business.id));
});

logger.info({ businessId: business.id, webhookId }, 'Business activated via AI onboarding agent');

await sendTelegramMessage(
  ownerTelegramId,
  'Η επιχείρησή σας είναι ενεργή! Οι πελάτες μπορούν τώρα να κάνουν κράτηση μέσω του bot σας.'
);
return '';
```

**Pattern for BOT-06:** After `registerBotWebhook` succeeds and before `activateBusiness` is called, inject calls to `setChatMenuButton` and `setMyCommands`. The owner's Telegram ID is available as `ownerTelegramId` in scope.

**Key timing detail:**
- Call after `registerBotWebhook` (webhook is now live)
- Call before or after `activateBusiness` (DB update) — doesn't matter; these are out-of-band API calls
- Wrap in try/catch with logger.error if fails (best-effort, like Phase 22–23 patterns)
- Do NOT return early if menu registration fails; continue with onboarding completion flow

---

### `src/conversation/ai-agent.ts` (service, error-handling)

**Analog 1:** Error handling pattern at lines 396–422 (catch block):
```typescript
} catch (err) {
  if (err instanceof GeminiRateLimitError) {
    logger.warn({ requestId, businessId: business.id, round }, 'aiBookingAgent: rate-limited after retries, returning fallback');
    return {
      text: RATE_LIMIT_REPLY_GREEK,
      interactionId: previousInteractionId ?? null,
      requestId,
      toolCalls: accumulatedToolCalls,
    };
  }
  // ... other error ...
  logger.error(
    { err, requestId, businessId: business.id, round, elapsedMs: Date.now() - agentStartedAt },
    'aiBookingAgent: unrecoverable Gemini call failure, returning fallback reply'
  );
  return {
    text: AGENT_ERROR_REPLY_GREEK,
    interactionId: currentInteractionId ?? null,
    requestId,
    toolCalls: accumulatedToolCalls,
  };
}
```

**Analog 2:** Owner notification pattern from `src/telegram/handlers/client-menu.ts` lines 247–280:
```typescript
// Owner notification — best-effort
try {
  if (business.ownerTelegramId && business.botToken) {
    // ... compose diagnostic message ...
    await botTokenStore.run(business.botToken, async () => {
      await sendTelegramMessage(business.ownerTelegramId!, diagnosticMsg);
    });
  }
} catch (err) {
  logger.error({ err, businessId: business.id, senderTelegramId, instanceId }, 'Owner booking notification failed (best-effort)');
}
```

**Pattern for DIAG-01:** Within the catch block at line 413–422, after logging the error, inject the owner notification logic:

1. Extract error type from `err.name` and `err.message`
2. Compose a diagnostic message in Greek (include `requestId` for correlation)
3. Wrap in `botTokenStore.run(business.botToken, ...)` to set the bot context
4. Call `sendTelegramMessage(business.ownerTelegramId!, diagnosticMsg)`
5. Catch any notification failures and log (best-effort)
6. Return the fallback text as before (unchanged)

**Key import:**
```typescript
import { botTokenStore, sendTelegramMessage } from '../telegram/client';
```

---

### `src/webhooks/telegram.ts` (controller, request-response + error-handling)

**Analog 1:** `handleFoundBusiness` catch block at lines 159–180:
```typescript
} catch (err) {
  logger.error(
    { err, updateId, businessId: business.id, senderTelegramId, elapsedMs: Date.now() - startedAt },
    'Failed to route Telegram conversation message'
  );
  try {
    await sendTelegramMessage(senderTelegramId, 'Παρουσιάστηκε πρόβλημα. Δοκιμάστε ξανά σε λίγο.');
  } catch (sendErr) {
    logger.error(
      { err: sendErr, updateId, senderTelegramId },
      'handleFoundBusiness: failed to send fallback error message to client'
    );
  }
}
```

**Analog 2:** Owner notification pattern (same as in client-menu.ts, lines 240–280)

**Pattern for DIAG-01:** Within the existing catch block at line 159–180:

1. After sending the client fallback message (lines 172–179)
2. Inject a second try/catch for owner notification (do not nest inside the first try/catch)
3. Extract error type from `err.name` and `err.message`
4. Compose diagnostic message in Greek (include `updateId` for correlation)
5. Check `business.ownerTelegramId && business.botToken`
6. Call `botTokenStore.run(business.botToken, async () => { await sendTelegramMessage(...) })`
7. Log any notification failures with `logger.error` (best-effort)
8. Do not return early or re-throw

**Key structure:**
- First try/catch: send client fallback (existing)
- Second try/catch: send owner diagnostic (new, best-effort)
- No changes to the overall flow or return behavior

---

## Shared Patterns

### Out-of-Band Telegram API Pattern
**Source:** `src/telegram/client.ts` lines 132–170
**Apply to:** `src/telegram/client.ts` (BOT-06 new functions)

This pattern is used for API calls with an explicit bot token (not from botTokenStore context). Includes:
- Timeout enforcement (15 seconds)
- HTTP status and JSON `ok` field validation
- Structured error logging
- No bot token in logs (security T-05-03)

### Owner Notification Pattern (Best-Effort)
**Source:** `src/telegram/handlers/client-menu.ts` lines 247–280
**Apply to:** `src/conversation/ai-agent.ts` (DIAG-01) and `src/webhooks/telegram.ts` (DIAG-01)

```typescript
try {
  if (business.ownerTelegramId && business.botToken) {
    await botTokenStore.run(business.botToken, async () => {
      await sendTelegramMessage(business.ownerTelegramId!, diagnosticMsg);
    });
  }
} catch (err) {
  logger.error({ err, businessId: business.id }, 'Owner notification failed (best-effort)');
}
```

Key points:
- Guarded by `business.ownerTelegramId && business.botToken` (both must be present)
- Wrapped in `botTokenStore.run()` to set the bot context
- Caught and logged, never re-thrown
- Used in Phases 22–23 for booking approvals, cancellations, escalations

### Logging Pattern for BOT-06
**Source:** `src/telegram/client.ts` lines 140–141, 168

Use `logger.debug` for successful API calls and `logger.error` for failures:
```typescript
logger.debug({ method }, 'Calling Telegram API');
// ... call ...
logger.debug({ method, elapsedMs }, 'Telegram API call succeeded (direct)');
```

When logging bot token operations, log only the method name, never the token itself (security T-05-03).

---

## No Analog Found

All files have direct analogs in the codebase:
- `src/telegram/client.ts`: Direct pattern match (registerBotWebhook, etc.)
- `src/onboarding/ai-onboarding-agent.ts`: Direct pattern match (finish_onboarding flow)
- `src/conversation/ai-agent.ts`: Pattern match (error handling + owner notifications in client-menu.ts)
- `src/webhooks/telegram.ts`: Direct pattern match (handleFoundBusiness catch block + owner notifications)
- Test files: Pattern match (jest mocking in function-executor.test.ts)

---

## Metadata

**Analog search scope:**
- `src/telegram/` — Telegram API wrapper patterns
- `src/onboarding/` — Bot activation and onboarding flow
- `src/conversation/` — AI agent error handling
- `src/webhooks/` — Webhook handlers and error fallbacks
- `src/telegram/handlers/` — Owner notification patterns (Phases 22–23)
- `tests/` — Jest test structure and mocking patterns

**Files scanned:** 6 source files + 20+ test files

**Pattern extraction date:** 2026-07-27

**Confidence:** HIGH
- BOT-06 (setChatMenuButton/setMyCommands): Exact analog match in callTelegramApiDirect pattern
- DIAG-01 (owner notifications): Proven pattern from Phases 22–23, reused in production code
- Test structure: Consistent with existing Jest test patterns in function-executor.test.ts and ai-agent.test.ts
