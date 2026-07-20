// covers PAY-01
// Tests for the multi-step payment recording flow: owner selects client via
// inline keyboard, then selects package, then confirms — bot creates membership.
// Also covers T-07-05: callback_data must contain only IDs, not prices.

describe('payment recording flow', () => {
  it.todo('shows recent clients as inline keyboard buttons (last 30 days)');
  it.todo('falls back to service+date label when client_name is null');
  it.todo('callback_data for client button is billing:client:{id} under 64 bytes');
  it.todo('shows active packages as inline keyboard buttons after client selected');
  it.todo('callback_data for package button is billing:package:{clientId}:{packageId} under 64 bytes');
  it.todo('shows Greek confirmation message after package selected');
  it.todo('validates callback_query sender against owner_telegram_id before any billing op');
});
