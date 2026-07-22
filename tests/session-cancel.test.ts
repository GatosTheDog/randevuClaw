// covers CLSS-03
// Nyquist stub: owner cancels an individual session; every booked client is notified
// automatically in Greek via async poller broadcast.
// Poller dedup: sessionCancellationNotifications row prevents duplicate sends on re-run.
// Stubs filled in when src/session/manager.ts cancel logic and poller are built (Wave 1+).

describe('session cancellation and broadcast', () => {
  it.todo('cancel_session marks sessionInstance.isCancelled=true atomically');
  it.todo('cancel_session on already-cancelled instance is a no-op (idempotent, returns false)');
  it.todo('poller finds cancelled instances not yet notified and sends Greek message to each booked client');
  it.todo('poller dedup: sessionCancellationNotifications row prevents second notification send on poller re-run');
  it.todo('poller partial failure: one client send failure does not block other clients in same session');
});
