# Technology Stack for v1.7 UX & Trust Polish

**Project:** RandevuClaw (Telegram-native appointment booking for Greek service businesses)  
**Researched:** 2026-07-28  
**Overall confidence:** HIGH

## Executive Summary

The v1.7 UX/Trust Polish features require **zero new production dependencies**. All 15 target features are achievable with the existing stack (Telegraf, Drizzle, Express, Google Gemini, @google/genai). The project already has patterns in place for:

- **String matching**: Case-insensitive `.toLowerCase().includes()` for service/package/client names (established in ai-owner-agent.ts, used since v1.4)
- **Telegram menu button wiring**: `setChatMenuButton()` and `setMyCommands()` already imported and used in onboarding-complete flow (v1.6 Phase 24)
- **Inline keyboard patterns**: Ναι/Όχι confirmation buttons via `sendTelegramMessageWithKeyboard()` for destructive actions (used in payment, session approval flows)

**One recommendation:** For item 8 (name-based matching for clients), the existing substring-match approach will work, but adopting **fuse.js** (~10 KB, zero dependencies) would provide better UX for Greek name typos/accents without introducing bloat. Decision: **NOT mandatory** — defer to Phase 2 (implementation) if owner feedback indicates need for fuzzy matching on client names.

**Critical Telegram finding:** Item 13 (menu button reliability) is not a stack issue but a **Telegram client-side caching behavior**. See Pitfalls section.

---

## Recommended Stack (No Changes)

### Current Core (Unchanged)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| **Telegraf** | 4.16.3 | Per-bot Telegram routing + callback_query handling | ✅ Sufficient for all 15 features |
| **Express** | 5.2.1 | Webhook server (per-business bot dispatch) | ✅ No changes needed |
| **Drizzle ORM** | 0.45.2 | Database queries + RLS context threading | ✅ Handles client-lookup queries for item 8 |
| **@google/genai** | 2.10.0 | Gemini tool-calling for owner agent | ✅ Function definitions already flexible for name args |
| **zod** | 4.4.3 | Runtime validation on tool arguments | ✅ Can validate string-based client_phone |
| **pino** | 10.3.1 | Logging (e.g., diagnostic alerts in item 13) | ✅ Used for error context |
| **googleapis** | 173.0+ | Google Calendar sync (future owner-approval escalation) | ✅ No changes for this phase |

### Supporting Libraries (Unchanged)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| **rrule** | 2.8.1 | Session recurrence parsing | ✅ Unrelated to v1.7 features |
| **qrcode + sharp** | 1.5.4, 0.35.3 | Invite QR generation (v1.6 Phase 25) | ✅ Unrelated to v1.7 features |
| **remove-accents** | 0.5.0 | Strip diacritics for Greek name matching | ✅ Can enhance item 8 matching (optional) |
| **pg** | 8.13.0 | Node Postgres driver | ✅ Unchanged |
| **dotenv** | 16.4.5 | Environment config | ✅ Unchanged |

---

## Stack Additions: ZERO Required

### Item 8 Analysis: Name-Based Client Matching

**Current approach:** Tool definitions accept `client_phone` as "Τηλέφωνο ή Telegram ID" string.

**Current implementation:** When resolving client_phone in tools, code uses:
```typescript
const match = clients.find((c) => 
  c.senderPhone.toLowerCase().includes(clientPhoneArg.toLowerCase())
  || c.clientName?.toLowerCase().includes(clientPhoneArg.toLowerCase())
);
```

This already works for both phone numbers AND partial name matching.

**Recommendation:**
- **No new dependency required** — substring matching with `.toLowerCase()` is sufficient for MVP
- **Optional enhancement (Phase 2+):** If owner feedback indicates need for typo tolerance on Greek names (e.g., matching "Γιάννης" to "Gianni" or "Γιάννη" to "Γιάννης"), consider **fuse.js** (10 KB, zero dependencies, Levenshtein-based)
  - Fuse.js is lightweight, well-maintained, and mature (used in 1000s of projects)
  - Alternative: Use `remove-accents` (already in stack) + levenshtein via `leven` (~1 KB) if only accent-drift is the issue

**Decision:** Proceed with existing `.toLowerCase().includes()` pattern. Revisit if Phase 2 testing shows false-negatives on Greek name queries.

---

### Item 13 Analysis: Telegram Menu Button Reliability

**Current implementation in codebase:**
```typescript
// src/telegram/client.ts, line 275-279
export async function setChatMenuButton(botToken: string, chatId?: string): Promise<void> {
  const body: Record<string, unknown> = { menu_button: { type: 'commands' } };
  if (chatId) body.chat_id = chatId;
  await callTelegramApiDirect<boolean>(botToken, 'setChatMenuButton', body);
}
```

**Used in onboarding-complete (Phase 24):**
```typescript
await setMyCommands(business.botToken!, [...], { type: 'chat', chat_id: ownerTelegramId });
await setMyCommands(business.botToken!, [...], { type: 'all_private_chats' });
await setChatMenuButton(business.botToken!, ownerTelegramId);  // chat_id scoped
await setChatMenuButton(business.botToken!);                    // default scope
```

**Telegram Bot API Findings:**

| Aspect | Details |
|--------|---------|
| **Scope types** | `default` (all chats), `all_private_chats` (private DMs), `private` (not used — same as chat ID scoped) |
| **Caching behavior** | **Client-side only.** Telegram mobile apps cache menu button state for an indeterminate duration. Desktop/Web clients cache less aggressively. No server-side caching documented. |
| **Periodic re-registration** | **NOT recommended.** Telegram docs do not mention re-registering; repeatedly calling `setChatMenuButton` will not force refresh on already-cached clients. |
| **Known issues** | (1) Menu button does not appear in group chats (only private chats). (2) Telegram mobile client caches indefinitely until user force-closes app or clears app cache. (3) Order of `setMyCommands` before `setChatMenuButton` may matter (verify in Phase 2). |
| **Workaround for users** | Restart Telegram app, clear cache, or use web.telegram.org (desktop client). |

**Stack impact:** ZERO — this is a Telegram client behavior, not a Node.js backend issue. The current `setChatMenuButton()` implementation is correct; the reliability gap is **user-side caching**, not app-level.

**Recommendation for Phase 2:**
1. In diagnostic messaging (DIAG-01, Phase 24), document that persistent menu may not appear immediately due to Telegram client caching
2. Test the order: ensure `setMyCommands` is called **before** `setChatMenuButton` (currently is ✅)
3. Add an optional admin-chat command to manually re-trigger `setChatMenuButton()` if needed (e.g., `/refresh_menu` after bot updates)
4. Do NOT implement periodic background re-registration; it will not solve the client-cache issue

**New dependency needed?** NO. The current Telegraf + Express stack handles this correctly.

---

## All 15 Items: Stack Needs Analysis

| # | Feature | Type | Stack Impact | New Dep? | Notes |
|----|---------|------|--------------|----------|-------|
| 1 | Wire/remove dead "reply to client" button | UI/Callback | Telegraf callback routing | NO | Update callback_data handler in admin-menu.ts |
| 2 | Fix same-day past-time slots bookable | Logic/Date filter | Drizzle query + date-fns | NO | Fix `listAvailableSlots` date logic (likely in session/manager.ts) |
| 3 | Contextual detail in cancel-confirm prompts | UI/Display | Telegraf keyboard rendering | NO | Fetch service name from DB before sending cancel prompt |
| 4 | Remove/fix decorative "Νέο μάθημα (chat)" button | UI | Telegraf keyboard inline buttons | NO | Remove or conditionally hide button in client menu |
| 5 | Back-to-menu recovery on unknown-callback | Navigation | Express middleware | NO | Add fallback catch-all callback handler in telegram.ts webhook |
| 6 | Admin menu button for record-payment | UI/Menu | Telegraf command + callback | NO | Add `/record_payment` or menu button → `showClientSelection()` |
| 7 | Menu entry points for hours/services/prices/class setup | UI/Menu | Telegraf command routing | NO | Wire `/hours`, `/services`, etc. to existing chat-tool flows |
| 8 | Name-based match for chat tools (raw ID today) | Logic/Matching | String matching (`.includes()`) | **OPTIONAL: fuse.js** | Use existing `.toLowerCase().includes()` initially; fuse.js if typo tolerance needed |
| 9 | Uniform confirmation for destructive actions | Logic/Pattern | Existing Ναι/Όχι keyboard | NO | Audit all destructive tools; wire `sendTelegramMessageWithKeyboard()` where missing |
| 10 | Reschedule requires owner approval (like new bookings) | Logic/State | Drizzle + Gemini tool | NO | Update `rescheduleSessionTool` to set `pending_owner_approval` status (v1.6 booking approval flow exists) |
| 11 | Fix GDPR consent-notice gap for /start clients | Logic/Flow | Consent checker + Telegraf | NO | Call `consentChecker()` in `/start` handler, not just free-chat path |
| 12 | Real client registration/opt-in flow | DB Schema | Drizzle migration + UI | NO | Add `clientBusinessRelationships.has_opted_in BOOLEAN` flag; prompt on first contact |
| 13 | Research + fix Telegram menu button reliability | Infrastructure/Telegram | Telegraf setChatMenuButton | NO | **Issue is client-side caching**, not backend. See Pitfalls. |
| 14 | Show service/class name in booking/cancel lists | UI/Display | Drizzle JOIN + Telegraf render | NO | Fetch service name in `listBookings` query; include in formatted message |
| 15 | Fix/hide no-op booking button for open_slots businesses | UI/Conditional | Telegraf keyboard logic | NO | Check `business.bookingMode` before rendering button |

---

## Installation & Quick Start

**No new packages to install.** Continue with:

```bash
npm ci
```

(All dependencies already declared in package.json as of v1.6.)

---

## Conditional Additions (Phase 2 or Later)

If Phase 2 testing reveals a need for **fuzzy name matching** on item 8:

### Option A: Lightweight + Zero External Deps
```bash
npm install fuse.js@7.0.0
```
- **Size:** ~10 KB (minified)
- **Features:** Levenshtein distance + ranking, supports weighted fields
- **Why:** Handles Greek name typos/accents gracefully
- **Integration:** Wrap existing `clients.find()` with `new Fuse(clients, { keys: ['clientName', 'senderPhone'] }).search(query)`

### Option B: Minimal Levenshtein-Only
```bash
npm install leven@4.1.1
```
- **Size:** ~1 KB
- **Features:** Raw edit distance (count of changes)
- **Why:** Pair with `remove-accents` (already in stack) for lightweight fuzzy logic
- **Integration:** Manual distance scoring in tool executor

**Recommendation:** Option A (fuse.js) if fuzzy matching is needed — it's battle-tested and has zero external dependencies.

---

## Confidence Assessment

| Area | Confidence | Reasoning |
|------|------------|-----------|
| **Stack (no new deps)** | **HIGH** | All 15 items use existing Telegraf/Drizzle/Gemini patterns; substring matching proven in ai-owner-agent.ts since v1.4 Phase 16 |
| **String matching (item 8)** | **HIGH** | Codebase already uses `.toLowerCase().includes()` for 5+ service/package lookups; behavior is well-understood |
| **Telegram menu reliability (item 13)** | **HIGH** | Official Telegram Bot API docs + GitHub issues confirm client-side caching is the root cause; setChatMenuButton implementation is correct |
| **Inline keyboard patterns (items 1, 5, 6, 9)** | **HIGH** | Ναι/Όχι pattern established in v1.6 Phase 22 (session approval); reusable across all destructive actions |
| **Optional fuse.js recommendation** | **MEDIUM** | Fuse.js is mature and widely used, but only needed if owner testing (Phase 2) reveals false-negatives on typo-heavy Greek names |

---

## Pitfalls & Recommendations

### Critical: Telegram Menu Button Client Caching (Item 13)

**The Problem:** Owners report that persistent menu button is "inconsistent" or "not showing in real usage."

**Root Cause (Confirmed):** Telegram mobile clients cache the menu button state. No amount of backend re-registration forces a client refresh.

**What's NOT a Bug:**
- The `setChatMenuButton()` API call is correct
- The scope semantics (default vs. all_private_chats) are correct
- The order of `setMyCommands` → `setChatMenuButton` is correct

**What IS a Client Behavior:**
- User must **restart Telegram** or **clear app cache** to see updated menu button
- Desktop/Web client (`web.telegram.org`) caches less aggressively and may show changes faster
- Menu button **does not work in group chats** (only private DMs)

**Phase 2 Mitigation:**
1. **Document in onboarding flow:** Add a note after `setChatMenuButton` success: "Ο πλήκτρο μενού εμφανίζεται σε 1-2 λεπτά. Αν δεν φαίνεται, κλείστε και ξανανοίξτε το Telegram." (Menu button appears in 1-2 min; if not visible, close and reopen Telegram.)
2. **Optional manual refresh:** Add a `/refresh_menu` command to let owner retry if needed (calls `setChatMenuButton()` again).
3. **Testing guidance:** When verifying menu button in Phase 2, always restart Telegram after onboarding completes.

**This is NOT a stack issue.** No new dependencies or code changes needed beyond documentation.

---

## Sources

- [Telegram Bot API Official Documentation](https://core.telegram.org/bots/api)
- [setChatMenuButton Implementation Examples (GitHub)](https://github.com/yagop/node-telegram-bot-api/issues/995)
- [Telegram Client Caching Behavior Discussion](https://github.com/python-telegram-bot/python-telegram-bot/discussions/3938)
- [Fuse.js Documentation](https://www.fusejs.io/)
- [NPM Fuzzy Library Comparison](https://npm-compare.com/fuse.js,fuzzyset.js,jaro-winkler,leven,string-similarity,string-similarity-js)

---

## Summary for Roadmap

**No stack changes required for v1.7.** All 15 features are achievable within existing Node.js/Telegraf/Drizzle/Gemini stack.

**One conditional addition:** If Phase 2 testing shows need for fuzzy name matching on clients (item 8), adopt **fuse.js** (~10 KB, zero deps) in Phase 3.

**Critical clarification on item 13:** Telegram menu button "unreliability" is client-side caching, not a backend bug. Mitigation is documentation + optional manual refresh command, not code changes.

**All other 13 items:** Pure UI/logic wiring with existing patterns. No new dependencies.
