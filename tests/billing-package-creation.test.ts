// covers BILL-01
// Tests for billing package creation via Gemini NLU (create_package tool):
// owner creates a package from a natural-language Greek message; bot echoes
// all 4 parsed fields, waits for confirmation, then writes to DB.

describe('package creation via NLU', () => {
  it.todo('creates package from NLU-parsed args (create_package tool)');
  it.todo('echoes all 4 fields in Greek confirmation text before DB write (D-03)');
  it.todo('inserts package with is_active false pending confirmation');
  it.todo('activates package on billing:pkg_confirm callback');
  it.todo('cancels and deletes pending package on billing:pkg_cancel callback');
});
