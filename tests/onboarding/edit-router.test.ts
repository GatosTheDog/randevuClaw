import { isOwnerEditCommand } from '../../src/onboarding/edit-router';

describe('isOwnerEditCommand (ONB-03)', () => {
  it('returns true for "αλλαγή ωραρίου"', () => {
    expect(isOwnerEditCommand('αλλαγή ωραρίου')).toBe(true);
  });

  it('returns true for "ΑΛΛΑΓΉ ΤΙΜΉΣ" (uppercase — case-insensitive check)', () => {
    expect(isOwnerEditCommand('ΑΛΛΑΓΉ ΤΙΜΉΣ')).toBe(true);
  });

  it('returns false for ordinary client message "θέλω ραντεβού"', () => {
    expect(isOwnerEditCommand('θέλω ραντεβού')).toBe(false);
  });
});
