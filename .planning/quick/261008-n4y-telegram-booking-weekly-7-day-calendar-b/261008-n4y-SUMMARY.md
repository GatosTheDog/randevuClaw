---
status: complete
---
# Summary
Added `buildWeekGridRows` (date-picker.ts); client date step now shows weekday header + one row of 7 buttons per week across the 30-day window. Days with sessions show day number (1st of month shows D/M) and open the session list; others are inert "·". `cmenu:book:none` is a no-op and the webhook skips keyboard stripping for it. New test file added; no regressions (15 pre-existing failures unrelated).
