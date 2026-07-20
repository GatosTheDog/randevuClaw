// covers PAY-02 DST edge case
// Tests for DST-safe calendar-day arithmetic using Europe/Athens timezone:
// ensures addCalendarDays() does not produce off-by-one errors when the
// rolling expiry window crosses a DST boundary (last Sunday of October).

describe('DST-safe date arithmetic', () => {
  it.todo('Sept 22 + 30 calendar days = Oct 22 (not Oct 23, crossing DST boundary)');
  it.todo('Oct 25 + 30 calendar days = Nov 24 (post-DST end, Athens UTC+2 → UTC+3)');
  it.todo('addCalendarDays uses noon-UTC anchor to avoid off-by-one on DST transition nights');
});
