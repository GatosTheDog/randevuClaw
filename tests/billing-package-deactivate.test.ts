// covers BILL-03
// Tests for soft-deactivating a billing package via the deactivate_package tool:
// existing memberships referencing the package must remain intact.

describe('deactivate package', () => {
  it.todo('sets is_active to false on the target package');
  it.todo('existing memberships referencing the package remain intact');
  it.todo('deactivated package excluded from getRecentClients package selection');
});
