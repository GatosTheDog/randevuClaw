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
