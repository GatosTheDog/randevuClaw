---
phase: 19-class-setup-onboarding
plan: "02"
subsystem: i18n / bot-strings
tags: [i18n, greek-terminology, string-literals, bot-messages]
status: complete

dependency_graph:
  requires: []
  provides: [consistent-greek-terminology-μάθημα]
  affects:
    - src/conversation/ai-agent.ts
    - src/conversation/function-executor.ts
    - src/onboarding/ai-owner-agent.ts
    - src/scheduler/session-cancellation.ts

tech_stack:
  added: []
  patterns:
    - Pure string-literal replacement; TypeScript identifiers unchanged
    - Greek gender agreement: μάθημα (neuter/το) replacing σεζόν (French loanword)

key_files:
  created: []
  modified:
    - src/conversation/ai-agent.ts
    - src/conversation/function-executor.ts
    - src/onboarding/ai-owner-agent.ts
    - src/scheduler/session-cancellation.ts

decisions:
  - "Replaced σεζόν (French loanword) with μάθημα/μαθήματα (Greek native) in all user-visible strings"
  - "Preserved all TypeScript identifiers (session, list_sessions, book_session, etc.) unchanged — only string literals edited"
  - "Applied correct neuter gender agreement: η σεζόν → το μάθημα, τη σεζόν → το μάθημα, τις σεζόν → τα μαθήματα"

metrics:
  duration_minutes: 15
  completed_date: "2026-07-24"
  tasks_completed: 3
  files_modified: 4
---

# Phase 19 Plan 02: Greek Terminology I18N — σεζόν → μάθημα Summary

**One-liner:** Replaced every user-visible Greek σεζόν with μάθημα/μαθήματα (correct neuter gender) across 4 source files, 45 string-literal occurrences, with zero TypeScript identifier renames.

## Tasks Completed

| # | Task | Status | Commit | Files |
|---|------|--------|--------|-------|
| 1 | Replace σεζόν in ai-agent.ts tool descriptions and system prompt | Done | c050a7a | src/conversation/ai-agent.ts |
| 2 | Replace σεζόν in function-executor.ts error and confirmation messages | Done | c050a7a | src/conversation/function-executor.ts |
| 3 | Replace σεζόν in ai-owner-agent.ts and session-cancellation.ts | Done | c050a7a | src/onboarding/ai-owner-agent.ts, src/scheduler/session-cancellation.ts |

## What Changed

### src/conversation/ai-agent.ts (7 occurrences)

- `list_sessions_for_client` description: "επερχόμενες διαθέσιμες σεζόν" → "επερχόμενα διαθέσιμα μαθήματα"; "λεπτομέρειες της σεζόν" → "λεπτομέρειες του μαθήματος"
- `book_session` description: "συγκεκριμένη σεζόν" → "συγκεκριμένο μάθημα"
- `session_instance_id` property description: "ID της συγκεκριμένης σεζόν" → "ID του συγκεκριμένου μαθήματος"
- `reschedule_session` description: "κράτηση σεζόν σε διαφορετική σεζόν" → "κράτηση μαθήματος σε διαφορετικό μάθημα"; "η νέα σεζόν" → "το νέο μάθημα"
- `new_session_instance_id` property description: "ID της νέας σεζόν" → "ID του νέου μαθήματος"
- System prompt rules: "ΣΤΑΘΕΡΕΣ ΣΕΖΟΝ" → "ΣΤΑΘΕΡΑ ΜΑΘΗΜΑΤΑ"; "τις διαθέσιμες σεζόν" → "τα διαθέσιμα μαθήματα"; "ΠΟΛΛΑΠΛΕΣ σεζόν" → "ΠΟΛΛΑΠΛΑ μαθήματα"

### src/conversation/function-executor.ts (13 occurrences)

- Cutoff warning (line 356): "πριν τη σεζόν" → "πριν το μάθημα"
- Empty list (line 544): "επερχόμενες σεζόν" → "επερχόμενα μαθήματα"
- Enforcement messages (lines 587, 640 — both): "να κλείσετε σεζόν" → "να κλείσετε μάθημα"
- Missing ID (line 631): "αναγνωριστικό σεζόν" → "αναγνωριστικό μαθήματος"; "τις διαθέσιμες σεζόν" → "τα διαθέσιμα μαθήματα"
- Not found (line 647): "Η σεζόν δεν βρέθηκε" → "Το μάθημα δεν βρέθηκε … διαθέσιμο"
- Full (line 660): "Η σεζόν είναι πλήρης" → "Το μάθημα είναι πλήρες"
- Not available (line 663): "Η σεζόν δεν είναι διαθέσιμη" → "Το μάθημα δεν είναι διαθέσιμο"
- Owner alert (line 671): "Νέα κράτηση σεζόν" → "Νέα κράτηση μαθήματος"
- Wrong type (line 702): "δεν αφορά σεζόν" → "δεν αφορά μάθημα"
- Reschedule message (line 719): "Η νέα σεζόν (" → "Το νέο μάθημα ("
- Reschedule failure (line 757): "Η νέα σεζόν είναι πλήρης" → "Το νέο μάθημα είναι πλήρες"; "Η νέα σεζόν δεν είναι διαθέσιμη" → "Το νέο μάθημα δεν είναι διαθέσιμο"

### src/onboarding/ai-owner-agent.ts (22 occurrences)

Tool descriptions:
- `set_cancellation_cutoff` description + `hours` param: "πριν τη σεζόν" → "πριν το μάθημα"
- `create_recurring_session` description: "επαναλαμβανόμενη σεζόν" → "επαναλαμβανόμενο μάθημα"; "~90 ημέρες σεζόν" → "~90 ημέρες μαθήματα"
- `list_sessions` description: "τις επερχόμενες σεζόν" → "τα επερχόμενα μαθήματα"
- `cancel_session` description: "συγκεκριμένη σεζόν" → "συγκεκριμένο μάθημα"
- `cancel_session` params: "Ημερομηνία σεζόν σε μορφή YYYY-MM-DD" → "Ημερομηνία μαθήματος…"; "Ώρα σεζόν σε μορφή HH:MM" → "Ώρα μαθήματος…"
- `assign_client_to_session` description: "σε σεζόν απευθείας" → "σε μάθημα απευθείας"
- `assign_client_to_session` params: "Ημερομηνία σεζόν YYYY-MM-DD" → "Ημερομηνία μαθήματος…"; "Ώρα σεζόν HH:MM" → "Ώρα μαθήματος…"

Result strings:
- `create_recurring_session` result: "Δημιουργήθηκαν N σεζόν" → "Δημιουργήθηκαν N μαθήματα"
- `list_sessions` empty: "Δεν υπάρχουν επερχόμενες σεζόν" → "Δεν υπάρχουν επερχόμενα μαθήματα"
- `list_sessions` overflow: "ακόμα σεζόν" → "ακόμα μαθήματα"
- `cancel_session` not found (×2): "Δεν βρέθηκε σεζόν στις" → "Δεν βρέθηκε μάθημα στις"
- `cancel_session` already cancelled: "Η σεζόν στις … ήταν ήδη ακυρωμένη" → "Το μάθημα στις … ήταν ήδη ακυρωμένο"
- `cancel_session` success: "Η σεζόν στις … ακυρώθηκε" → "Το μάθημα στις … ακυρώθηκε"
- `assign_client_to_session` full: "Η σεζόν είναι γεμάτη" → "Το μάθημα είναι γεμάτο"
- `assign_client_to_session` conflict: "η σεζόν δεν είναι διαθέσιμη" → "το μάθημα δεν είναι διαθέσιμο"
- `assign_client_to_session` client notification: "στη σεζόν" → "στο μάθημα"
- `assign_client_to_session` owner return: "ορίστηκε στη σεζόν" → "ορίστηκε στο μάθημα"
- `set_booking_mode` warning: "υπάρχουσες σεζόν" → "υπάρχοντα μαθήματα"; "τις ορισμένες σεζόν" → "τα ορισμένα μαθήματα"

### src/scheduler/session-cancellation.ts (1 occurrence)

- Client broadcast: "Η σεζόν σας στις…" → "Το μάθημά σας στις…"

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — pure string-literal changes, no logic altered, no new trust boundaries introduced.

## Self-Check: PASSED

- All 4 files verified: `node` grep returns 0 hits per file
- Full-project scan: `grep σεζόν src/` returns zero matches
- `npx tsc --noEmit` passes with no errors
- Commit c050a7a: 4 files changed, 45 insertions, 45 deletions
