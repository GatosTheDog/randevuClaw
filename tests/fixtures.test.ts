// Phase 5 (ONB-04): fixtures.test.ts rewritten to cover generateSlug only.
// The fixture seeding infrastructure has been removed from src/database/seed.ts.
// Tests use tests/helpers/test-business.ts insertTestBusiness() for real-DB setup.

import { generateSlug } from '../src/database/seed';

describe('generateSlug()', () => {
  it('returns the base slug when no collision exists', () => {
    expect(generateSlug('My Business', [])).toBe('my-business');
  });

  it('appends a -2 suffix on the first collision', () => {
    expect(generateSlug('My Business', ['my-business'])).toBe('my-business-2');
  });

  it('appends an incrementing suffix through multiple collisions', () => {
    const existing = ['my-business', 'my-business-2', 'my-business-3'];
    expect(generateSlug('My Business', existing)).toBe('my-business-4');
  });

  it('handles Greek business names: non-ASCII chars are replaced, result stripped to empty', () => {
    // All Greek chars → non-a-z0-9 → replaced with '-' by regex, then leading/trailing
    // hyphens stripped → empty string. Real Greek business names would need transliteration
    // before calling generateSlug; the function operates on pre-transliterated input.
    const slug = generateSlug('Κομμωτήριο Αθηνών', []);
    expect(slug).toBe('');
  });

  it('lowercases the input before slugifying', () => {
    expect(generateSlug('MY BUSINESS', [])).toBe('my-business');
  });

  it('collapses multiple consecutive non-alphanumeric chars into a single hyphen', () => {
    expect(generateSlug('Yoga  Studio   Athens', [])).toBe('yoga-studio-athens');
  });

  it('strips leading and trailing hyphens from the base slug', () => {
    // Leading/trailing punctuation produces leading/trailing hyphens which are stripped
    const slug = generateSlug('...Athens...', []);
    expect(slug).toBe('athens');
  });

  it('returns an empty base slug when input collapses to nothing', () => {
    const slug = generateSlug('', []);
    expect(slug).toBe('');
  });

  it('still appends suffix for empty slug collision', () => {
    // If base is '' and '' is already taken, returns '-2'
    const slug = generateSlug('', ['']);
    expect(slug).toBe('-2');
  });
});
