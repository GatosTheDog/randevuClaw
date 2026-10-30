---
status: awaiting_human_verify
trigger: "Όταν πατάνε κράτηση κλπ μετα βγάζει στις επιλογές "θες και τις υπόλοιπες ωρες ;"και μπερδεύονται και πατάνε ναι και κλείνουν κάθε ωρα την ίδια ημερομηνία"
created: 2026-10-30
updated: 2026-10-30
---

## Symptoms
- expected: After client books a session, flow ends cleanly (or repeat-offer is clear and does not cause accidental extra bookings).
- actual: After booking, bot offers "want the remaining hours too?" (weekly repeat / other times prompt). Clients get confused, press yes, and end up booking every hour slot of the same date.
- errors: none reported
- timeline: likely since recent commits 7bf5baa / f5fa7c1 (book upcoming weekly repeats of a session in one tap; pick specific future dates)
- reproduction: Telegram client books a session -> repeat offer prompt -> press yes -> multiple bookings on same date

## Current Focus
hypothesis: H1 - CONFIRMED by code trace. The confirm screen (showBookConfirm) shows two stacked "Ναι" buttons; the second ("Ναι, και τις επόμενες N", cmenu:book:series:<id>) books base + up to 4 more sessions immediately in one tap with no further confirmation. Clients who read it as a plain "yes" create N+1 bookings (N+1 owner approval requests, N+1 credits deducted).
test: (done) read showBookConfirm + handleBookSeriesExecute + dispatcher; existing test asserts keyboard = [yes, series, pick, root]
expecting: (met) keyboard has 2 "Ναι..." buttons, series button books immediately
next_action: implement fix in src/telegram/handlers/client-menu.ts: plain Ναι/Όχι + one neutral "Κράτηση και για άλλες ημερομηνίες" row opening the picker; add "Επιλογή όλων" to picker; route stale cmenu:book:series taps to the picker (pre-selected, still needs explicit Κράτηση); update tests/client-menu-series.test.ts; run jest
reasoning_checkpoint:
  hypothesis: "The repeat prompt causes accidental multi-bookings because showBookConfirm renders a second 'Ναι, και τις επόμενες N' button directly under 'Ναι, μόνο αυτό' and that button books base + up to 4 later sessions immediately (handleBookSeriesExecute) with no further confirmation."
  confirming_evidence:
    - "client-menu.ts:321-332 builds [Ναι, μόνο αυτό][Ναι, και τις επόμενες N][Επιλογή...][Όχι] and the body text is a yes/no question followed by an offer statement."
    - "client-menu.ts:971-977 dispatches cmenu:book:series straight to handleBookSeriesExecute, which loops bookOneInstance over base + extras (one owner approval + one credit deduction each) and then reports 'Στάλθηκαν ... N αιτήματα'."
    - "The prompt is shown on every booking for any business with allowMultiBooking=true (default false, owner toggles 'Πολλαπλές κρατήσεις'), so every client of such a business sees it."
    - "Existing test 'offers series' pins the 4-button keyboard, i.e. this is the shipped behaviour in commits 7bf5baa/f5fa7c1."
  falsification_test: "If the series button were not reachable or required a second confirmation, or if findSeriesInstances could return other hours of the same date, H1 would be wrong. Checked: neither holds (strict later-date filter, single startTime per catalog; one-tap execution)."
  fix_rationale: "Remove the one-tap bulk path so a plain 'Ναι' can only ever create ONE booking, and make repeats an explicit, separately-labelled opt-in that goes through the picker (nothing pre-selected, count shown on the final 'Κράτηση (N)' button). This removes the cause (ambiguous double-Yes + unconfirmed bulk booking) rather than just rewording it, while keeping the feature the owner asked for in 7bf5baa/f5fa7c1."
  blind_spots: "Cannot reproduce with a real Telegram client; the owner's literal 'every hour on the same date' wording is assumed to be a day/hour swap (every day at the same hour). If the owner really sees multiple different hours on the same date being booked, that would be a different mechanism (e.g. several services/catalogs, or AI-chat multi-booking) not present in this code path. Also cannot measure whether clients understand the new neutral button label."

## Eliminated
- hypothesis: H2 - genuine bug where the series returns other TIMES on the SAME date (matches the literal "κάθε ώρα την ίδια ημερομηνία")
  evidence: findSeriesInstances (client-menu.ts:268) filters `s.catalogId === base.catalogId && s.sessionDate > base.sessionDate` (strictly later date). A session_catalog has exactly one startTime and at most one active catalog per (business, service) (unique_active_catalog_per_business_service), so instances of one catalog differ by DATE only and all share the base's time. Existing test 'offers series' + 'series execute books base + extras' confirms ids 2 and 5 (later dates). So the code can never offer another hour of the same date. The owner's wording is most plausibly a day/hour swap ("every day at the same hour") which is exactly what the bulk button does.
  timestamp: 2026-10-30

## Evidence
- timestamp: 2026-10-30
  checked: grep of src for the repeat/"υπόλοιπες"/"και τις" prompts
  found: the ONLY repeat-offer prompt is client-menu.ts:321-338 (showBookConfirm). Text: "Να κρατηθεί αυτό το μάθημα;\n\nΜπορώ να κρατήσω θέση και σε επόμενες ημερομηνίες:\n• ..." with keyboard [Ναι, μόνο αυτό] [Ναι, και τις επόμενες N] [Επιλογή συγκεκριμένων ημερομηνιών] [Όχι].
  implication: this is what the owner paraphrases as "θες και τις υπόλοιπες ...;". Two buttons begin with "Ναι"; the question ("Να κρατηθεί αυτό το μάθημα;") is a yes/no question but the answer options are not mutually-clear.
- timestamp: 2026-10-30
  checked: cmenu:book:series dispatch (client-menu.ts:971) and handleBookSeriesExecute (552-613)
  found: tapping "Ναι, και τις επόμενες N" immediately books base + first SERIES_MAX_EXTRA (4) later instances sequentially via bookOneInstance, each with its own owner approval message and membership deduction. No second confirmation.
  implication: a single misread tap creates up to 5 bookings (and consumes up to 5 credits / floods owner with 5 approval requests). That is the "they press yes and end up booking all of them" symptom.
- timestamp: 2026-10-30
  checked: when the offer is shown
  found: only when business.allowMultiBooking is true (schema default false; owner toggles "Πολλαπλές κρατήσεις" in admin settings). The same flag also gates multi-booking in AI chat. The settings label gives no hint it now also injects the repeat prompt into every client booking.
  implication: the prompt appears on EVERY booking for such a business, so most clients see it, including ones who never wanted repeats.
- timestamp: 2026-10-30
  checked: parse of cmenu callback_data (webhooks/telegram.ts:713 regex) and webhook keyboard clearing (1030-1040)
  found: `cmenu:book:pick:<base>:<mask>` parses to action `book:pick:<base>` id=<mask>; picker toggles edit the keyboard in place; every other cmenu tap clears the keyboard first. A "select all" button using the same callback shape needs no webhook change.
  implication: the explicit picker can safely be the only repeat path, with an added "select all" convenience that only sets the mask (does NOT book).
- timestamp: 2026-10-30
  checked: baseline jest tests/client-menu-series.test.ts + tests/webhooks/client-menu.test.ts
  found: 109 passed before any change.
  implication: clean baseline for regression comparison.

## Resolution
root_cause: UX/design defect introduced by 7bf5baa/f5fa7c1 in showBookConfirm (src/telegram/handlers/client-menu.ts). For any business with allowMultiBooking=true, every booking confirmation showed two stacked positive buttons, "Ναι, μόνο αυτό" and "Ναι, και τις επόμενες N". The second (cmenu:book:series:<id>) bulk-booked the chosen session plus up to 4 later sessions of the same class in a single tap with no further confirmation (handleBookSeriesExecute -> bookOneInstance x N+1: N+1 owner approval requests, N+1 membership credits). Clients who read it as a plain yes created several bookings at once. Not a data/logic bug: findSeriesInstances only returns strictly later dates at the SAME time (one startTime per catalog), so the owner's "κάθε ώρα την ίδια ημερομηνία" is read as "every day at the same hour".
fix: showBookConfirm is now always the plain "Ναι"/"Όχι" pair (text "Να κρατηθεί αυτό το μάθημα;"); "Ναι" books exactly one session. When allowMultiBooking and later dates exist, ONE extra neutrally-worded row "Κράτηση και για άλλες ημερομηνίες" (not starting with "Ναι") opens the explicit picker. The one-tap bulk button and the date list in the prompt are gone. Picker: nothing pre-selected, new "Επιλογή όλων"/"Αποεπιλογή όλων" row (only sets the mask), final button shows the exact count ("Κράτηση (1 μάθημα)" / "(N μαθήματα)"), mask clamped to the candidate list, clearer instruction text. Legacy cmenu:book:series taps from old keyboards now open the picker pre-selected (needs explicit "Κράτηση") instead of bulk-booking.
verification: 5 new/updated regression tests in tests/client-menu-series.test.ts fail on the old code and pass on the new (confirm keyboard has no series button and exactly one "Ναι"; picker select-all/count/clamp; legacy series tap books nothing; plain book:yes books exactly one; picked mask books base + selected only). Targeted suites (client-menu-series + webhooks/client-menu) 115 passed. tsc --noEmit clean. Full jest: failing tests are identical before and after (12 pre-existing env/DB failures; 1 order-dependent TS2451 collision in billing-view-membership that passes in isolation 3/3). AWAITING real Telegram confirmation from the owner.
files_changed: [src/telegram/handlers/client-menu.ts, tests/client-menu-series.test.ts]
