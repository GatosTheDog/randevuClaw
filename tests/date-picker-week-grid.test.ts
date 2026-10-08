import { buildWeekGridRows } from '../src/utils/date-picker';

describe('buildWeekGridRows', () => {
  // 2026-10-08 is a Thursday; grid starts Monday 2026-10-05.
  const rows = buildWeekGridRows(['2026-10-08', '2026-10-14', '2026-11-01'], 'cmenu:book:date', 'cmenu:book:none');

  test('header + one 7-button row per week, Monday first', () => {
    expect(rows[0].map((b) => b.text)).toEqual(['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ']);
    expect(rows.length).toBe(1 + 4);
    for (const r of rows) expect(r).toHaveLength(7);
  });

  test('available days are pickable, others inert', () => {
    expect(rows[1][3]).toEqual({ text: '8', callback_data: 'cmenu:book:date:20261008' });
    expect(rows[1][0]).toEqual({ text: '·', callback_data: 'cmenu:book:none' });
    expect(rows[2][2].callback_data).toBe('cmenu:book:date:20261014');
  });

  test('1st of month labelled D/M; empty input gives no rows', () => {
    expect(rows[4][6].text).toBe('1/11');
    expect(buildWeekGridRows([], 'a', 'b')).toEqual([]);
  });
});
