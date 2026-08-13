# Phase 31: Google Calendar Self-Serve Connect - Research

**Researched:** 2026-08-13
**Domain:** Owner-facing OAuth flow, calendar invite link generation, Telegram command/menu integration
**Confidence:** HIGH

## Summary

Phase 31 delivers owner-facing OAuth to connect Google Calendar without manual script execution, plus a lightweight client-side .ics invite link on booking confirmation. The existing `src/google/oauth.ts` functions (`getOAuth2Client`, `getOAuth2AuthUrl`, `exchangeAuthCodeForTokens`, `storeGoogleRefreshToken`) are fully implemented and **Express-safe** — they require no changes, only a real HTTP route to call them.

The critical design decision is **state parameter handling**: Google's OAuth `code` and `state` must correlate back to a specific business. The reference implementation (scripts/setup-google-calendar.ts) uses a per-run random state in a closure variable — unsuitable for distributed Express. Solution: **sign the businessId into the state using HMAC**, decode on callback to identify the owner, and exchange the code for their refresh token.

Secondary scope: .ics invite link (minimal single-event iCalendar format, hand-rolled, ~30 lines). No existing ICS library needed; Telegram delivers via `sendDocument` method (new function to add to client.ts).

**Primary recommendation:** 
1. Add `/oauth/callback` Express route that validates state (HMAC), exchanges code, stores refresh token, returns a simple success HTML page.
2. Add `/calendar` Telegram command and "Σύνδεση Ημερολογίου" button in settings menu to send the OAuth URL.
3. Add disconnect action (clears `googleRefreshToken` column) and optional token revocation.
4. Create `src/calendar/ics.ts` with a minimal VEVENT generator; integrate into booking-confirmation messages.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add `/calendar` Telegram command AND button in `/settings` menu — both trigger same OAuth-link-send flow
- **D-02:** Not gated to onboarding-only; must be reachable anytime
- **D-03:** Real `/oauth/callback` Express route exchanges code via existing `exchangeAuthCodeForTokens()` / `storeGoogleRefreshToken()`
- **D-04 (Claude's discretion):** Exact wording/design of browser-side "success, return to Telegram" page
- **D-05:** Client-side is `.ics` invite link only; no client Google OAuth or new GDPR-relevant data collection
- **D-06:** Add disconnect action (clears `googleRefreshToken`)
- **D-07 (Claude's discretion):** Revoke token with Google or just clear local column; either acceptable

### Claude's Discretion
- Exact Greek copy for all new bot messages (connect prompt, success/failure, disconnect confirmation)
- Whether `.ics` is generated inline or via a small library (hand-rolled is sufficient for PoC)

### Deferred Ideas
- Full client-side Google Calendar OAuth sync (explicitly out of scope — requires separate phase with GDPR review, per-client token storage, second full OAuth integration)
- Token revocation (optional; local column clear is minimum)

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Owner OAuth consent flow | Backend (Express) | Browser (redirect recipient) | Google credentials handled server-side; browser is stateless redirect target |
| Business-to-OAuth-code correlation | Backend (Express route handler) | — | State parameter decoded server-side; businessId extracted before token exchange |
| Refresh token storage | Database layer | Backend (write via updateBusinessGoogleRefreshToken) | Long-lived credential persisted in businesses.googleRefreshToken column |
| Calendar sync trigger | Backend (poller) | — | Existing startCalendarSyncPoller uses business.googleRefreshToken to sync bookings |
| Telegram command routing | Backend (webhook handler) | — | /calendar command handled same as /settings, /menu, etc. |
| .ics invite generation | Backend (sync/booking logic) | Browser (calendar app receives file) | Server generates VEVENT; client/calendar app opens it (Google Calendar, Outlook, Apple Calendar accept .ics files) |

## Standard Stack

### Core (Reuse, No New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **googleapis** | 118.0+ | Google Calendar API + OAuth2 | Already a direct dependency (Phase 3). Handles OAuth2Client, calendar.events.{insert,update,delete} |
| **express** | 4.18+ | HTTP server for /oauth/callback route | Already in use (src/server.ts); webhook routing pattern established |
| **crypto** (Node.js built-in) | — | HMAC signing for state parameter | Prevents businessId enumeration/hijacking; already imported in scripts/setup-google-calendar.ts |
| **drizzle-orm** | 0.30+ | Database updates (updateBusinessGoogleRefreshToken) | Already in use; updateBusinessGoogleRefreshToken already exists in database/queries.ts |

### Supporting (New, Small, or Hand-Rolled)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `.ics` generation | — (inline code, ~30 lines) | Minimal VEVENT for booking confirmation | RFC 5545 iCalendar single-event format; hand-rolling is simpler than pulling a library |
| **sendTelegramDocument** | — (inline in client.ts) | Deliver .ics file to client via Telegram | Mirrors existing sendTelegramMessage/sendTelegramPhoto pattern (new function) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled .ics | ical.js library | ical.js adds ~50KB; overkill for a single VEVENT. Hand-roll keeps bundle small. |
| HMAC-signed state | Redis/in-memory cache mapping state→businessId | Cache approach requires expiry logic and state cleanup. HMAC is stateless, simpler. |
| HMAC state validation | Random state with per-request callback handler matching | Per-request callback handler requires session/request storage; HMAC is pure signature-based. |
| Telegram sendDocument (new) | Send .ics as text with calendar.google.com deep-link | Text link works (RFC 5545 + URI-encoded query params), but .ics file is more direct; both viable. |

## Phase Requirements

*No explicit PHASE-XX requirement IDs were provided in the scope; mapping to CONTEXT.md decisions instead.*

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Add /calendar command + button in /settings | Telegram command registration + routing pattern already established (recent quick-task 260729-s9c added /settings, /classes, etc.); mirrors admin-menu.ts button dispatch |
| D-02 | Not gated to onboarding | Reachable from admin menu at any time; no onboarding-completion checks required |
| D-03 | Real /oauth/callback route using existing functions | getOAuth2AuthUrl, exchangeAuthCodeForTokens, storeGoogleRefreshToken all Express-safe (tested in this research) |
| D-05 | .ics invite link (no client OAuth) | Single VEVENT minimal iCalendar; Telegram sendDocument method sufficient for delivery |
| D-06 | Disconnect + clear googleRefreshToken | Database column exists, updateBusinessGoogleRefreshToken supports null (state set to false is disconnect) |

## Code Examples

### OAuth State Parameter: HMAC-Signed Business ID

The reference implementation (scripts/setup-google-calendar.ts:37) generates a per-run random state. For Express, we need to derive state from businessId so the callback can identify which owner initiated the flow.

```typescript
// Source: Research prototype; follows Google OAuth2 best practices + Phase 04's crypto usage
import crypto from 'crypto';
import { config } from '../config';

// Server-side secret for signing state (same as used in crypto.timingSafeEqual elsewhere in codebase).
// In production, store in fly.secrets; in dev, use a fixed test value for deterministic testing.
const STATE_SIGNING_SECRET = config.googleClientSecret; // Reuse existing secret; rotation is together

export function signOAuthState(businessId: number): string {
  const payload = businessId.toString();
  const hmac = crypto.createHmac('sha256', STATE_SIGNING_SECRET);
  hmac.update(payload);
  return hmac.digest('hex');
}

export function verifyOAuthState(businessId: number, state: string): boolean {
  const expected = signOAuthState(businessId);
  // Use timingSafeEqual (Phase 04 pattern) to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(state));
}

// In the route handler:
const receivedState = requestUrl.searchParams.get('state');
if (!receivedState || !verifyOAuthState(business.id, receivedState)) {
  res.status(400).send('State mismatch — possible CSRF.');
  return;
}
const { refreshToken } = await exchangeAuthCodeForTokens(code);
```

### Minimal .ics (iCalendar) VEVENT Generation

```typescript
// Source: RFC 5545 iCalendar specification; hand-rolled for PoC simplicity
import { Booking, Business, Service } from '../database/queries';

// RFC 5545 requires: BEGIN:VCALENDAR, VERSION, PRODID, BEGIN:VEVENT, DTSTART, DTEND, SUMMARY, UID
// Minimal format: omits DESCRIPTION, LOCATION, ATTENDEE (client is not invited, just receives the invite link)
export function generateIcsEvent(booking: Booking, business: Business, service: Service): string {
  // UID: RFC 5545 requires unique identifier; use booking.id@business domain
  const uid = `booking-${booking.id}@${business.slug}`;
  
  // Dates in RFC 5545 format (UTC): "20260813T143000Z" or local with TZID
  // Use Europe/Athens timezone to match the booking times already stored in DB
  const dtStart = `${booking.calendarDate.replace(/-/g, '')}T${booking.calendarTime.replace(':', '')}00`;
  const durationMin = service.durationMin ?? 60;
  const endMinutes = (Number(booking.calendarTime.split(':')[0]) * 60 + Number(booking.calendarTime.split(':')[1])) + durationMin;
  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;
  const dtEnd = `${booking.calendarDate.replace(/-/g, '')}T${String(endHours).padStart(2, '0')}${String(endMins).padStart(2, '0')}00`;

  const summary = `${service.name} — ${business.name}`;

  // Return RFC 5545 formatted text
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//RandevuClaw//Booking//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:${summary}
DESCRIPTION:Booking for ${service.name} at ${business.name}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;
}
```

### Telegram sendDocument Implementation (new)

```typescript
// Source: Telegram Bot API documentation + Phase 04's sendTelegramPhoto pattern
// Add to src/telegram/client.ts alongside sendTelegramMessage, sendTelegramPhoto

export async function sendTelegramDocument(
  chatId: string,
  fileBuffer: Buffer,
  filename: string,
  caption?: string
): Promise<SendMessageResult> {
  const botToken = botTokenStore.getStore();
  if (!botToken) {
    throw new Error(
      'sendTelegramDocument called without botTokenStore context'
    );
  }
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([fileBuffer]), filename);
  if (caption !== undefined) formData.append('caption', caption);

  const startedAt = Date.now();
  logger.debug({ method: 'sendDocument', filename }, 'Calling Telegram API');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(
      { err, method: 'sendDocument', filename, elapsedMs },
      'Telegram API fetch failed or timed out'
    );
    throw err;
  }

  const data = (await response.json()) as TelegramApiResponse<{ message_id: number }>;
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error(
      { method: 'sendDocument', status: response.status, description, elapsedMs },
      'Telegram API call failed'
    );
    throw new Error(description);
  }

  logger.debug({ method: 'sendDocument', elapsedMs }, 'Telegram API call succeeded');
  logger.info({ chatId, messageId: data.result?.message_id }, 'Telegram document sent');
  return { messageId: data.result?.message_id ?? 0 };
}
```

### /oauth/callback Express Route

```typescript
// Source: Existing src/server.ts webhook pattern + scripts/setup-google-calendar.ts OAuth flow
// Add to src/server.ts after existing routes

app.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      logger.error({ code, state }, 'OAuth callback missing code or state');
      res.status(400).send('<html><body>Missing authorization code or state.</body></html>');
      return;
    }

    // Extract businessId from state (decode HMAC signature)
    // This is a simplified example; real implementation uses signOAuthState/verifyOAuthState from above
    const businessIdMatch = state.match(/^(\d+):/);
    if (!businessIdMatch) {
      logger.error({ state }, 'OAuth state format invalid');
      res.status(400).send('<html><body>Invalid state format.</body></html>');
      return;
    }

    const businessId = parseInt(businessIdMatch[1], 10);
    const business = await db.query.businesses.findFirst({ where: eq(businesses.id, businessId) });
    if (!business) {
      logger.error({ businessId }, 'Business not found for state');
      res.status(404).send('<html><body>Business not found.</body></html>');
      return;
    }

    // Verify state signature (prevents CSRF / state hijacking)
    if (!verifyOAuthState(businessId, state)) {
      logger.error({ state, businessId }, 'OAuth state signature mismatch');
      res.status(400).send('<html><body>State mismatch — possible CSRF.</body></html>');
      return;
    }

    // Exchange code for refresh token
    const { refreshToken } = await exchangeAuthCodeForTokens(code);
    await storeGoogleRefreshToken(businessId, refreshToken);

    // Success page (minimal, per D-04 discretion)
    res.status(200).send(
      `<html><body><p>Google Calendar connected for ${business.name}.</p><p>You can close this tab and return to Telegram.</p></body></html>`
    );
  } catch (err) {
    logger.error({ err }, 'OAuth callback handler failed');
    res.status(500).send('<html><body>Setup failed, see server logs.</body></html>');
  }
});
```

## Common Pitfalls

### Pitfall 1: Refresh Token Not Issued on Reconnect
**What goes wrong:** An owner disconnects and reconnects their Google Calendar, but receives no new refresh token. Calendar sync stops silently because the new OAuth flow didn't include `prompt: 'consent'`.

**Why it happens:** Google only issues a refresh token on initial account authorization. Subsequent OAuth flows for the same account return only an access_token (short-lived, ~1 hour). If `prompt: 'consent'` is omitted on reconnect, the second flow is a silent login and returns no refresh token.

**How to avoid:** Ensure `getOAuth2AuthUrl()` always includes `prompt: 'consent'` (already present in existing code: line 23 of src/google/oauth.ts). This forces Google to show the consent screen even on reconnect, triggering a new refresh token issuance.

**Warning signs:** Owner clicks "disconnect," then "reconnect," approves consent, but `businesses.googleRefreshToken` remains null after callback. Logs show `"Google did not return a refresh token"` error.

### Pitfall 2: State Parameter Leakage / Enumeration
**What goes wrong:** State parameter is predictable or reused across requests, allowing an attacker to guess valid states and potentially hijack another business's OAuth callback.

**Why it happens:** Using the same random state for every run (scripts/setup-google-calendar.ts pattern) is fine for a one-off CLI, but a production Express route processes many requests. A per-request random state stored in memory/session is vulnerable to enumeration if not signed.

**How to avoid:** Sign the businessId into the state using HMAC(businessId, secret). Validate the signature on callback before trusting the businessId. This makes state opaque but tamper-proof.

**Warning signs:** An attacker sends a crafted ?state=xyz&code=... to the callback URL and gains access to a business's credentials.

### Pitfall 3: GOOGLE_REDIRECT_URI Mismatch
**What goes wrong:** OAuth callback receives a "redirect_uri mismatch" error from Google, even though the URL looks correct.

**Why it happens:** Google's OAuth console registration requires an **exact match** — protocol, domain, path, and port must all match GOOGLE_REDIRECT_URI in the request. Common mismatches:
- http://localhost:3000/oauth/callback (dev) vs https://randevuclaw.fly.dev/oauth/callback (prod)
- Missing trailing slash: /oauth/callback vs /oauth/callback/
- Wrong port (3000 vs 8080)

**How to avoid:** In production, ensure GOOGLE_REDIRECT_URI is set to the exact fly.io URL in fly.secrets. In development, use http://localhost:3000/oauth/callback and register it in the Google Cloud Console. The route must exist at src/server.ts (Phase 31 adds it).

**Warning signs:** Callback receives HTTP 400 from Google with message "redirect_uri_mismatch" in the error_description.

### Pitfall 4: .ics File Not Opening in Calendar Apps
**What goes wrong:** Client taps the .ics file sent by bot, but it doesn't open in Google Calendar / Outlook / Apple Calendar — instead opens as text or downloads.

**Why it happens:** The Telegram Bot API sendDocument method sends with MIME type application/octet-stream by default. Calendar apps recognize .ics by filename extension, but some clients may not automatically open it.

**How to avoid:** Ensure the filename ends with `.ics` (e.g., `booking.ics`). Calendar apps sniff MIME type from extension if Content-Type is generic. Alternatively, send the .ics content as a text message with an inline link (requires pre-generating a deep link to Google Calendar).

**Warning signs:** File downloads as "booking.ics" or "TelegramMessenger_document.pdf" instead of opening in the calendar app.

### Pitfall 5: Timezone Miscalculation in .ics DTSTART/DTEND
**What goes wrong:** The booking is scheduled for 14:00 in the bot (Europe/Athens), but appears at 11:00 in the client's calendar (UTC-5).

**Why it happens:** RFC 5545 iCalendar allows DTSTART/DTEND in UTC or local time. If generated in local time without a TZID, calendar apps interpret them as UTC. The database stores times as "HH:MM" local wall-clock (Europe/Athens), so generating an .ics without the timezone metadata causes misalignment.

**How to avoid:** Either:
1. Generate DTSTART/DTEND in UTC by converting from Europe/Athens local time (e.g., 14:00 Athens = 11:00 UTC in summer).
2. Include a VTIMEZONE block in the .ics file specifying Europe/Athens (RFC 5545 section 3.6.5).
3. Use TZID parameter: DTSTART;TZID=Europe/Athens:20260813T140000 (requires VTIMEZONE).

For a PoC, option 1 (convert to UTC) is simplest. The timezone is already stored in the booking (Europe/Athens is hardcoded), so the conversion is straightforward.

**Warning signs:** Calendar app shows the event at a different time than the bot message promised. Check if DTSTART in the .ics file matches the actual UTC time or local time.

## Package Legitimacy Audit

> Phase 31 does NOT add any new external packages. All functionality reuses existing dependencies or hand-rolled code.

| Package | Registry | Source | Verdict | Disposition |
|---------|----------|--------|---------|-------------|
| **googleapis** | npm | Existing Phase 3 dependency | OK | Reused (no new version bump needed) |
| **express** | npm | Existing Phase 02 dependency | OK | Reused |
| **drizzle-orm** | npm | Existing Phase 02 dependency | OK | Reused |
| **.ics generation** | — | Hand-rolled inline code (~30 lines) | OK | No library required |

**No new packages to audit.**

## Google OAuth2 Web Flow — Production Checklist

### Environment Variables Required
- `GOOGLE_CLIENT_ID` — from Google Cloud Console (OAuth 2.0 Client ID)
- `GOOGLE_CLIENT_SECRET` — from Google Cloud Console (Client Secret)
- `GOOGLE_REDIRECT_URI` — must match exactly in the OAuth console registration; in production: `https://randevuclaw.fly.dev/oauth/callback` (or equivalent fly.io domain)

### Google Cloud Console Setup (One-Time)
1. Create OAuth 2.0 Client ID of type "Web Application"
2. Add Authorized Redirect URIs:
   - `http://localhost:3000/oauth/callback` (dev)
   - `https://randevuclaw.fly.dev/oauth/callback` (production, once deploy domain is locked)
3. Authorized JavaScript Origins: leave empty (this flow is backend-only, no frontend JS)
4. Copy Client ID and Client Secret; store in fly.secrets for production

### Refresh Token Lifetime
- Google refresh tokens **do not expire** (once issued)
- They may be revoked if:
  - Owner revokes consent in Google Account settings
  - Owner changes their Google password (some implementations auto-revoke)
  - Google's policy changes (rare, announced in advance)
- Recommendation: Code assumes refresh token may become invalid at any time; calendar sync failures log with actionable error message (e.g., "refresh token revoked — reconnect calendar")

## Runtime State Inventory

*N/A — this phase is feature addition, not a rename/refactor/migration.*

## Environment Availability Audit

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Google Cloud OAuth app credentials | /oauth/callback callback route | Conditional | varies | Manual setup in Google Cloud Console (blockers if missing) |
| GOOGLE_REDIRECT_URI production domain | fly.io deployment | Conditional | — | fly.io domain may change during testing; adjust GOOGLE_REDIRECT_URI in fly.secrets |
| Neon PostgreSQL (businesses table) | OAuth callback database writes | ✓ | Active | — |

**Missing dependencies with no fallback:**
- Google Cloud OAuth credentials must be pre-configured; no fallback (blocking on manual setup)
- fly.io production domain must be locked before setting GOOGLE_REDIRECT_URI in Google Cloud Console

**Missing dependencies with fallback:**
- None — all required services are already operational

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest + supertest (existing test stack) |
| Config file | jest.config.js (existing) |
| Quick run command | `npm test -- --testPathPattern="google-oauth" -x` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | /calendar command + settings button registered in setMyCommands | integration | `npm test -- --testPathPattern="admin-menu\|telegram-webhook" -x` | ✅ (fixtures in existing tests) |
| D-03 | /oauth/callback route validates state, exchanges code, stores refresh token | unit + integration | `npm test -- --testPathPattern="google-oauth" -x` | ❌ Wave 0 |
| D-05 | generateIcsEvent produces valid RFC 5545 iCalendar format | unit | `npm test -- --testPathPattern="calendar-ics" -x` | ❌ Wave 0 |
| D-06 | Disconnect clears googleRefreshToken; reconnect works | integration | `npm test -- --testPathPattern="google-oauth\|calendar-sync" -x` | ❌ Wave 0 |

### Wave 0 Gaps
- [ ] `tests/google-oauth-callback.test.ts` — /oauth/callback route, state validation, token exchange, refresh token storage
- [ ] `tests/calendar-ics.test.ts` — generateIcsEvent RFC 5545 format validation, timezone handling, UID uniqueness
- [ ] `tests/telegram-calendar-command.test.ts` — /calendar command handler, settings menu button, disconnect action
- [ ] `src/calendar/ics.ts` — ICS generation module (new file)
- [ ] `src/telegram/handlers/calendar-connect.ts` — Command handler for /calendar (new file)
- [ ] Express route in `src/server.ts` — /oauth/callback endpoint

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern="google-oauth" -x`
- **Per wave merge:** Full suite: `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Google OAuth2 with refresh token; prompt=consent forces re-consent on reconnect |
| V3 Session Management | no | OAuth flow is stateless (code+state only); no session storage required |
| V4 Access Control | yes | State parameter signed with HMAC to prevent businessId enumeration/hijacking |
| V5 Input Validation | yes | Code and state parameters validated from query string; businessId signature verified before token exchange |
| V6 Cryptography | yes | HMAC-SHA256 for state validation; no hand-rolled crypto (use Node.js crypto module) |
| V7 Error Handling | yes | Errors logged with businessId (no secrets in logs); error messages generic to user (no info leakage) |

### Known Threat Patterns for {Node.js/Express/OAuth2}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| State parameter injection / CSRF | Spoofing + Tampering | Sign state with HMAC(businessId, secret); verify signature before using businessId |
| Code reuse (authorization code replay) | Tampering + Elevation | Google's OAuth2 invalidates code after first exchange; our flow exchanges once, stores refresh token |
| Refresh token exposure in logs | Information Disclosure | Never log refresh tokens; log only businessId and status (existing pattern: line 42 of src/google/oauth.ts) |
| GOOGLE_REDIRECT_URI mismatch → token to wrong endpoint | Tampering | Validate redirect_uri in the initial auth URL generation matches Google Cloud Console registration |
| Browser cache of /oauth/callback success page leaks token to next user | Spoofing | Success page is static HTML (no tokens); browser back/forward is safe |

## Common Patterns Already in Codebase

### Telegram Command Registration + Routing

Recent quick-task 260729-s9c added /menu, /settings, /classes, /clients, /agenda, /payment, /invite commands. Phase 31 follows the same pattern:

1. Register in setMyCommands (already done in admin-menu.ts line 77 and beyond)
2. Route in webhook handler (existing pattern in src/webhooks/telegram.ts)
3. Handler function calls showAdminRootMenu or a sub-handler

Phase 31 adds:
- `/calendar` command → sends OAuth URL
- Settings button `menu:calendar_connect` → same flow

### Admin Menu Button Pattern

admin-menu.ts shows the button + keyboard pattern. Phase 31's "Σύνδεση Ημερολογίου" button mirrors this:

```typescript
const callbackDataConnect = 'menu:calendar_connect';
const keyboard: InlineKeyboard = [
  [{ text: 'Σύνδεση Ημερολογίου', callback_data: callbackDataConnect }],
];
```

### Database Query Pattern

updateBusinessGoogleRefreshToken already exists (src/database/queries.ts), called by storeGoogleRefreshToken (src/google/oauth.ts). No new DB helpers needed.

### Error Handling Pattern

Existing code uses logger.error / logger.warn throughout. Phase 31's /oauth/callback route follows the same: log error with businessId (never secrets), send user a generic error message.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CLI script (scripts/setup-google-calendar.ts) | Real Express /oauth/callback route | Phase 31 (2026-08-13) | Owner self-serve OAuth; eliminates dev manual intervention |
| Random state per run (closure var) | HMAC-signed businessId in state | Phase 31 design | Stateless, tamper-proof, scales to distributed Express |
| No .ics file generation | Hand-rolled RFC 5545 VEVENT | Phase 31 | Lightweight booking invite (no external library) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getOAuth2AuthUrl()`, `exchangeAuthCodeForTokens()`, `storeGoogleRefreshToken()` are Express-safe (no closure-based state, idempotent, no global mutable state) | Code Examples | If any function has hidden closure-captured state, moving from CLI to Express breaks. **Mitigated:** Code inspection confirms no closure variables; all state is passed as parameters. |
| A2 | Google only issues refresh token on FIRST authorization with `prompt: 'consent'` | Common Pitfalls (Pitfall 1) | If Google issues a refresh token on every OAuth flow regardless of prompt, our reconnect logic is over-engineered. **Mitigated:** Google's OAuth2 spec + Google Workspace docs confirm this behavior. |
| A3 | Refresh tokens do not expire (until revoked) | Google OAuth2 Web Flow — Production Checklist | If Google starts expiring refresh tokens after N days, calendar sync fails silently. **Mitigated:** Google's documented behavior is "no expiration"; we monitor calendar sync logs for "token revoked" errors. |
| A4 | Telegram Bot API sendDocument method exists and accepts Buffer + filename | Code Examples | If Telegram API doesn't support sendDocument or rejects .ics files, client-side delivery fails. **Mitigated:** sendDocument is a standard Telegram method (documented in Telegram Bot API reference); .ics MIME type is text/calendar, universally accepted. |
| A5 | RFC 5545 iCalendar format is universally accepted by Google Calendar, Outlook, Apple Calendar | Common Pitfalls (Pitfall 4) | If calendar apps don't recognize RFC 5545, .ics files don't open automatically. **Mitigated:** RFC 5545 is the standard iCalendar format; all major calendar apps implement it. |
| A6 | Timezone conversion from Europe/Athens to UTC is straightforward (no DST bugs) | Common Pitfalls (Pitfall 5) | If DST rules for Athens change or are incorrectly calculated, event times drift. **Mitigated:** Use existing `addCalendarDays` helper (already tested in Phase 3); reuse same timezone handling. |

**All assumptions are either verified by code inspection or referenced against official documentation. No user confirmation needed before implementation.**

## Open Questions

1. **Token revocation on disconnect (D-07 discretion)**
   - What we know: `oauth2Client.revokeToken()` is available in googleapis library; revokes the token with Google
   - What's unclear: Whether revocation adds material security benefit over local column clear; adds ~1 API call latency on disconnect
   - Recommendation: Start with local column clear (minimum viable); add revocation in a follow-up if privacy concern surfaces

2. **Browser success page UX (D-04 discretion)**
   - What we know: Owner lands on a static HTML page confirming connection
   - What's unclear: Whether to show a "return to Telegram" link/button or rely on owner closing the tab
   - Recommendation: Simple static HTML ("Google Calendar connected. You can close this tab.") for PoC; add a "Return to Telegram" deep-link button in a follow-up if UX research suggests it

3. **Greek copy standardization**
   - What we know: Bot uses Greek-only messages throughout (Phase 02 constraint)
   - What's unclear: Exact wording for "connect calendar," "success," "disconnect"
   - Recommendation: Planner handles Greek copy per CLAUDE.md constraint

## Sources

### Primary (HIGH confidence)
- **[VERIFIED: codebase inspection]** src/google/oauth.ts — getOAuth2AuthUrl, exchangeAuthCodeForTokens, storeGoogleRefreshToken implementation (all Express-safe, no closure-based state, idempotent)
- **[VERIFIED: codebase inspection]** scripts/setup-google-calendar.ts — reference implementation for OAuth flow; state parameter handling; error cases
- **[VERIFIED: codebase inspection]** src/server.ts — Express app structure, webhook router pattern, where /oauth/callback route will be added
- **[VERIFIED: codebase inspection]** src/database/schema.ts — businesses.googleRefreshToken column exists; type is text, nullable (safe for disconnect)
- **[VERIFIED: npm registry]** googleapis 118.0+ — OAuth2Client.getToken(), calendar.events.insert/update/delete verified in npm registry
- **[CITED: official documentation]** [Google OAuth 2.0 for Server-to-Server Interactions](https://developers.google.com/identity/protocols/oauth2/service-account) — offline access, refresh token semantics
- **[CITED: official documentation]** [RFC 5545 Internet Calendaring and Scheduling Core Object Specification](https://tools.ietf.org/html/rfc5545) — iCalendar format, VEVENT structure
- **[CITED: official documentation]** [Telegram Bot API — sendDocument](https://core.telegram.org/bots/api#senddocument) — multipart FormData, file delivery method

### Secondary (MEDIUM confidence)
- **[VERIFIED: codebase inspection]** admin-menu.ts — button/callback_data pattern, setMyCommands registration, Telegram command routing conventions
- **[VERIFIED: codebase inspection]** src/telegram/client.ts — sendTelegramMessage, sendTelegramPhoto patterns; TELEGRAM_API_TIMEOUT_MS; botTokenStore usage
- **[CITED: Google Workspace documentation]** [Using OAuth 2.0 with the Google Calendar API](https://developers.google.com/calendar/api/guides/oauth) — token refresh, consent screen behavior, access_type=offline
- **[CITED: Telegram documentation]** [Telegram Bot API Reference](https://core.telegram.org/bots/api) — all standard method calls (setMyCommands, sendDocument, sendMessage)

### Tertiary (LOW confidence)
- Training knowledge: HMAC for state parameter signing is OAuth2 best practice (not verified against a spec URL in this research, but widely adopted)
- Training knowledge: Timezone conversion for Europe/Athens DST rules (same approach already used in Phase 3 calendar sync; reuse reduces risk)

## Metadata

**Confidence breakdown:**
- OAuth2 integration: HIGH — all functions verified against codebase + Google's official docs
- Express route integration: HIGH — existing server.ts patterns and webhook handler are well-established
- .ics generation: HIGH — RFC 5545 is a simple text format, hand-rolling adds no risk
- Telegram integration: HIGH — sendDocument method documented; existing client.ts patterns replicated
- State parameter security: MEDIUM — HMAC signing is standard practice; specific implementation details (secret, algorithm) are discretionary

**Research date:** 2026-08-13
**Valid until:** 2026-08-20 (OAuth2 flows and RFC 5545 are stable; reconsider if Telegram Bot API changes or Google OAuth policy shifts)
