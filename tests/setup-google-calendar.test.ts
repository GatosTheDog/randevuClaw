import { parseBusinessSlugArg } from '../scripts/setup-google-calendar';

describe('scripts/setup-google-calendar.ts', () => {
  describe('parseBusinessSlugArg', () => {
    it("extracts the value following '--business-slug'", () => {
      expect(parseBusinessSlugArg(['--business-slug', 'pilates-athens'])).toBe('pilates-athens');
    });

    it('returns null when no args are given', () => {
      expect(parseBusinessSlugArg([])).toBeNull();
    });

    it('returns null when the flag is absent', () => {
      expect(parseBusinessSlugArg(['--other-flag', 'x'])).toBeNull();
    });

    it('returns null when the flag is the last argument with no value', () => {
      expect(parseBusinessSlugArg(['--business-slug'])).toBeNull();
    });
  });
});
