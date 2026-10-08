// Phase 25.1 shared Google Calendar constants (pure, no imports).

// Bound for every Calendar and token call. The webhook transaction has
// idle_in_transaction_session_timeout of 15 s, so a hung Google call must not
// outlive it.
export const GOOGLE_API_TIMEOUT_MS = 8000;

// Lifetime of a pending OAuth `state` value (owner must finish consent within this window).
export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Least privilege: events on the owner's calendars instead of full calendar
// access; sync only calls events.insert/update/delete on `primary`.
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// Parses to menuAction `gcal_connect` through the existing `menu:` pattern;
// far below Telegram's 64-byte callback_data limit.
export const GOOGLE_CONNECT_CALLBACK_DATA = 'menu:gcal_connect';

export const GOOGLE_CONNECT_BUTTON_LABEL = 'Σύνδεση Google Calendar';
