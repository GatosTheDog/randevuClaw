// covers BILL-01
// Edge-case tests for Gemini NLU parsing of Greek billing phrases:
// pricing, session counts, "unlimited" synonyms, and validation constraints.

describe('package NLU parsing edge cases', () => {
  it.todo('parses "10 μαθήματα €50 30 μέρες" to session_count 10 and price_cents 5000');
  it.todo('maps "απεριόριστες" keyword to session_count null');
  it.todo('maps "απεριόριστο" keyword to session_count null');
  it.todo('maps "χωρίς όριο" keyword to session_count null');
  it.todo('maps "unlimited" keyword to session_count null');
  it.todo('validates price_cents must be integer >= 0');
  it.todo('validates valid_days must be integer >= 1');
});
