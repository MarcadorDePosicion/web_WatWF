import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {indexSchedule, warsawToday, shiftDate, weekDates, locationTone, entryCount} from '../js/schedule.js';
import {
  preparePlan, filterOptions, matchingPlan, restoreFilters, saveFilters,
  warsawStart, upcomingLesson, countdownLabel,
} from '../js/personal-plan.js';

const records = JSON.parse(readFileSync(new URL('../data/schedule.json', import.meta.url)));
const poolLesson = {
  id: 'pool-1', date: '2026-11-16', startTime: '08:00', endTime: '09:35',
  company: '14 kp', platoon: '5 pl', lecturer: 'mgr Dawid Zapłata',
  topic: 'Pływanie', location: 'Pływalnia', locationCode: 'P',
  notes: '', kind: 'regular',
};
const retakeLesson = {
  ...poolLesson, id: 'retake', date: '2026-11-14', endTime: '09:30',
  company: 'Powtarzanie WF', platoon: 'II rok', lecturer: 'mgr Dawid ZAPŁATA',
  kind: 'retake',
};
const plan = preparePlan(indexSchedule([
  poolLesson,
  {...poolLesson, id: 'pool-2', date: '2026-11-23'},
  {...poolLesson, id: 'other-platoon', platoon: '1 pl'},
  {...poolLesson, id: 'other-company', company: '1 kp'},
  retakeLesson,
]));
const blank = {company: '', group: '', lecturer: '', query: ''};

test('the published schedule can be indexed without losing records', () => {
  const index = indexSchedule(records);
  assert.ok(index.size > 0);
  assert.equal([...index.values()].reduce((sum, lessons) => sum + lessons.length, 0), records.length);
});

test('retake durations are preserved and unscheduled dates have no records', () => {
  const index = indexSchedule([poolLesson, retakeLesson]);
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
  const valid = poolLesson;
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

test('company and group options narrow each other without mixing platoons', () => {
  const company = '14 kp';
  const group = JSON.stringify([company, '5 pl']);
  const labels = filterOptions(plan, {...blank, company}, 'group');
  assert.ok(labels.some(([value, label]) => value === group && label === '14 kp · 5 pl'));
  assert.ok(labels.every(([, label]) => label.startsWith('14 kp · ')));
  assert.deepEqual(filterOptions(plan, {...blank, group}, 'company'), [[company, company]]);
  const matches = matchingPlan(plan, {...blank, company, group, query: 'plywanie'});
  assert.deepEqual(matches.map(({lesson}) => lesson.id), ['pool-1', 'pool-2']);
});

test('lecturer selection includes uppercase spellings for retake lessons', () => {
  const options = filterOptions(plan, blank, 'lecturer');
  const entries = options.filter(([value]) => value.includes('dawid zapłata'));
  assert.equal(entries.length, 1);
  const results = matchingPlan(plan, {...blank, lecturer: entries[0][0], query: 'zaplata'});
  assert.ok(results.some(({lesson}) => lesson.kind === 'regular'));
  assert.ok(results.some(({lesson}) => lesson === retakeLesson));
});

test('saved filters survive loading and invalid or unavailable storage is tolerated', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
  });
  const saved = {...blank, company: '14 kp', group: JSON.stringify(['14 kp', '5 pl']), query: 'plywanie'};
  saveFilters(saved);
  assert.deepEqual(restoreFilters(plan), saved);
  saveFilters({...saved, group: JSON.stringify(['1 kp', '1 pl']), lecturer: 'usunięty prowadzący'});
  assert.deepEqual(restoreFilters(plan), {...saved, group: ''});
  storage.set([...storage.keys()][0], '{invalid');
  assert.deepEqual(restoreFilters(plan), blank);
  Object.defineProperty(globalThis, 'localStorage', {get() { throw new Error('Storage unavailable'); }});
  assert.deepEqual(restoreFilters(plan), blank);
  assert.doesNotThrow(() => saveFilters(saved));
});

test('upcoming lessons respect Warsaw time, date rollover and filter scope', () => {
  const matches = matchingPlan(plan, {...blank, company: '14 kp', group: JSON.stringify(['14 kp', '5 pl'])});
  const beforeStart = Date.parse('2026-11-16T05:45:00Z');
  const next = upcomingLesson(matches, beforeStart);
  assert.equal(next.lesson.date, '2026-11-16');
  assert.equal(new Date(next.startsAt).toISOString(), '2026-11-16T07:00:00.000Z');
  assert.equal(countdownLabel(next.startsAt - beforeStart), 'Za 1 godz. 15 min');
  assert.ok(upcomingLesson(matches, next.startsAt).startsAt > next.startsAt);
  assert.equal(upcomingLesson(matches, Date.parse('2027-02-01T00:00:00Z')), undefined);
});

test('Warsaw start resolves summer and winter offsets, including clock changes', () => {
  assert.equal(warsawStart('2026-10-24', '08:00'), Date.parse('2026-10-24T06:00:00Z'));
  assert.equal(warsawStart('2026-10-25', '08:00'), Date.parse('2026-10-25T07:00:00Z'));
  assert.equal(warsawStart('2026-10-25', '02:30'), Date.parse('2026-10-25T00:30:00Z'));
  assert.equal(warsawStart('2026-03-29', '02:30'), null);
});
