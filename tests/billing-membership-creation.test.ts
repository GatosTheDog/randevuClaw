// covers PAY-02
// Tests for membership creation when owner records a payment:
// rolling expiry window calculated in Europe/Athens timezone,
// ledger row written atomically, idempotency on webhook replay.

describe('membership creation with rolling expiry', () => {
  it.todo('calculates expires_at as purchase_date + valid_days in Europe/Athens timezone');
  it.todo('stores expires_at as TIMESTAMP WITH TIME ZONE');
  it.todo('writes initial membership_ledger row with operation_type payment_recorded');
  it.todo('idempotency_key prevents duplicate membership creation on replay');
  it.todo('on conflict for same (business_id, client_phone) replaces existing membership');
});
