import { resolveGreekTemporalExpressions } from '../src/conversation/greek-preprocessor';

// Fixed reference instant for the entire corpus: a Wednesday
// (weekdayOfIsoDate('2026-07-08') === 3), Athens local time is midday at
// this instant so DST/rollover is not a factor for this fixture.
const REFERENCE_DATE = new Date('2026-07-08T10:00:00Z');

describe('resolveGreekTemporalExpressions — 23-phrase Greek temporal corpus', () => {
  it('1. "θέλω ραντεβού αύριο" -> tomorrow, no time', () => {
    const result = resolveGreekTemporalExpressions('θέλω ραντεβού αύριο', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-09');
    expect(result.resolvedTime).toBeNull();
  });

  it('2. "μεθαύριο το πρωί" -> day after tomorrow, no time (time-of-day word alone does not resolve a clock time)', () => {
    const result = resolveGreekTemporalExpressions('μεθαύριο το πρωί', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBeNull();
  });

  it('3. "σήμερα το απόγευμα" -> today, no time', () => {
    const result = resolveGreekTemporalExpressions('σήμερα το απόγευμα', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-08');
    expect(result.resolvedTime).toBeNull();
  });

  it('4. "την Παρασκευή στις 5" -> Friday, bare hour 1-7 with no marker -> PM heuristic', () => {
    const result = resolveGreekTemporalExpressions('την Παρασκευή στις 5', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBe('17:00');
  });

  it('5. "Παρασκευή στις 5 μ.μ." -> Friday, 17:00', () => {
    const result = resolveGreekTemporalExpressions('Παρασκευή στις 5 μ.μ.', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBe('17:00');
  });

  it('6. "Παρασκευή στις 5 π.μ." -> Friday, 05:00', () => {
    const result = resolveGreekTemporalExpressions('Παρασκευή στις 5 π.μ.', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBe('05:00');
  });

  it('7. "τη Δευτέρα στις 10 π.μ." -> Monday, 10:00', () => {
    const result = resolveGreekTemporalExpressions('τη Δευτέρα στις 10 π.μ.', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-13');
    expect(result.resolvedTime).toBe('10:00');
  });

  it('8. "το Σάββατο στις 11" -> Saturday, bare hour 8-11 with no marker -> AM heuristic', () => {
    const result = resolveGreekTemporalExpressions('το Σάββατο στις 11', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-11');
    expect(result.resolvedTime).toBe('11:00');
  });

  it("9. \"Τετάρτη στις 9\" -> requested weekday equals reference weekday -> resolves to TODAY", () => {
    const result = resolveGreekTemporalExpressions('Τετάρτη στις 9', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-08');
    expect(result.resolvedTime).toBe('09:00');
  });

  it('10. "αύριο στις 2 το μεσημέρι" -> tomorrow, "μεσημέρι" context -> PM', () => {
    const result = resolveGreekTemporalExpressions('αύριο στις 2 το μεσημέρι', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-09');
    expect(result.resolvedTime).toBe('14:00');
  });

  it('11. "θέλω να κλείσω για την Τρίτη" -> next Tuesday, no time', () => {
    const result = resolveGreekTemporalExpressions('θέλω να κλείσω για την Τρίτη', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-14');
    expect(result.resolvedTime).toBeNull();
  });

  it('12. "μπορώ αύριο το βράδυ στις 8;" -> tomorrow, "βράδυ" context -> PM', () => {
    const result = resolveGreekTemporalExpressions('μπορώ αύριο το βράδυ στις 8;', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-09');
    expect(result.resolvedTime).toBe('20:00');
  });

  it('13. "σε 3 μέρες" -> today + 3 days, no time', () => {
    const result = resolveGreekTemporalExpressions('σε 3 μέρες', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-11');
    expect(result.resolvedTime).toBeNull();
  });

  it('14. "Κυριακή στις 12" -> Sunday, hour 12 with no marker -> noon, never midnight', () => {
    const result = resolveGreekTemporalExpressions('Κυριακή στις 12', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-12');
    expect(result.resolvedTime).toBe('12:00');
  });

  it('15. "πρωί Πέμπτης" -> genitive weekday form still matches, no time', () => {
    const result = resolveGreekTemporalExpressions('πρωί Πέμπτης', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-09');
    expect(result.resolvedTime).toBeNull();
  });

  it('16. "θα έρθω το μεσημέρι" -> no weekday/relative-day keyword -> both null', () => {
    const result = resolveGreekTemporalExpressions('θα έρθω το μεσημέρι', REFERENCE_DATE);
    expect(result.resolvedDate).toBeNull();
    expect(result.resolvedTime).toBeNull();
  });

  it('17. "τυχαίο μήνυμα χωρίς ημερομηνία" -> nothing resolves, annotatedText unchanged', () => {
    const original = 'τυχαίο μήνυμα χωρίς ημερομηνία';
    const result = resolveGreekTemporalExpressions(original, REFERENCE_DATE);
    expect(result.resolvedDate).toBeNull();
    expect(result.resolvedTime).toBeNull();
    expect(result.annotatedText).toBe(original);
  });

  it('18. "10 το πρωί την Παρασκευή" -> time-before-weekday word order still resolves both', () => {
    const result = resolveGreekTemporalExpressions('10 το πρωί την Παρασκευή', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBe('10:00');
  });

  it('19. "ΠΑΡΑΣΚΕΥΉ στις 6 μμ" -> uppercase/accented + undotted "μμ" variant', () => {
    const result = resolveGreekTemporalExpressions('ΠΑΡΑΣΚΕΥΉ στις 6 μμ', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBe('18:00');
  });

  it('20. "Σάββατο 9 πμ" -> undotted "πμ" variant, no literal "στις"', () => {
    const result = resolveGreekTemporalExpressions('Σάββατο 9 πμ', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-11');
    expect(result.resolvedTime).toBe('09:00');
  });

  it('21. "Παρασκευή στις 14" -> Friday, bare 24-hour input in 13-23 range must never get +12 applied again (CR-05)', () => {
    const result = resolveGreekTemporalExpressions('Παρασκευή στις 14', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBe('14:00');
  });

  it('22. "Παρασκευή στις 20" -> Friday, bare 24-hour input in 13-23 range must never get +12 applied again (CR-05)', () => {
    const result = resolveGreekTemporalExpressions('Παρασκευή στις 20', REFERENCE_DATE);
    expect(result.resolvedDate).toBe('2026-07-10');
    expect(result.resolvedTime).toBe('20:00');
  });

  it('23. "στις 22" -> no weekday/relative-day keyword -> resolvedDate null, bare 24-hour input resolves to its own literal hour (CR-05)', () => {
    const result = resolveGreekTemporalExpressions('στις 22', REFERENCE_DATE);
    expect(result.resolvedDate).toBeNull();
    expect(result.resolvedTime).toBe('22:00');
  });
});

describe('resolveGreekTemporalExpressions — annotation and robustness', () => {
  it('appends a ΣΥΣΤΗΜΑ hint to the original (non-normalized) text when something resolves', () => {
    const result = resolveGreekTemporalExpressions('θέλω ραντεβού αύριο', REFERENCE_DATE);
    expect(result.annotatedText).toBe(
      'θέλω ραντεβού αύριο [ΣΥΣΤΗΜΑ: πιθανή ημερομηνία=2026-07-09, πιθανή ώρα=άγνωστη]'
    );
  });

  it('never throws on an empty string', () => {
    expect(() => resolveGreekTemporalExpressions('', REFERENCE_DATE)).not.toThrow();
    const result = resolveGreekTemporalExpressions('', REFERENCE_DATE);
    expect(result.resolvedDate).toBeNull();
    expect(result.resolvedTime).toBeNull();
    expect(result.annotatedText).toBe('');
  });

  it('never throws on a string with no Greek content', () => {
    expect(() => resolveGreekTemporalExpressions('hello world 123', REFERENCE_DATE)).not.toThrow();
  });
});
