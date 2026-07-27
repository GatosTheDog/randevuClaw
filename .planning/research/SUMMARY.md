# Project Research Summary: RandevuClaw v1.7 UX & Trust Polish

**Project:** RandevuClaw (Telegram-native appointment booking for Greek service businesses)
**Domain:** Chat-bot UX polish, compliance fixes, and owner-experience improvements
**Researched:** 2026-07-28
**Confidence:** HIGH (all 4 research areas high/consistent)

## Executive Summary

The v1.7 roadmap is a **targeted polish phase focused on 15 UX/compliance fixes** across Telegram UI, owner menu discoverability, booking list clarity, and GDPR consent timing. **Key finding: zero new production dependencies required.** All 15 items are achievable with the existing stack (Telegraf, Drizzle, Express, Google Gemini) and leverage established patterns from v1.6 Phase 22's approval workflow architecture.

The research identifies this as a **"credibility phase"** — most items are table stakes (confirmation dialogs, menu discoverability, consent timing) that signal a polished, compliant product. Two items are differentiators (reschedule-approval stricter control, fuzzy name lookup), and two are dead features that should be removed entirely. **Critical finding:** The main reliability concern (Telegram menu button caching) is **client-side browser behavior, not a backend architecture issue** — mitigation is documentation and optional manual refresh, not code restructuring.

**Roadmap complexity:** ~43–57 hours estimated effort; straightforward sequencing with 5–6 phases organized by dependency (foundation → menus → booking clarity → compliance → advanced). **Highest risk:** reversing reschedule approval design without careful in-flight data migration; **mitigation: implement confirmation-policy foundation first (Phase 1), then reschedule reversal (Phase 2).**

---

## Key Findings

### Recommended Stack

**No new dependencies required for v1.7.** All 15 items are implementable with the existing stack:

**Core technologies (unchanged):**
- **Telegraf** (4.16.3): Message routing, callback query handling — sufficient for all 15 features
- **Drizzle ORM** (0.45.2): Database queries, RLS context threading — already supports client-lookup queries for item 8 (name matching)
- **Express** (5.2.1): Webhook server for per-business bot dispatch — no changes needed
- **@google/genai** (2.10.0): Gemini tool-calling for owner agent — function definitions already flexible for string-based arguments
- **zod** (4.4.3): Runtime validation — validates tool arguments and consent state

**Optional addition (Phase 2+, if testing warrants):**
- **fuse.js** (~10 KB, zero dependencies): Fuzzy string matching for Greek name typos/accents. Only needed if Phase 2 testing reveals false-negatives on name-based client lookup (item 8).

**Why zero new deps:** All 15 items reuse established patterns from v1.6 (substring matching with `.toLowerCase().includes()`, inline keyboard callbacks, session approval cascade from Phase 22, schema flags for consent). The stack was designed for flexibility; no architectural gaps emerged.

---

### Expected Features: 15 Items in 4 Categories

Research across production chat-bot and scheduling platforms (Wix, Calendly, DaySchedule, Skedda, HighLevel, HubSpot, Zoho, Acuity) identifies clear **table stakes vs. differentiators**:

**Must have (table stakes):**
- **Confirmation dialogs on destructive actions** (item 9) — Standard UX best practice across all production platforms
- **Service/class names in booking lists** (item 14) — Multi-service context essential
- **Past-time slot filtering** (item 2) — Prevent booking expired slots
- **Contextual confirmation prompts** (item 3) — Show service/date, not raw IDs
- **Menu-accessible high-frequency actions** (items 6, 7) — Payment, setup must be discoverable (35% user abandonment if chat-only)
- **Back-to-menu error recovery** (item 5) — Handle stale button taps gracefully
- **GDPR consent on first contact** (item 11) — Greek law compliance requirement
- **Real client opt-in flow** (item 12) — Explicit acceptance, not implicit
- **Consistent menu button behavior** (item 13) — Expected in Telegram
- **Hidden buttons for non-applicable flows** (item 15) — Clarity on open_slots businesses

**Should have (differentiators):**
- **Approval required on reschedules** (item 10) — Stricter than most competitors
- **Fuzzy name-based lookup** (item 8) — UX improvement over numeric ID copy-paste

**Remove entirely:**
- **Non-functional "reply to client" button** (item 1) — Erodes trust; either implement or remove
- **Decorative "Νέο μάθημα (chat)" button** (item 4) — No-op button signals incompleteness

---

### Architecture Approach

The 15 items integrate as **mostly localized surface-layer changes** with three strategic considerations:

1. **Confirmation-policy standardization (item 9)** must precede menu changes. Shared constants in `src/utils/greek-messages.ts` (no global helper due to callback-naming differences per file).

2. **Reschedule approval (item 10)** fully reuses Phase 22's existing `sbk:approve/<id>` capacity-hold cascade. Single change: remove explicit `'confirmed'` status parameter in `rescheduleSessionTool`. **No new state machine, no schema changes.**

3. **Consent-timing gap (item 11)** requires moving `getOrCreateClientRelationship()` call earlier in `handleFoundBusiness`, but **zero schema changes beyond repurposing existing `consentGiven` column** (default `true` → `false`, backfill existing rows to `true`).

**No new database tables. No new RLS policies.** All affected tables already guarded by `withBusinessContext`.

---

### Critical Pitfalls & Prevention

1. **State machine races on confirmation-policy refactoring (item 9)**
   - Risk: Concurrent admin actions (delete + confirm simultaneously) cause double-deduction, ghost notifications, negative capacity
   - Prevention: Use `SELECT FOR UPDATE` + database idempotency keys; test double-click scenarios explicitly
   - Phase ordering: Item 9 must be Phase 1

2. **Reversing reschedule approval with in-flight data (item 10)**
   - Risk: Old reschedules exist with status="confirmed"; new approval filter shows only `pending_owner_approval`, making old data invisible. Results: double-booked slots, orphaned approvals
   - Prevention: Pre-rollout migration upserts approval-requests for old reschedules; dual-state query; capacity-hold relock verification
   - Phase ordering: Item 10 must be Phase 2 (after item 9)

3. **GDPR consent-timing race in multi-tenant RLS (item 11)**
   - Risk: Thread A shows consent notice; Thread B processes action before A's upsert completes. Result: action without consent, GDPR Article 7 breach
   - Prevention: Atomic upsert (`INSERT ... ON CONFLICT ... DO UPDATE`); RLS context before query; SERIALIZABLE isolation; backfill before deploy
   - Phase ordering: Item 11 should be Phase 1 alongside item 9

4. **Fuzzy name-matching ambiguity (item 8)**
   - Risk: Multiple clients share similar names; fuzzy match picks wrong one for deletion
   - Prevention: Multi-option confirmation UI (show top-N matches); full-record confirmation before destructive action; require explicit ID if confidence < 85%
   - Phase ordering: Item 8 must be Phase 3 (after confirmation foundation)

5. **Telegram menu-button caching (item 13) — MODERATE**
   - Risk: Clients cache command list ~5 minutes; new menu button won't appear until cache expires
   - Prevention: Call `deleteMyCommands` before `setMyCommands`; always specify scope + language-code
   - Note: **Client-side caching, not backend issue.** Mitigation is documentation + optional `/refresh_menu` command, not code restructuring

---

## Implications for Roadmap

### Phase 1: Confirmation Foundation & Early Consent (Items 9, 11)
**Rationale:** Both must precede all menu/callback refactoring. Establish uniform confirmation pattern and atomic GDPR flow.
**Delivers:** Shared Greek button constants, atomic GDPR consent flow, uniform Ναι/Όχι policy.
**Addresses:** Table stakes: confirmation dialogs, GDPR consent timing.
**Avoids:** State machine races, consent timing race.
**Effort:** ~10–12 hrs | **Research needed?** No — patterns well-established

### Phase 2: Reschedule Approval Reversal (Item 10)
**Rationale:** Depends on Phase 1 foundation. In-flight data migration requires careful testing.
**Delivers:** Reschedules now require owner approval like new bookings; stricter control differentiator.
**Uses:** Existing Phase 22 `sbk:approve/<id>` cascade; no new state machine.
**Avoids:** Double-booked slots, orphaned approvals.
**Effort:** ~5–7 hrs | **Research needed?** No — reuses proven pattern

### Phase 3: Menu Standardization & Discoverability (Items 3, 6, 7, 9 refactor)
**Rationale:** Depends on Phase 1 constants. Low risk; reuses existing handlers.
**Delivers:** Admin menu buttons for payment + setup; contextual prompts; menu-accessible high-frequency actions.
**Addresses:** Table stakes: menu discoverability, contextual confirmations.
**Effort:** ~12–15 hrs | **Research needed?** No — UI patterns established

### Phase 4: Booking List & Schema Clarity (Items 2, 3, 14, 15, 12)
**Rationale:** Independent work; includes schema prep for Phase 5's consent gate.
**Delivers:** Service names in booking lists; past-time slot filtering; button hiding; consent schema ready.
**Addresses:** Table stakes: booking clarity, hidden buttons.
**Effort:** ~8–12 hrs | **Research needed?** No — standard SQL operations

### Phase 5: Advanced Consent & Fuzzy Matching (Items 8, 11 gate finalization, 13)
**Rationale:** Depends on Phases 1–4. Most research-heavy; includes live Telegram testing.
**Delivers:** Name-based client lookup; Telegram menu retry + documentation; live testing results.
**Addresses:** Differentiator: fuzzy lookup; table stakes: menu reliability.
**Avoids:** Wrong-client deletions via ambiguous fuzzy match.
**Effort:** ~10–15 hrs | **Research needed?** YES — Item 13 requires live Telegram testing; item 8 needs false-positive testing

### Phase 6 (Optional): Dead Features Cleanup (Items 1, 4)
**Rationale:** Low risk; can run in parallel or as final polish.
**Delivers:** Removal of non-functional buttons.
**Effort:** ~1–2 hrs | **Research needed?** No — deletions only

### Phase Ordering Rationale
- **Phase 1** unblocks all others; shared constants and atomic consent affect core paths
- **Phase 2** must follow Phase 1 to ensure confirmation stability before reschedule reversal
- **Phase 3** reuses Phase 1 constants; typically batched after confirmation foundation
- **Phase 4** can run parallel with Phase 3 (independent changes); schema prep for Phase 5
- **Phase 5** depends on all prior phases; most learning potential and research-heavy
- **Phase 6** parallelizable cleanup anytime

**Total effort distribution:** ~43–57 hours

### Research Flags

**Phases needing research during `/gsd-plan-phase`:**
- **Phase 5 (Item 13):** Telegram persistent menu button reliability requires live testing with real Telegram accounts (iOS, Android, web clients). Recommend spike: 2–3 hrs. Risk: hidden platform limitations or deployment regressions.
- **Phase 5 (Item 8):** Fuzzy name matching false-positive edge cases. Recommend corpus: 20–30 test Greek names with expected rankings. Risk: wrong-match deletions if threshold not tuned.

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Atomic postgres operations + Telegraf routing — well-established patterns; no spike needed
- **Phase 2:** Reschedule reuses Phase 22 sbk:approve cascade — proven in production; migration straightforward
- **Phase 3:** Menu button UI + inline keyboard callbacks — v1.6 patterns established; no research spike
- **Phase 4:** SQL date filtering + schema backfill — standard postgres operations; no research spike

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | All 15 items verified against existing codebase patterns; substring matching established since v1.4; zero new deps required across all items |
| **Features** | HIGH | Production sources (15+ platforms: Wix, Calendly, DaySchedule, Skedda, HighLevel, etc.) show consistent table stakes; FEATURES.md research across 50+ sources |
| **Architecture** | HIGH | Reschedule reuses Phase 22 sbk:approve (no new state machine); consent gap is ~50-line check move + atomic upsert; no new RLS policies or tables |
| **Pitfalls** | MEDIUM-HIGH | 4 critical pitfalls with documented prevention strategies; one phase-specific research needed (Telegram testing). Gaps require validation during implementation. |

**Overall confidence: HIGH** (stack, features, architecture fully researched with production validation; pitfalls have clear prevention; one phase-specific research needed for Telegram menu testing).

### Gaps to Address During Planning

1. **Telegram menu persistence (item 13):** Live testing with real accounts across iOS, Android, web clients; verify caching behavior and workarounds
2. **Fuzzy name matching false-positives (item 8):** Create test corpus of Greek names with intentional typos/accent variations; define confidence threshold
3. **In-flight reschedule migration (item 10):** Verify backfill strategy with test DB; check if capacity holds exist for old reschedules
4. **GDPR consent backfill (item 11):** Count existing relationships with null `consentGiven`; verify SERIALIZABLE isolation with concurrent callbacks
5. **Fuzzy matching UX decision (item 8):** Define during Phase 5 plan: Show "Did you mean?" with options, or require exact phone/ID if confidence < 85%?

---

## Sources

### Primary (HIGH confidence)

- **STACK.md research (2026-07-28):** Verified against Telegraf official docs (4.16.3), Drizzle ORM codebase patterns, @google/genai migration guide, Telegram Bot API docs, Fuse.js documentation
- **FEATURES.md research (2026-07-28):** Production analysis across Wix Bookings, Calendly, DaySchedule, Skedda, Acuity Scheduling, HighLevel, HubSpot, Zoho Bookings, BookingPress, Conferbot; 50+ sources analyzed
- **ARCHITECTURE.md research (2026-07-28):** RandevuClaw codebase analysis (Phase 22 sbk:approve pattern, Drizzle schema, telegram.ts webhook routing, existing handlers)
- **PITFALLS.md research (2026-07-28):** PostgreSQL race conditions research, state machine security research, fuzzy matching in production, Telegram API issue tracking

### Secondary (MEDIUM confidence)

- GDPR compliance for Telegram bots (multiple production implementations: BossBot, Chatarmin, Conferbot)
- Telegram Bot API Command Scope Issues (GitHub discussions, official Telegram docs)
- Appointment booking UX best practices (Medium, LogRocket, UX Planet articles)

### Validation During Implementation

- Live Telegram menu persistence testing (Phase 5 spike)
- Fuzzy name matching false-positive corpus (Phase 5 testing)
- In-flight reschedule migration validation (Phase 2 testing)
- GDPR consent backfill verification (Phase 4 testing)

---

*Research synthesis completed: 2026-07-28*
*Researched by: GSD Research Synthesizer*
*Status: Ready for requirements definition and roadmap creation*
