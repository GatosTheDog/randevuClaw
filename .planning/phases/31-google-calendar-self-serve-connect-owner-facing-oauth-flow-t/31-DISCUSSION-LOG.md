# Phase 31: Google Calendar Self-Serve Connect - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-13
**Phase:** 31-google-calendar-self-serve-connect-owner-facing-oauth-flow-t
**Areas discussed:** Entry point, Client calendar, Disconnect flow

---

## Owner connect entry point

| Option | Description | Selected |
|--------|-------------|----------|
| New /calendar command + settings button | Standalone Telegram command like /calendar, plus a button in /settings menu. Sends the Google consent link, owner taps, done. | ✓ |
| Prompt during onboarding only | Ask to connect calendar as part of initial business setup flow; no separate command afterward. | |
| Both onboarding prompt AND standalone command | Offer during onboarding, but also expose /calendar or a settings button for owners who skipped it or want to reconnect later. | |

**User's choice:** New /calendar command + settings button (recommended option).
**Notes:** Ensures owners who skip it at onboarding, or need to reconnect later, aren't stuck.

---

## Client-side calendar

| Option | Description | Selected |
|--------|-------------|----------|
| .ics invite link on confirm | On booking confirmation, bot sends an .ics file/link the client can tap to add to their own calendar app. No OAuth. | ✓ |
| Defer entirely | This phase only covers owner's Google Calendar sync. Client-side becomes its own future phase. | |
| Client Google OAuth (full sync) | Each client connects their own Google account too — much bigger scope, GDPR implications. | |

**User's choice:** .ics invite link on confirm (recommended option).
**Notes:** Avoids a second full OAuth integration and new per-client token storage/GDPR surface for a PoC.

---

## Disconnect flow

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add disconnect/reconnect | Add a "disconnect" action in settings that clears googleRefreshToken; reconnecting re-runs the same OAuth flow. | ✓ |
| No, connect-only for now | Only build initial connect. Bad token → fall back to manual CLI script; disconnect/reconnect deferred. | |

**User's choice:** Yes, add disconnect/reconnect (recommended option).

---

## Claude's Discretion

- Exact Greek copy for all new bot messages (connect prompt, success/failure, disconnect confirmation).
- OAuth success landing page design (functional minimum acceptable for PoC).
- Whether disconnect also calls Google's token-revoke endpoint or just clears the local `googleRefreshToken` column.
- Implementation detail of `.ics` generation (hand-rolled minimal string vs a library) — no ICS library currently in `package.json`.

## Deferred Ideas

- Full client-side Google Calendar OAuth sync — explicitly deferred to a future phase (too much scope/risk for this PoC: per-client token storage, second OAuth integration, GDPR review).
