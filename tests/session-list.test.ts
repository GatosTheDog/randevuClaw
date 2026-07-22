// covers CLSS-05
// Nyquist stub: owner lists upcoming sessions with booked count and capacity via chat.
// listSessions aggregates bookedCount per sessionInstance, excludes cancelled instances
// (isCancelled=true) and past sessions (sessionDate < today Athens wall-clock).
// Result format: { sessionDate, sessionTime, bookedCount, capacity } per row.
// Stubs filled in when src/session/manager.ts listSessions is built (Wave 1).

describe('list upcoming sessions with booking counts', () => {
  it.todo('listSessions aggregates bookedCount correctly for each sessionInstance');
  it.todo('listSessions excludes cancelled instances (isCancelled=true) from results');
  it.todo('listSessions excludes instances with sessionDate in the past');
  it.todo('listSessions result format includes sessionDate, sessionTime, bookedCount, capacity for each row');
  it.todo('listSessions returns empty array when no active upcoming sessions exist');
});
