---
status: complete
---
# Summary
Confirm screen gains "Επιλογή συγκεκριμένων ημερομηνιών" → toggle picker (✅/⬜ per later date of same class, max 12). Selection = bitmask in callback_data (cmenu:book:pick:<base>:<mask>), keyboard edited in place (webhook skips keyboard-clear for pick toggles, passes message_id). "Κράτηση (N)" = cmenu:book:picked:<base>:<mask> books base + selected via handleBookSeriesExecute(extraInstanceIds). Also fixed two Suite C tests broken by the earlier calendar-grid change.
