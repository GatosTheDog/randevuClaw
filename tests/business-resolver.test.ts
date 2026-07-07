import {
  extractAndNormalizeBusinessCode,
  normalizeBusinessCode,
} from '../src/business/resolver';

describe('extractAndNormalizeBusinessCode', () => {
  it('extracts hyphenated Latin slug from Greek conversational text', () => {
    expect(extractAndNormalizeBusinessCode('Θέλω ραντεβού pilates-Athens')).toBe('pilates-athens');
  });

  it('case-folds UPPERCASE slug', () => {
    expect(extractAndNormalizeBusinessCode('PILATES-ATHENS')).toBe('pilates-athens');
  });

  it('standardizes en-dash to hyphen', () => {
    // U+2013 EN DASH between words
    expect(extractAndNormalizeBusinessCode('pilates–athens')).toBe('pilates-athens');
  });

  it('trims surrounding whitespace', () => {
    expect(extractAndNormalizeBusinessCode('  pilates-athens  ')).toBe('pilates-athens');
  });

  it('returns null for pure Greek text with no hyphenated Latin slug', () => {
    // Greek words, accented, no hyphen — must NOT match as a business code
    expect(extractAndNormalizeBusinessCode('ΠΙΛΆΤΕΣ ΑΘΉΝΑ')).toBeNull();
  });

  it('returns null when no business code present', () => {
    expect(extractAndNormalizeBusinessCode('no business code here')).toBeNull();
  });
});

describe('normalizeBusinessCode', () => {
  it('strips Greek diacritics (tonos) without transliterating to Latin', () => {
    // Confirms stripGreekDiacritics removes accent marks but stays in Greek script
    expect(normalizeBusinessCode('ΠΙΛΆΤΕΣ')).toBe('πιλατες');
  });
});
