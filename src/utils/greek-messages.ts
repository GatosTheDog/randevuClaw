// Phase 26 (CONF-01, D-07): centralizes Greek button-label strings for the
// confirm-before-mutate call sites this phase adds across the 5 CONF-01
// destructive owner actions. Per D-07 this file holds button-label strings
// ONLY — no prompt-template functions. callback_data conventions stay
// independent per file (menu:<action>, cmenu:<action>, sbk:<approve|reject>,
// otc:<action>), a shared confirmation-keyboard helper was explicitly
// rejected to avoid unwanted coupling between files with different
// callback_data shapes.
//
// APPROVE/REJECT are the EXACT strings already in production since Phase 22
// (client-menu.ts's sbk:approve/reject keyboard, function-executor.ts) — this
// file does not replace those existing call sites, it only gives new call
// sites (this plan's confirmation keyboards) a single source to import the
// same literal from, preventing future drift between the two.
export const CONFIRM_LABELS = {
  DELETE: 'Διαγραφή',
  CONFIRM: 'Επιβεβαίωση',
  APPROVE: 'Έγκριση',
  REJECT: 'Απόρριψη',
  CANCEL: 'Άκυρο',
} as const;

// Phase 27 (COMP-01/COMP-02, D-01): client-facing consent/registration
// accept-decline labels. Kept SEPARATE from CONFIRM_LABELS above — different
// audience (client-facing, not owner-facing) and a different callback_data
// convention (consent:yes/consent:no vs otc:.../menu:...). Merging them would
// couple two unrelated keyboards that happen to share the same Greek words.
export const CONSENT_LABELS = {
  ACCEPT: 'Ναι',
  DECLINE: 'Όχι',
} as const;

// Phase 29 (D-07): shared back-menu button labels. Consolidates admin-menu.ts's
// 11+ inline repeats of the ADMIN string and reconciles client-menu.ts's two
// previously-inconsistent client-side strings ('« Πίσω' and '« Αρχικό μενού')
// down to one ('« Πίσω'). Wave 2 plans of Phase 29 (29-03 telegram.ts, 29-04
// admin-menu.ts, 29-05/29-06 client-menu.ts) import and use this constant
// instead of any inline literal, including replacing their own file's existing
// inline occurrences while they're already touching those functions for other
// reasons this phase. Per this file's documented scope (see top-of-file
// comment), this is button-label strings ONLY — no prompt-template function or
// shared confirmation-keyboard helper is added here.
export const BACK_MENU_LABELS = {
  ADMIN: '« Πίσω στο Μενού',
  CLIENT: '« Πίσω',
} as const;
