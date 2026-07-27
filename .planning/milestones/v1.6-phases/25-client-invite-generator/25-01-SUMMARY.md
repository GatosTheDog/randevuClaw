---
phase: 25-client-invite-generator
plan: 01
subsystem: bot-ops
tags: [qrcode, sharp, telegram, gemini-function-calling, svg]

# Dependency graph
requires:
  - phase: 17-admin-menu
    provides: showAdminRootMenu/handleMenuCallback dispatcher this plan extends with a 3rd keyboard row
  - phase: 16-per-bot-foundation
    provides: botTokenStore ambient context and per-business botToken already established for the outbound Telegram call paths this plan reuses
provides:
  - "generateInviteImageBuffer/sendBusinessInvite (src/invites/generator.ts) — QR + text-into-pixels invite image composition and single shared orchestration function"
  - "sendTelegramPhoto (src/telegram/client.ts) — multipart/form-data Telegram sendPhoto helper"
  - "Admin menu 'Πρόσκληση Πελάτη' button + handleInviteGeneration wiring"
  - "Free-chat send_invite Gemini tool wired into OWNER_TOOLS/executeOwnerTool"
affects: [client-onboarding, telegram-admin-menu, ai-owner-agent]

# Tech tracking
tech-stack:
  added: ["qrcode@^1.5.4", "sharp@^0.35.3", "@types/qrcode@^1.5.6"]
  patterns:
    - "Single shared orchestration function (sendBusinessInvite) called identically from both an admin-menu callback handler and a Gemini function-calling tool case, avoiding divergent trigger-path behavior"
    - "sharp SVG-composite-over-canvas pattern for baking user-visible text into rasterized image pixels (header/QR/footer stacked composite), with escapeXml() applied to all interpolated strings before SVG template interpolation"
    - "sendTelegramPhoto mirrors callTelegramApi's botTokenStore guard/AbortSignal.timeout/logging shape but uses multipart FormData + Blob instead of JSON, since Telegram's sendPhoto endpoint requires multipart upload"

key-files:
  created:
    - src/invites/generator.ts
    - tests/invites/generator.test.ts
    - tests/ai-owner-send-invite.test.ts
  modified:
    - package.json
    - package-lock.json
    - Dockerfile
    - src/telegram/client.ts
    - src/telegram/handlers/admin-menu.ts
    - src/onboarding/ai-owner-agent.ts
    - tests/telegram-client.test.ts
    - tests/admin-menu.test.ts

key-decisions:
  - "D-01 (locked, from PLAN.md): qrcode + sharp as regular dependencies (not devDependencies) — runtime Docker stage runs npm ci --omit=dev and only copies dist/"
  - "Dockerfile runtime stage installs fontconfig + fonts-dejavu-core so sharp/librsvg can rasterize Greek + Latin glyphs — build stage untouched"
  - "escapeXml() applied to both businessName and greekCTA before SVG interpolation (T-25-01), even though greekCTA is always a fixed app-authored string — uniform defense-in-depth"
  - "sendBusinessInvite is the single call site for both trigger paths (admin menu, free-chat AI tool) — zero duplicated Greek copy or deep-link construction (D-03)"

patterns-established:
  - "Any future Telegram media-send helper (video, document) should follow sendTelegramPhoto's multipart FormData pattern rather than trying to extend the JSON-only callTelegramApi helper"

requirements-completed: [INVITE-01]

coverage:
  - id: D1
    description: "generateInviteImageBuffer composes a QR code + business name + Greek CTA into rasterized PNG pixels via qrcode + sharp, with XML-escaping of user-controlled businessName (T-25-01)"
    requirement: "INVITE-01"
    verification:
      - kind: unit
        ref: "tests/invites/generator.test.ts#generateInviteImageBuffer"
        status: pass
    human_judgment: true
    rationale: "Automated tests mock sharp/qrcode entirely and cannot prove real glyph rendering or that the Dockerfile font install actually renders legible Greek/Latin text in a deployed container — flagged as the one manual-only verification step in PLAN.md's <verification> block."
  - id: D2
    description: "sendBusinessInvite derives t.me/<bot_username> via a fresh getMeBotInfo call on this business's own bot token and sends exactly one Telegram photo with the deep link as copyable caption text"
    requirement: "INVITE-01"
    verification:
      - kind: unit
        ref: "tests/invites/generator.test.ts#sendBusinessInvite"
        status: pass
    human_judgment: false
  - id: D3
    description: "sendTelegramPhoto POSTs a multipart FormData body (chat_id, photo, optional caption) to Telegram's sendPhoto endpoint, mirroring callTelegramApi's guard/timeout/logging shape"
    verification:
      - kind: unit
        ref: "tests/telegram-client.test.ts#Test 11-14 (sendTelegramPhoto)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Admin menu 'Πρόσκληση Πελάτη' button (3rd keyboard row) routes through handleMenuCallback to handleInviteGeneration, which calls sendBusinessInvite and always sends a back-to-menu keyboard, containing any failure with a Greek error message"
    requirement: "INVITE-01"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#handleMenuCallback — invite action"
        status: pass
    human_judgment: false
  - id: D5
    description: "Free-chat send_invite Gemini tool (zero-arg) wired into OWNER_TOOLS/executeOwnerTool, calling the exact same sendBusinessInvite function as the admin-menu path with zero duplicated logic"
    requirement: "INVITE-01"
    verification:
      - kind: unit
        ref: "tests/ai-owner-send-invite.test.ts"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-27
status: complete
---

# Phase 25 Plan 01: Client Invite Generator Summary

**QR + text-into-pixels business invite generator (qrcode + sharp SVG composition) wired into both the admin menu and free-chat Gemini tool-calling, sharing one orchestration function and a new multipart sendTelegramPhoto client helper.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments

- `src/invites/generator.ts`: `generateInviteImageBuffer(deepLink, businessName, greekCTA)` composes a QR code (via `qrcode`) plus header/footer SVG text (escaped, rendered via `sharp` + DejaVu Sans) into a single flat PNG buffer; `sendBusinessInvite(business, chatId)` is the single shared orchestration entry point for both trigger paths
- `src/telegram/client.ts`: new `sendTelegramPhoto(chatId, photoBuffer, caption?)` — multipart/form-data `sendPhoto` call mirroring the existing `callTelegramApi` guard/timeout/logging shape
- Admin menu: `showAdminRootMenu` gained a 3rd keyboard row ('Πρόσκληση Πελάτη' → `menu:invite`); `handleMenuCallback` routes it to new `handleInviteGeneration`, which fully contains any failure (Greek error message + still-working back-to-menu button)
- Free-chat: `OWNER_TOOLS` gained a zero-arg `send_invite` tool; `executeOwnerTool`'s `send_invite` case is a single `await sendBusinessInvite(...); return '';` relying entirely on the existing outer try/catch
- `package.json`/`Dockerfile`: `qrcode` + `sharp` added as regular dependencies (not devDependencies, per D-01 since the runtime Docker stage runs `npm ci --omit=dev`); runtime stage now installs `fontconfig` + `fonts-dejavu-core` so sharp/librsvg can rasterize Greek + Latin glyphs

## Task Commits

Each task was committed atomically:

1. **Task 1: QR + text-into-pixels image composition, sendTelegramPhoto, new deps** - `de95f65` (feat)
2. **Task 2: Admin menu trigger (D-03: menu entry point)** - `edc964d` (feat)
3. **Task 3: Free-chat AI-owner-agent trigger (D-03: send_invite tool)** - `db9a302` (feat)

_Note: package-lock.json changes from `npm install` are included in Task 1's commit since they are a direct consequence of that task's package.json edit._

## Files Created/Modified

- `src/invites/generator.ts` - `generateInviteImageBuffer`, `sendBusinessInvite`, private `escapeXml` helper
- `src/telegram/client.ts` - new `sendTelegramPhoto` export
- `src/telegram/handlers/admin-menu.ts` - 3rd keyboard row + `handleInviteGeneration` + dispatcher case
- `src/onboarding/ai-owner-agent.ts` - `send_invite` tool schema + `executeOwnerTool` case
- `package.json` / `package-lock.json` - `qrcode`, `sharp` (deps), `@types/qrcode` (devDep)
- `Dockerfile` - runtime stage font install
- `tests/invites/generator.test.ts` - new test file (7 tests)
- `tests/telegram-client.test.ts` - 4 new `sendTelegramPhoto` tests
- `tests/admin-menu.test.ts` - keyboard-shape test updated + 2 new invite-dispatch tests
- `tests/ai-owner-send-invite.test.ts` - new test file (3 tests)

## Decisions Made

- D-01 (locked, carried from PLAN.md): `qrcode`/`sharp` as regular dependencies, `@types/qrcode` as devDependency — verified via the plan's Package Legitimacy Audit before this execution began
- `escapeXml()` applied uniformly to both `businessName` and `greekCTA` before SVG interpolation, even though `greekCTA` is always an app-authored fixed string — cheap, verifiable defense-in-depth (T-25-01)
- `sendBusinessInvite` is the sole call site for both trigger paths — no duplicated Greek copy or deep-link construction between the admin-menu and free-chat entry points (D-03)

## Deviations from Plan

None - plan executed exactly as written. `npm install` was run once after the package.json edit (per the orchestrator's explicit note) before Task 1's verify command, and confirmed both `sharp` and `qrcode` load correctly via a smoke-test `require()` call.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The Dockerfile change (fontconfig + fonts-dejavu-core) is baked into the image build and requires no manual step, though the plan's `<verification>` block flags one manual-only post-deploy check: sending a real invite to a live Telegram bot and visually confirming the QR scans to `t.me/<bot_username>` and that Greek/Latin glyphs render legibly (proving the font install took effect in the deployed container).

## Next Phase Readiness

- INVITE-01 fully implemented across both trigger paths (admin menu + free-chat)
- All 41 tests across the plan's touched files pass (`npx jest --testPathPattern="(invite|telegram-client|admin-menu)" --testTimeout=20000`)
- No regressions in existing `ai-owner-agent`/`admin-menu` test suites
- Ready for the v1.6 milestone's remaining phase(s), if any, or milestone close

---
*Phase: 25-client-invite-generator*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 11 claimed created/modified files found on disk; all 3 task commit hashes (`de95f65`, `edc964d`, `db9a302`) found in git log.
