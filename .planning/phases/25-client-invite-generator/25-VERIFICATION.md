---
phase: 25-client-invite-generator
verified: 2026-07-27T00:00:00Z
status: human_needed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Scan the QR code from a real invite (sent via either the admin menu 'Πρόσκληση Πελάτη' button or free-chat 'στείλε μου invite') with a physical phone camera against a live deployed bot"
    expected: "Telegram's own app opens the correct bot's chat, matching the raw t.me/<bot_username> link shown as plain text in the same message's caption"
    why_human: "Requires a live bot token, a real Telegram-registered phone, and physical camera hardware — cannot be automated in this sandbox. This is the one item PLAN.md itself flags as manual-only (25-01-PLAN.md `<verification>` block)."
---

# Phase 25: Client Invite Generator Verification Report

**Phase Goal:** Owner can generate a single, ready-to-share invite for their business's bot — a printable QR code plus a copyable deep link — so bringing on a new client needs no manual setup.
**Verified:** 2026-07-27
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Owner receives one message with a QR image composed with business name + Greek CTA baked into pixels, ready to print standalone (Roadmap SC1) | ✓ VERIFIED | Read `src/invites/generator.ts` — `generateInviteImageBuffer` builds header/QR/footer via `sharp({create:...}).composite([...]).png().toBuffer()`. Independently re-ran (unmocked, real `qrcode`+`sharp`) `generateInviteImageBuffer('t.me/testbot', 'Το Studio Ρυθμός & Χορός', 'Κάντε κράτηση τώρα!')` — produced an identical 18537-byte PNG to the orchestrator's report; viewed the PNG directly: Greek business name, `&` rendered literally (not broken), Greek CTA, and a scannable QR all render correctly on a white canvas |
| 2 | Same message includes the raw `t.me/<bot_username>` deep link as copyable plain text (Roadmap SC2) | ✓ VERIFIED | `sendBusinessInvite` builds `caption = \`Σύνδεσμος κράτησης — πατήστε παρατεταμένα για αντιγραφή:\n${deepLink}\`` and passes it to `sendTelegramPhoto(chatId, imageBuffer, caption)`, which appends `caption` as a plain FormData field (not embedded in the image) — read directly in `src/invites/generator.ts` and `src/telegram/client.ts` |
| 3 | Owner can print/post the QR image or forward/paste the caption's link text into any channel (Roadmap SC3) | ✓ VERIFIED | The invite is delivered as a genuine Telegram `sendPhoto` call (multipart FormData, `photo` as Blob + separate `caption` field) — a standard Telegram photo message, which Telegram's own client natively supports forwarding/saving/copying text from. No code path restricts or wraps this behavior |
| 4 | QR code, when scanned, encodes exactly the same `t.me/<bot_username>` link shown in the caption | ✓ VERIFIED | Independently decoded the generated PNG's QR region with `jsQR` against the raw pixel buffer — decoded payload was the exact literal string `t.me/testbot`, matching the deep link passed to `generateInviteImageBuffer` and the caption text |
| 5 | Caption's deep link is derived from a fresh `getMeBotInfo` call on *this* business's own bot token (D-02), not a stale/global value | ✓ VERIFIED | `sendBusinessInvite` calls `await getMeBotInfo(business.botToken)` every invocation (no caching) and builds `deepLink` from the resolved `botInfo.username`; `business.botToken` is the per-business token from the caller's own `Business` object (webhook-scoped in the admin-menu path, per-request in the free-chat path) |
| 6 | No other business's name, bot token, or business/client data ever appears in the composed image/caption; bot token never logged or rendered | ✓ VERIFIED | Grepped `src/invites/generator.ts` for `botToken` — it appears only as a function-parameter pass-through (`getMeBotInfo(business.botToken)`), never interpolated into a string, SVG template, or `logger.*` call; the only `logger.info` call logs `{ businessId: business.id }` only |
| 7 | Owner-supplied business name containing `&`, `<`, `>`, `"`, `'` does not break SVG composition and cannot inject additional SVG markup (T-25-01) | ✓ VERIFIED | `escapeXml()` applied to both `businessName` and `greekCTA` before SVG interpolation; `tests/invites/generator.test.ts`'s escaping test asserts on the *actual buffer content* passed to `sharp.composite(...)` (not merely "does not throw") — re-ran this test independently, passed. Also independently verified via my own unmocked smoke test using a business name containing a raw `&` — the rendered PNG shows a literal `&` glyph with no broken markup |
| 8 | Both trigger paths (admin menu, free-chat AI tool) call the exact same `sendBusinessInvite` function — no duplicated Greek copy or divergent behavior | ✓ VERIFIED | `src/telegram/handlers/admin-menu.ts:24` imports and `handleInviteGeneration` (line 253-266) calls `sendBusinessInvite(business, chatId)`; `src/onboarding/ai-owner-agent.ts:35` imports and the `send_invite` case (line 879-882) calls `await sendBusinessInvite(business, ownerTelegramId); return '';` — identical function, zero duplicated string construction in either call site |
| 9 | Owner can trigger invite generation from both the admin menu and free Greek chat | ✓ VERIFIED | Admin menu: `showAdminRootMenu` keyboard has a 3rd row `[{ text: 'Πρόσκληση Πελάτη', callback_data: 'menu:invite' }]`; `handleMenuCallback`'s switch has `case menuAction === 'invite': await handleInviteGeneration(chatId, business); break;`. Free chat: `OWNER_TOOLS` array has a zero-arg `send_invite` entry (line 400-409); `executeOwnerTool`'s switch has the `'send_invite'` case |

**Score:** 9/9 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/invites/generator.ts` | Exports `generateInviteImageBuffer`, `sendBusinessInvite`; `escapeXml` private | ✓ VERIFIED | Read in full — matches spec exactly, both exports present, `escapeXml` not exported |
| `src/telegram/client.ts` | Exports `sendTelegramPhoto(chatId, photoBuffer, caption?)` | ✓ VERIFIED | Read in full — multipart FormData, botTokenStore guard, AbortSignal.timeout, same logging shape as `callTelegramApi`; never sets Content-Type manually, never JSON.stringifies |
| `src/telegram/handlers/admin-menu.ts` | 3rd keyboard row `menu:invite`; `handleMenuCallback` routes to `handleInviteGeneration` | ✓ VERIFIED | Confirmed both the keyboard row and the switch-case dispatch |
| `src/onboarding/ai-owner-agent.ts` | `send_invite` zero-arg tool in `OWNER_TOOLS`; `executeOwnerTool` case | ✓ VERIFIED | Confirmed tool schema (zero-arg) and dispatch case (`await sendBusinessInvite(...); return '';`) |
| `package.json` | `qrcode`, `sharp` as regular deps; `@types/qrcode` as devDep | ✓ VERIFIED | Grepped package.json — `"qrcode": "^1.5.4"` and `"sharp": "^0.35.3"` in dependencies, `"@types/qrcode": "^1.5.6"` in devDependencies; confirmed both packages physically installed in `node_modules` at matching versions (0.35.3 / 1.5.4) |
| `Dockerfile` | Runtime stage installs `fontconfig` + `fonts-dejavu-core`, build stage untouched | ✓ VERIFIED | Read in full — the `RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core ...` line is present only in the second (runtime) `FROM node:20-bookworm-slim` stage, placed after `ENV NODE_ENV=production` and before `COPY package.json`; the first (build) stage is unchanged |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `handleMenuCallback` (`invite` case) | `handleInviteGeneration` → `sendBusinessInvite` → `getMeBotInfo` + `generateInviteImageBuffer` + `sendTelegramPhoto` | Direct function calls | ✓ WIRED | Full chain read and confirmed in source; failure path fully contained (try/catch, Greek error message, still sends back-to-menu keyboard) |
| `executeOwnerTool` (`send_invite` case) | `sendBusinessInvite` (same function, D-03) | Direct function call, no local try/catch (relies on outer catch) | ✓ WIRED | Confirmed identical call target as admin-menu path; outer catch confirmed at line ~887 |
| Ambient `botTokenStore` context (webhook dispatch) | `sendTelegramPhoto`'s Telegram API call | `botTokenStore.getStore()` read at top of `sendTelegramPhoto` | ✓ WIRED | No new `botTokenStore.run` wrapping introduced by this phase, as specified; guard throws a clear error if store is empty, matching `callTelegramApi`'s pattern |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| Composed invite PNG | `imageBuffer` | Real (unmocked) `qrcode.toBuffer` + `sharp` composite pipeline, independently re-executed by this verifier | Yes — 18537-byte real PNG, verified byte-identical to orchestrator's independent run, viewed directly | ✓ FLOWING |
| Caption text | `caption` | Built from `botInfo.username` (live `getMeBotInfo` call against `business.botToken`) — no hardcoded/static fallback | Yes — deep link matches the QR-decoded payload exactly | ✓ FLOWING |
| `business` object passed to `handleInviteGeneration`/`executeOwnerTool` | N/A | Webhook-scoped HMAC-verified business object (admin-menu) / per-request business object (free-chat) — no hardcoded empty object at any call site | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `generateInviteImageBuffer` produces a real, valid PNG with correct Greek/Latin glyphs and literal `&` | Ran real (unmocked) `generateInviteImageBuffer('t.me/testbot', 'Το Studio Ρυθμός & Χορός', 'Κάντε κράτηση τώρα!')` via `npx tsx`, viewed output PNG | 18537-byte PNG, byte-identical to orchestrator's independent report; visually confirmed legible Greek + Latin glyphs, literal `&`, valid-looking QR | ✓ PASS |
| QR content matches the deep link exactly | Decoded the generated PNG with `jsQR` against raw pixel data | Decoded to `t.me/testbot` — exact match | ✓ PASS |
| Full test suite for this phase's files | `npx jest --testPathPattern="(invite\|telegram-client\|admin-menu)" --testTimeout=20000` | 4 suites, 41/41 tests passed | ✓ PASS |
| TypeScript compiles cleanly | `npx tsc --noEmit` | Zero errors | ✓ PASS |
| `qrcode`/`sharp` physically installed at declared versions | `node -e "require('./node_modules/sharp/package.json').version..."` | sharp 0.35.3, qrcode 1.5.4 — match package.json | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files exist in this project and none are referenced by this phase's PLAN/SUMMARY. Step 7c: SKIPPED (no probes declared or conventional).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|-------------|--------------|--------|----------|
| INVITE-01 | 25-01-PLAN.md | Owner can request an invite: one message with QR image (business name + Greek CTA composed into pixels) + raw `t.me/<bot_username>` deep link as copyable plain text, reachable via admin menu and free chat | ✓ SATISFIED | All supporting truths above verified against source; both trigger paths confirmed wired to the same shared function; real (unmocked) image generation and QR decode independently reproduced |

No orphaned requirements — REQUIREMENTS.md maps only INVITE-01 to Phase 25, and it is claimed by 25-01-PLAN.md's `requirements` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | Grepped `src/invites/generator.ts`, `src/telegram/client.ts`'s new `sendTelegramPhoto`, the admin-menu and ai-owner-agent additions for `TODO`/`FIXME`/`TBD`/`XXX`/`HACK`/`PLACEHOLDER`/"not yet implemented" — zero hits. No hardcoded empty-array/object stub patterns in any new code path; `business` object flows through real, non-hollow call sites in both trigger wirings. |

No blockers, no warnings.

### Human Verification Required

### 1. Physical QR scan against a live deployed bot

**Test:** Deploy (or use an existing live) bot, trigger an invite via either the admin menu button or free-chat tool, and scan the resulting QR code with a real phone camera.
**Expected:** The phone's Telegram app opens the correct bot's chat — the same bot whose `t.me/<bot_username>` appears as plain text in the same message's caption.
**Why human:** Requires a live bot token, a physical device with a camera, and the real Telegram app — genuinely cannot be automated in this sandbox. This is the single manual-only item PLAN.md's own `<verification>` block flags (font-rendering-in-deployed-container concern was independently resolved via a local Docker build reproduction by the orchestrator, corroborated in spirit — though not re-run by this verifier — by this verifier's own byte-identical unmocked smoke test of the underlying image-composition function).

### Gaps Summary

No gaps found. All 9 merged must-have truths (roadmap's 3 Success Criteria plus 6 plan-specific truths) are verified directly against the actual source files — not inferred from SUMMARY.md claims. Independent re-execution of the real (unmocked) `generateInviteImageBuffer` function reproduced an identical 18537-byte PNG to the orchestrator's separately-reported result, and independent QR decoding confirmed the encoded link exactly matches the caption's plain-text deep link. The full test suite (41 tests) and `tsc --noEmit` were both independently re-run by this verifier, not merely re-quoted from SUMMARY.md. The only outstanding item is the physical-phone QR-scan confirmation, which is legitimately human-only and does not block phase completion — it routes this verification to `human_needed` rather than `passed`.

---

_Verified: 2026-07-27_
_Verifier: Claude (gsd-verifier)_
