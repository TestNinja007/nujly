import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rule } from '../schemas/rule.js';
import {
  collidingInstants,
  nextOccurrence,
  occurrencesFor,
  placedOccurrencesFor,
  MAX_PER_DAY,
  type ScheduleSpec,
} from './engine.js';

/**
 * Unit tests for the recurrence engine, focused on R-04 through R-08.
 * End-to-end, API and UI coverage belongs to the separate test framework.
 */

/**
 * Every test here runs with "now" pinned.
 *
 * The engine should not care what day it is, but Luxon reads the real clock on
 * its behalf - which is how R-07's tests passed when they were written in
 * October and failed from 1 November with no code changed. A suite that lets
 * the real date in can pass or fail by season.
 *
 * The pin is a winter instant on purpose. That is when the old engine got
 * Toronto's repeated hour wrong, so pinned here the suite would have failed on
 * the day the bug was written rather than five weeks later. The R-07 block
 * below moves "now" around deliberately.
 */
const PINNED_NOW = new Date('2026-11-15T12:00:00Z');

beforeEach(() => {
  vi.setSystemTime(PINNED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const TORONTO = 'America/Toronto';

function spec(overrides: Partial<ScheduleSpec>): ScheduleSpec {
  return {
    timeOfDay: '09:30',
    timezone: TORONTO,
    startDate: '2026-01-01',
    rule: { type: 'daily' },
    ...overrides,
  };
}

const utc = (list: { utc: string }[]) => list.map((occurrence) => occurrence.utc);
const local = (list: { local: string }[]) => list.map((occurrence) => occurrence.local);

describe('R-04 monthly_day skips months that are too short', () => {
  it('skips February entirely for day 31', () => {
    const result = occurrencesFor(
      spec({ startDate: '2026-01-01', rule: { type: 'monthly_day', dayOfMonth: 31 } }),
      { limit: 7 },
    );

    expect(local(result)).toEqual([
      '2026-01-31T09:30:00-05:00',
      '2026-03-31T09:30:00-04:00',
      '2026-05-31T09:30:00-04:00',
      '2026-07-31T09:30:00-04:00',
      '2026-08-31T09:30:00-04:00',
      '2026-10-31T09:30:00-04:00',
      '2026-12-31T09:30:00-05:00',
    ]);
  });

  it('never produces a 31st in February, even in a leap year', () => {
    const result = occurrencesFor(
      spec({ startDate: '2028-01-01', rule: { type: 'monthly_day', dayOfMonth: 31 } }),
      { limit: 24 },
    );

    expect(result.some((occurrence) => occurrence.local.startsWith('2028-02'))).toBe(false);
  });

  it('does not clamp day 30 back to the 28th in February', () => {
    const result = occurrencesFor(
      spec({ startDate: '2026-01-01', rule: { type: 'monthly_day', dayOfMonth: 30 } }),
      { limit: 3 },
    );

    // January, then March. February is absent rather than clamped to the 28th.
    expect(local(result)).toEqual([
      '2026-01-30T09:30:00-05:00',
      '2026-03-30T09:30:00-04:00',
      '2026-04-30T09:30:00-04:00',
    ]);
  });

  it('includes February for day 29 only in a leap year', () => {
    const leap = occurrencesFor(
      spec({ startDate: '2028-02-01', rule: { type: 'monthly_day', dayOfMonth: 29 } }),
      { limit: 1 },
    );
    expect(local(leap)[0]).toBe('2028-02-29T09:30:00-05:00');

    const common = occurrencesFor(
      spec({ startDate: '2026-02-01', rule: { type: 'monthly_day', dayOfMonth: 29 } }),
      { limit: 1 },
    );
    expect(local(common)[0]).toBe('2026-03-29T09:30:00-04:00');
  });

  it('applies the same skipping to an interval anchored on the 31st', () => {
    const result = occurrencesFor(
      spec({
        startDate: '2026-01-31',
        rule: { type: 'interval', every: 1, unit: 'months' },
      }),
      { limit: 4 },
    );

    expect(local(result)).toEqual([
      '2026-01-31T09:30:00-05:00',
      '2026-03-31T09:30:00-04:00',
      '2026-05-31T09:30:00-04:00',
      '2026-07-31T09:30:00-04:00',
    ]);
  });
});

describe('R-05 monthly_nth', () => {
  it('finds the last Friday of each month', () => {
    const result = occurrencesFor(
      spec({ startDate: '2026-01-01', rule: { type: 'monthly_nth', nth: -1, weekday: 'FR' } }),
      { limit: 4 },
    );

    expect(local(result)).toEqual([
      '2026-01-30T09:30:00-05:00',
      '2026-02-27T09:30:00-05:00',
      '2026-03-27T09:30:00-04:00',
      '2026-04-24T09:30:00-04:00',
    ]);
  });

  it('finds the first Monday of each month', () => {
    const result = occurrencesFor(
      spec({ startDate: '2026-01-01', rule: { type: 'monthly_nth', nth: 1, weekday: 'MO' } }),
      { limit: 3 },
    );

    expect(local(result)).toEqual([
      '2026-01-05T09:30:00-05:00',
      '2026-02-02T09:30:00-05:00',
      '2026-03-02T09:30:00-05:00',
    ]);
  });

  it('treats the 4th and the last as different days when a month has five', () => {
    // May 2026 has five Fridays: 1, 8, 15, 22, 29.
    const fourth = occurrencesFor(
      spec({ startDate: '2026-05-01', rule: { type: 'monthly_nth', nth: 4, weekday: 'FR' } }),
      { limit: 1 },
    );
    const last = occurrencesFor(
      spec({ startDate: '2026-05-01', rule: { type: 'monthly_nth', nth: -1, weekday: 'FR' } }),
      { limit: 1 },
    );

    expect(local(fourth)[0]).toBe('2026-05-22T09:30:00-04:00');
    expect(local(last)[0]).toBe('2026-05-29T09:30:00-04:00');
  });
});

describe('R-06 spring forward', () => {
  it('moves a time inside the gap forward by the length of the gap', () => {
    // Toronto jumps 02:00 -> 03:00 on 8 March 2026, so 02:30 does not exist.
    const result = occurrencesFor(
      spec({ timeOfDay: '02:30', startDate: '2026-03-07', rule: { type: 'daily' } }),
      { limit: 3 },
    );

    expect(local(result)).toEqual([
      '2026-03-07T02:30:00-05:00',
      '2026-03-08T03:30:00-04:00',
      '2026-03-09T02:30:00-04:00',
    ]);
  });

  it('shifts by thirty minutes where the gap is thirty minutes', () => {
    // Lord Howe Island moves the clock forward by half an hour.
    const result = occurrencesFor(
      spec({
        timeOfDay: '02:15',
        timezone: 'Australia/Lord_Howe',
        startDate: '2026-10-04',
        rule: { type: 'daily' },
      }),
      { limit: 1 },
    );

    expect(local(result)[0]).toBe('2026-10-04T02:45:00+11:00');
  });

  it('leaves times outside the gap untouched', () => {
    const result = occurrencesFor(
      spec({ timeOfDay: '01:30', startDate: '2026-03-08', rule: { type: 'daily' } }),
      { limit: 1 },
    );

    expect(utc(result)[0]).toBe('2026-03-08T06:30:00Z');
  });
});

describe('R-07 fall back', () => {
  it('uses the first of two identical local times', () => {
    // Toronto repeats 01:00-02:00 on 1 November 2026. 01:30 happens at
    // 05:30Z (EDT, -04:00) and again at 06:30Z (EST, -05:00).
    const result = occurrencesFor(
      spec({ timeOfDay: '01:30', startDate: '2026-11-01', rule: { type: 'daily' } }),
      { limit: 1 },
    );

    expect(utc(result)[0]).toBe('2026-11-01T05:30:00Z');
    expect(local(result)[0]).toBe('2026-11-01T01:30:00-04:00');
  });

  it('keeps the wall-clock time stable across the transition', () => {
    const result = occurrencesFor(
      spec({ timeOfDay: '01:30', startDate: '2026-10-31', rule: { type: 'daily' } }),
      { limit: 3 },
    );

    // The local time never moves; only the offset and the instant do.
    expect(local(result)).toEqual([
      '2026-10-31T01:30:00-04:00',
      '2026-11-01T01:30:00-04:00',
      '2026-11-02T01:30:00-05:00',
    ]);
    expect(utc(result)).toEqual([
      '2026-10-31T05:30:00Z',
      '2026-11-01T05:30:00Z',
      '2026-11-02T06:30:00Z',
    ]);
  });

  it('carries a weekly alarm across a DST boundary without moving the local time', () => {
    const result = occurrencesFor(
      spec({
        timeOfDay: '07:00',
        startDate: '2026-10-26',
        rule: { type: 'weekly', byWeekday: ['MO'] },
      }),
      { limit: 3 },
    );

    expect(local(result)).toEqual([
      '2026-10-26T07:00:00-04:00',
      '2026-11-02T07:00:00-05:00',
      '2026-11-09T07:00:00-05:00',
    ]);
    expect(utc(result)).toEqual([
      '2026-10-26T11:00:00Z',
      '2026-11-02T12:00:00Z',
      '2026-11-09T12:00:00Z',
    ]);
  });
});

describe('R-07 does not depend on when it runs', () => {
  /*
   * The old engine took Luxon's guess, which is the zone's offset at the moment
   * the code runs. These are the moments around Toronto's fall-back that tell
   * the two answers apart: it was right at the first two and wrong at the last
   * two. The answer flipped at the transition itself, 06:00Z on 1 November, and
   * would have flipped back when the clocks went forward in March.
   */
  const moments = [
    ['weeks before the transition', '2026-10-15T12:00:00Z'],
    ['during the first 01:00-02:00, still on EDT', '2026-11-01T05:45:00Z'],
    ['during the repeated 01:00-02:00, now on EST', '2026-11-01T06:15:00Z'],
    ['weeks after the transition', '2026-11-15T12:00:00Z'],
  ] as const;

  it.each(moments)('resolves the repeated 01:30 to the first instant when now is %s', (_, now) => {
    vi.setSystemTime(new Date(now));

    const result = occurrencesFor(
      spec({ timeOfDay: '01:30', startDate: '2026-10-31', rule: { type: 'daily' } }),
      { limit: 3 },
    );

    expect(utc(result)).toEqual([
      '2026-10-31T05:30:00Z',
      '2026-11-01T05:30:00Z',
      '2026-11-02T06:30:00Z',
    ]);
    expect(local(result)).toEqual([
      '2026-10-31T01:30:00-04:00',
      '2026-11-01T01:30:00-04:00',
      '2026-11-02T01:30:00-05:00',
    ]);
  });

  it('does not offer the 01:30 again to a poll made during the repeated hour', () => {
    // The same fault, as the product saw it. The browser asks what is due in
    // the next hour and keys each notification by its instant. At 01:15 EST
    // the day's 01:30 had already happened, at 05:30Z, so nothing is due. The
    // old engine answered 06:30Z, a new key, and the alarm went off again.
    const now = new Date('2026-11-01T06:15:00Z');
    vi.setSystemTime(now);

    const due = occurrencesFor(
      spec({ timeOfDay: '01:30', startDate: '2026-10-31', rule: { type: 'daily' } }),
      { from: now, to: new Date(now.getTime() + 60 * 60 * 1000), limit: 50 },
    );

    expect(utc(due)).toEqual([]);
  });
});

describe('window and end conditions', () => {
  it('treats from and to as inclusive bounds', () => {
    const result = occurrencesFor(
      spec({ timeOfDay: '09:30', startDate: '2026-06-01', rule: { type: 'daily' } }),
      {
        from: new Date('2026-06-02T13:30:00Z'),
        to: new Date('2026-06-04T13:30:00Z'),
        limit: 10,
      },
    );

    expect(utc(result)).toEqual([
      '2026-06-02T13:30:00Z',
      '2026-06-03T13:30:00Z',
      '2026-06-04T13:30:00Z',
    ]);
  });

  it('stops on endDate, inclusive of that day', () => {
    const result = occurrencesFor(
      spec({ startDate: '2026-06-01', endDate: '2026-06-03', rule: { type: 'daily' } }),
      { limit: 10 },
    );

    expect(local(result)).toHaveLength(3);
    expect(local(result).at(-1)).toBe('2026-06-03T09:30:00-04:00');
  });

  it('counts endAfterOccurrences from the first occurrence, not from the window', () => {
    const all = spec({ startDate: '2026-06-01', endAfterOccurrences: 3, rule: { type: 'daily' } });

    expect(occurrencesFor(all, { limit: 10 })).toHaveLength(3);

    // Asking from the second day still yields only what remains of the three.
    const rest = occurrencesFor(all, { from: new Date('2026-06-02T00:00:00Z'), limit: 10 });
    expect(utc(rest)).toEqual(['2026-06-02T13:30:00Z', '2026-06-03T13:30:00Z']);
  });

  it('produces exactly one occurrence for a once rule', () => {
    const result = occurrencesFor(
      spec({ startDate: '2026-06-01', rule: { type: 'once' } }),
      { limit: 10 },
    );

    expect(local(result)).toEqual(['2026-06-01T09:30:00-04:00']);
  });
});

describe('R-08 collisions', () => {
  it('finds a shared instant across different zones and local times', () => {
    // 07:00 in Toronto and 08:00 in Halifax are the same instant in summer.
    const toronto = spec({ timeOfDay: '07:00', startDate: '2026-06-01', rule: { type: 'daily' } });
    const halifax = spec({
      timeOfDay: '08:00',
      timezone: 'America/Halifax',
      startDate: '2026-06-01',
      rule: { type: 'daily' },
    });

    const shared = collidingInstants(toronto, halifax, {
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-06-03T00:00:00Z'),
    });

    expect(shared).toEqual(['2026-06-01T11:00:00Z', '2026-06-02T11:00:00Z']);
  });

  it('reports no collision when the instants merely look similar', () => {
    const a = spec({ timeOfDay: '07:00', startDate: '2026-06-01', rule: { type: 'daily' } });
    const b = spec({ timeOfDay: '07:01', startDate: '2026-06-01', rule: { type: 'daily' } });

    expect(
      collidingInstants(a, b, {
        from: new Date('2026-06-01T00:00:00Z'),
        to: new Date('2026-07-01T00:00:00Z'),
      }),
    ).toEqual([]);
  });

  it('collides two different local times that the spring-forward gap merges', () => {
    // 02:30 moves to 03:30 on 8 March, landing on the same instant as an
    // alarm set for 03:30 that day.
    const inGap = spec({ timeOfDay: '02:30', startDate: '2026-03-08', rule: { type: 'once' } });
    const afterGap = spec({ timeOfDay: '03:30', startDate: '2026-03-08', rule: { type: 'once' } });

    expect(
      collidingInstants(inGap, afterGap, {
        from: new Date('2026-03-08T00:00:00Z'),
        to: new Date('2026-03-09T00:00:00Z'),
      }),
    ).toEqual(['2026-03-08T07:30:00Z']);
  });
});

describe('repeating within a day', () => {
  it('walks from the start time to the end time inclusive', () => {
    const result = occurrencesFor(
      spec({
        timeOfDay: '09:00',
        endTimeOfDay: '09:10',
        repeatEvery: 5,
        repeatUnit: 'minutes',
        startDate: '2026-06-01',
        rule: { type: 'once' },
      }),
      { limit: 10 },
    );

    expect(local(result)).toEqual([
      '2026-06-01T09:00:00-04:00',
      '2026-06-01T09:05:00-04:00',
      '2026-06-01T09:10:00-04:00',
    ]);
  });

  it('stops before the end when the step overshoots it', () => {
    const result = occurrencesFor(
      spec({
        timeOfDay: '09:00',
        endTimeOfDay: '09:12',
        repeatEvery: 5,
        repeatUnit: 'minutes',
        startDate: '2026-06-01',
        rule: { type: 'once' },
      }),
      { limit: 10 },
    );

    // 09:15 would be past the window, so the last one is 09:10.
    expect(local(result).at(-1)).toBe('2026-06-01T09:10:00-04:00');
    expect(result).toHaveLength(3);
  });

  it('repeats the window on every day the rule selects', () => {
    const result = occurrencesFor(
      spec({
        timeOfDay: '08:00',
        endTimeOfDay: '09:00',
        repeatEvery: 1,
        repeatUnit: 'hours',
        startDate: '2026-06-01',
        rule: { type: 'weekly', byWeekday: ['MO', 'TU'] },
      }),
      { limit: 6 },
    );

    // Monday 1 June and Tuesday 2 June, twice each.
    expect(local(result)).toEqual([
      '2026-06-01T08:00:00-04:00',
      '2026-06-01T09:00:00-04:00',
      '2026-06-02T08:00:00-04:00',
      '2026-06-02T09:00:00-04:00',
      '2026-06-08T08:00:00-04:00',
      '2026-06-08T09:00:00-04:00',
    ]);
  });

  it('counts each occurrence towards endAfterOccurrences, not each day', () => {
    const result = occurrencesFor(
      spec({
        timeOfDay: '09:00',
        endTimeOfDay: '09:30',
        repeatEvery: 10,
        repeatUnit: 'minutes',
        startDate: '2026-06-01',
        endAfterOccurrences: 5,
        rule: { type: 'daily' },
      }),
      { limit: 20 },
    );

    // Four on the first day, then one on the second: five in total.
    expect(local(result)).toEqual([
      '2026-06-01T09:00:00-04:00',
      '2026-06-01T09:10:00-04:00',
      '2026-06-01T09:20:00-04:00',
      '2026-06-01T09:30:00-04:00',
      '2026-06-02T09:00:00-04:00',
    ]);
  });

  it('does not report one instant twice when a spring-forward folds the window', () => {
    // Toronto jumps 02:00 to 03:00 on 8 March 2026. A window of 01:30 to 03:30
    // every 30 minutes would otherwise produce 02:00, 02:30 and 03:00 all
    // landing on the same instant.
    const result = occurrencesFor(
      spec({
        timeOfDay: '01:30',
        endTimeOfDay: '03:30',
        repeatEvery: 30,
        repeatUnit: 'minutes',
        startDate: '2026-03-08',
        rule: { type: 'once' },
      }),
      { limit: 20 },
    );

    expect(utc(result)).toEqual([...new Set(utc(result))]);
    expect(utc(result)).toEqual([
      '2026-03-08T06:30:00Z',
      '2026-03-08T07:00:00Z',
      '2026-03-08T07:30:00Z',
    ]);
  });

  it('repeats every few seconds, with seconds in the output', () => {
    const result = occurrencesFor(
      spec({
        timeOfDay: '09:00',
        endTimeOfDay: '09:01',
        repeatEvery: 15,
        repeatUnit: 'seconds',
        startDate: '2026-06-01',
        rule: { type: 'once' },
      }),
      { limit: 10 },
    );

    expect(local(result)).toEqual([
      '2026-06-01T09:00:00-04:00',
      '2026-06-01T09:00:15-04:00',
      '2026-06-01T09:00:30-04:00',
      '2026-06-01T09:00:45-04:00',
      '2026-06-01T09:01:00-04:00',
    ]);
  });

  it('carries seconds through to the UTC instant', () => {
    const result = occurrencesFor(
      spec({
        timeOfDay: '09:00',
        endTimeOfDay: '09:01',
        repeatEvery: 30,
        repeatUnit: 'seconds',
        startDate: '2026-06-01',
        rule: { type: 'once' },
      }),
      { limit: 5 },
    );

    expect(utc(result)).toEqual([
      '2026-06-01T13:00:00Z',
      '2026-06-01T13:00:30Z',
      '2026-06-01T13:01:00Z',
    ]);
  });

  it('never exceeds the per-day ceiling', () => {
    // Every second across a full day would be 86,400; the engine stops at the cap.
    const result = occurrencesFor(
      spec({
        timeOfDay: '00:00',
        endTimeOfDay: '23:59',
        repeatEvery: 1,
        repeatUnit: 'seconds',
        startDate: '2026-06-01',
        rule: { type: 'once' },
      }),
      { limit: Number.MAX_SAFE_INTEGER },
    );

    expect(result).toHaveLength(MAX_PER_DAY);
  });

  it('leaves an alarm without a window exactly as it was', () => {
    const plain = occurrencesFor(
      spec({ timeOfDay: '09:30', startDate: '2026-06-01', rule: { type: 'daily' } }),
      { limit: 3 },
    );

    expect(local(plain)).toEqual([
      '2026-06-01T09:30:00-04:00',
      '2026-06-02T09:30:00-04:00',
      '2026-06-03T09:30:00-04:00',
    ]);
  });
});

describe('where the walk begins', () => {
  /*
   * Without endAfterOccurrences the engine starts a day before the window
   * rather than at startDate, so a query costs the same however old the alarm
   * is. Nothing it returns may change.
   *
   * A query with no `from` still walks from startDate. That walk, filtered to
   * the window afterwards, is the engine's old answer, and is the reference
   * here: every rule, around each zone's repeated and skipped hours, with
   * single times and with windows that cross them.
   */
  const DAY_MS = 86_400_000;

  const RULES: [string, Rule][] = [
    ['daily', { type: 'daily' }],
    ['weekly on three days', { type: 'weekly', byWeekday: ['MO', 'WE', 'SA'] }],
    ['weekly on Sundays', { type: 'weekly', byWeekday: ['SU'] }],
    ['monthly on the 31st', { type: 'monthly_day', dayOfMonth: 31 }],
    ['monthly on the last Sunday', { type: 'monthly_nth', nth: -1, weekday: 'SU' }],
    ['every 3 days', { type: 'interval', every: 3, unit: 'days' }],
    ['every 2 weeks', { type: 'interval', every: 2, unit: 'weeks' }],
    ['every month', { type: 'interval', every: 1, unit: 'months' }],
    ['every 5 months', { type: 'interval', every: 5, unit: 'months' }],
    ['once', { type: 'once' }],
  ];

  const TIMES: [string, Partial<ScheduleSpec>][] = [
    ['at 01:30', { timeOfDay: '01:30' }],
    [
      'every 30 minutes, 00:00 to 03:30',
      { timeOfDay: '00:00', endTimeOfDay: '03:30', repeatEvery: 30, repeatUnit: 'minutes' },
    ],
    [
      'every 20 minutes, 22:00 to 23:59',
      { timeOfDay: '22:00', endTimeOfDay: '23:59', repeatEvery: 20, repeatUnit: 'minutes' },
    ],
  ];

  // Windows opening inside each zone's 2026 transitions, and at a midnight.
  const FROMS: Record<string, string[]> = {
    // Just before the gap; 01:45 on EDT; 01:15 again on EST; a midnight.
    'America/Toronto': [
      '2026-03-08T06:59:00Z',
      '2026-11-01T05:45:00Z',
      '2026-11-01T06:15:00Z',
      '2026-07-01T04:00:00Z',
    ],
    // A thirty-minute repeat, both passes; before a thirty-minute gap; New Year.
    'Australia/Lord_Howe': [
      '2026-04-04T14:45:00Z',
      '2026-04-04T15:15:00Z',
      '2026-10-03T15:20:00Z',
      '2026-12-31T13:00:00Z',
    ],
    // Changes at midnight: 23:30 twice, then either side of a skipped 00:00.
    'America/Santiago': [
      '2026-04-05T02:30:00Z',
      '2026-04-05T03:30:00Z',
      '2026-09-06T03:30:00Z',
      '2026-09-06T04:00:00Z',
    ],
    // Before the gap; 01:30 on both passes; the last minute of February.
    'Europe/Lisbon': [
      '2026-03-29T00:30:00Z',
      '2026-10-25T00:30:00Z',
      '2026-10-25T01:30:00Z',
      '2026-02-28T23:59:00Z',
    ],
    // Springs forward at 23:00, so Saturday's 23:20 fires at 00:20 on Sunday:
    // a window opening on Sunday still has to look at Saturday. Then 23:30
    // on both passes when the clocks go back.
    'America/Nuuk': [
      '2026-03-29T00:59:00Z',
      '2026-03-29T01:10:00Z',
      '2026-10-25T00:30:00Z',
      '2026-10-25T01:30:00Z',
    ],
  };

  function expectSameAsWalk(schedule: ScheduleSpec, froms: Date[]): void {
    const to = new Date(Math.max(...froms.map((from) => from.getTime())) + 60 * DAY_MS);
    const walked = placedOccurrencesFor(schedule, { to, limit: Number.MAX_SAFE_INTEGER });
    const within = (from: Date, until: Date) =>
      walked.filter((occurrence) => {
        const at = Date.parse(occurrence.utc);
        return at >= from.getTime() && at <= until.getTime();
      });

    for (const from of froms) {
      for (const limit of [1, 5]) {
        expect(placedOccurrencesFor(schedule, { from, to, limit })).toEqual(
          within(from, to).slice(0, limit),
        );
      }

      // As /me/upcoming asks: only what falls in the next day and a half.
      const soon = new Date(from.getTime() + 1.5 * DAY_MS);
      expect(placedOccurrencesFor(schedule, { from, to: soon, limit: 50 })).toEqual(
        within(from, soon).slice(0, 50),
      );
    }
  }

  const cases = RULES.flatMap(([ruleName, rule]) =>
    Object.keys(FROMS).flatMap((zone) =>
      TIMES.map(([timesName, times]) => [`${ruleName}, ${timesName}, ${zone}`, rule, zone, times] as const),
    ),
  );

  it.each(cases)('matches the walk from startDate: %s', (_, rule, zone, times) => {
    // A 31st, so short months are skipped, and well before every window.
    const schedule = { ...spec({ startDate: '2025-10-31', timezone: zone, rule }), ...times };
    expectSameAsWalk(schedule, FROMS[zone]!.map((iso) => new Date(iso)));
  });

  it.each(RULES)('matches it too when the alarm starts among the windows: %s', (_, rule) => {
    // Some windows open before this start date and some after it.
    const schedule = {
      ...spec({ startDate: '2026-08-31', timezone: 'Europe/Lisbon', rule }),
      ...TIMES[1]![1],
    };
    expectSameAsWalk(schedule, [...FROMS['Europe/Lisbon']!, '2026-08-30T12:00:00Z'].map((iso) => new Date(iso)));
  });

  it('finds the next occurrence of an alarm that started in the year 1', () => {
    // The walk used to give up after MAX_CANDIDATES days, around the year
    // 1479, and report a daily alarm as never firing again.
    expect(nextOccurrence(spec({ startDate: '0001-01-01' }), PINNED_NOW)?.utc).toBe(
      '2026-11-15T14:30:00Z',
    );
  });

  it('answers for a window far in the future', () => {
    // The same limit, reached from the other side.
    const next = nextOccurrence(spec({ startDate: '2026-01-01' }), new Date('9000-01-01T00:00:00Z'));

    expect(next?.utc).toBe('9000-01-01T14:30:00Z');
  });

  it('keeps an interval on the cadence counted from its start date', () => {
    // 15 November 2026 is 380 days after the start, 16 November is 381: 127 threes.
    const next = nextOccurrence(
      spec({ startDate: '2025-10-31', rule: { type: 'interval', every: 3, unit: 'days' } }),
      PINNED_NOW,
    );

    expect(next?.local).toBe('2026-11-16T09:30:00-05:00');
  });

  it('still counts endAfterOccurrences from the very first occurrence', () => {
    // A count needs every occurrence before the window, so this walk starts at
    // startDate. The 400th day from 1 January 2026 is 4 February 2027.
    const counted = spec({ startDate: '2026-01-01', endAfterOccurrences: 400 });
    const rest = occurrencesFor(counted, { from: new Date('2027-02-01T00:00:00Z'), limit: 10 });

    expect(local(rest)).toEqual([
      '2027-02-01T09:30:00-05:00',
      '2027-02-02T09:30:00-05:00',
      '2027-02-03T09:30:00-05:00',
      '2027-02-04T09:30:00-05:00',
    ]);
  });

  it('keeps a date in the first century in the first century', () => {
    // Date.UTC reads a year below 100 as 1900 plus that year: this gave 1950.
    const result = occurrencesFor(
      spec({ timezone: 'UTC', startDate: '0050-01-01', endAfterOccurrences: 2 }),
      { limit: 5 },
    );

    expect(utc(result)).toEqual(['0050-01-01T09:30:00Z', '0050-01-02T09:30:00Z']);
  });

  it('keeps an interval on its cadence across a date that never existed', () => {
    // Samoa skipped 30 December 2011. That occurrence moves forward with the
    // gap, as R-06 moves a skipped time; the ones after it used to shift a day
    // too, and now stay on the cadence counted from the start date.
    const result = occurrencesFor(
      spec({
        timezone: 'Pacific/Apia',
        startDate: '2011-12-26',
        rule: { type: 'interval', every: 2, unit: 'days' },
      }),
      { limit: 6 },
    );

    expect(local(result)).toEqual([
      '2011-12-26T09:30:00-10:00',
      '2011-12-28T09:30:00-10:00',
      '2011-12-31T09:30:00+14:00',
      '2012-01-01T09:30:00+14:00',
      '2012-01-03T09:30:00+14:00',
      '2012-01-05T09:30:00+14:00',
    ]);
  });
});
