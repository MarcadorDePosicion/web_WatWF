import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {indexSchedule, warsawToday, shiftDate, weekDates, locationTone, entryCount} from '../js/schedule.js';

test('all source records are indexed without loss, including retakes', () => {
  const records = JSON.parse(readFileSync(new URL('../data/schedule.json', import.meta.url)));
  const index = indexSchedule(records);
  assert.equal([...index.values()].reduce((sum, lessons) => sum + lessons.length, 0), records.length);
  assert.equal(index.get('2026-11-14').length, 4);
  assert.equal(index.get('2026-11-14')[0].endTime, '09:30');
  assert.equal(index.has('2026-11-15'), false);
});

test('Warsaw dates and week navigation handle year and DST boundaries', () => {
  assert.equal(warsawToday(new Date('2026-11-13T23:30:00Z')), '2026-11-14');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-10-25', 1), '2026-10-26');
  assert.deepEqual(weekDates('2027-01-01'), ['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
});

test('malformed data is rejected rather than shown partially', () => {
  assert.throws(() => indexSchedule({}));
  const [valid] = JSON.parse(readFileSync(new URL('../data/schedule.json', import.meta.url)));
  assert.throws(() => indexSchedule([valid, valid]));
  assert.throws(() => indexSchedule([{...valid,date:'2026-02-30'}]));
  assert.throws(() => indexSchedule([{...valid,startTime:'24:00'}]));
  assert.doesNotThrow(() => indexSchedule([{...valid,lecturer:null,location:null}]));
});

test('facility categories and Polish counts', () => {
  assert.equal(locationTone('P'),'water');
  assert.equal(locationTone('B2'),'hall');
  assert.equal(locationTone('C'),'outdoor');
  assert.equal(locationTone(null),'other');
  assert.deepEqual([1,4,12,22].map(entryCount),['1 wpis','4 wpisy','12 wpisów','22 wpisy']);
});
