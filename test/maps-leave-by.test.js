'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { arrivalTime, leaveByTime } = require('../lib/maps-leave-by');

test('leave-by subtracts the buffer and full duration, and rounds down across midnight', () => {
  const deadline = arrivalTime('2026-11-20 00:25', 'Europe/Amsterdam');
  assert.equal(new Date(deadline).toISOString(), '2026-11-19T23:25:00.000Z');
  const leaveBy = leaveByTime(deadline, 20 * 60 + 1, 5);
  assert.equal(new Date(leaveBy).toISOString(), '2026-11-19T22:59:00.000Z');
  assert.equal(leaveByTime(deadline, undefined, 0), null);
});

test('deadlines reject invalid dates, DST gaps and ambiguous times in the Homey zone', () => {
  const resolve = value => arrivalTime(value, 'Europe/Amsterdam');
  assert.equal(resolve('2026-02-30 12:00'), null);
  assert.equal(resolve('2026-03-29 02:30'), null);
  assert.equal(resolve('2026-10-25 02:30'), null);
  assert.equal(new Date(resolve('2026-10-25 03:30')).toISOString(), '2026-10-25T02:30:00.000Z');
});
