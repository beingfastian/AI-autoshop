// Parsing of caller-provided values. These come from the AI's reading of a phone call, so they
// are messy; the rule is: read them when certain, never guess.
const { parseRequestedTime, normalizePhone } = require('../src/services/bookings');

describe('parseRequestedTime', () => {
  const karachi = (date, time) => parseRequestedTime(date, time, 'Asia/Karachi')?.toISOString() ?? null;

  test.each([
    ['14:00', '2030-01-15T09:00:00.000Z'],
    ['9:30', '2030-01-15T04:30:00.000Z'],
    ['2pm', '2030-01-15T09:00:00.000Z'],
    ['2 PM', '2030-01-15T09:00:00.000Z'],
    ['2:30 p.m.', '2030-01-15T09:30:00.000Z'],
    ['12pm', '2030-01-15T07:00:00.000Z'], // noon
    ['12am', '2030-01-14T19:00:00.000Z'] // midnight
  ])('reads %p in the shop\'s timezone', (time, expected) => {
    expect(karachi('2030-01-15', time)).toBe(expected);
  });

  test.each([
    ['2030-01-15', '2', 'bare hour: could be 2 AM or 2 PM'],
    ['2030-01-15', 'afternoon', 'not a time'],
    ['2030-01-15', '25:00', 'impossible hour'],
    ['2030-01-15', '13pm', 'impossible 12-hour time'],
    ['2030-02-30', '14:00', 'impossible date'],
    ['next Tuesday', '14:00', 'relative date the AI should have resolved'],
    ['', '14:00', 'missing date'],
    ['2030-01-15', null, 'missing time'],
    [undefined, undefined, 'nothing captured']
  ])('returns null for %p %p (%s)', (date, time) => {
    expect(karachi(date, time)).toBeNull();
  });

  test('a time skipped by a daylight-saving change is not guessed', () => {
    // US clocks jump from 02:00 to 03:00 on 2030-03-10
    expect(parseRequestedTime('2030-03-10', '02:30', 'America/New_York')).toBeNull();
    expect(parseRequestedTime('2030-03-10', '03:30', 'America/New_York').toISOString()).toBe('2030-03-10T07:30:00.000Z');
  });
});

describe('normalizePhone', () => {
  test.each([
    ['+92 300-123 4567', '+923001234567'],
    ['+923001234567', '+923001234567'],
    ['(0300) 123-4567', '03001234567'],
    ['  +1 555 999 8888 ', '+15559998888']
  ])('%p -> %p', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  test.each(['', '123', 'call me', null, undefined, '+1234567890123456'])('rejects %p', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
