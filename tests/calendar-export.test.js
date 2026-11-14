import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCalendar} from '../js/calendar-export.js';
import {matchingPlan, preparePlan} from '../js/personal-plan.js';
import {indexSchedule} from '../js/schedule.js';

const records = JSON.parse(readFileSync(new URL('../data/schedule.json', import.meta.url)));
const now = new Date('2026-11-14T17:35:00Z');
const beforeClockChange = {
  id: 'pool-summer-time', date: '2026-10-05', startTime: '08:00', endTime: '09:35',
  company: '14 kp', platoon: '5 pl', lecturer: 'Anna Nowak',
  topic: 'Pływanie', location: 'Pływalnia', notes: '',
};
const afterClockChange = {...beforeClockChange, id: 'pool-winter-time', date: '2026-11-16'};

function unfoldedLines(calendar) {
  return calendar.replace(/\r\n[ \t]/g, '').split('\r\n');
}

test('exports stable lesson identities, Warsaw times in UTC, and one 30-minute alarm per event', () => {
  const calendar = buildCalendar([afterClockChange, beforeClockChange], {now});
  const lines = unfoldedLines(calendar);
  assert.ok(calendar.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
  assert.deepEqual(lines.filter(line => line.startsWith('DTSTART:')), ['DTSTART:20261005T060000Z', 'DTSTART:20261116T070000Z']);
  assert.deepEqual(lines.filter(line => line.startsWith('DTEND:')), ['DTEND:20261005T073500Z', 'DTEND:20261116T083500Z']);
  assert.equal(lines.filter(line => line === 'DTSTAMP:20261114T173500Z').length, 2);
  assert.equal(lines.filter(line => line === 'BEGIN:VALARM').length, 2);
  assert.equal(lines.filter(line => line === 'ACTION:DISPLAY').length, 2);
  assert.equal(lines.filter(line => line === 'TRIGGER:-PT30M').length, 2);

  const uids = lines.filter(line => line.startsWith('UID:'));
  assert.deepEqual(uids, [`UID:${beforeClockChange.id}@wat-wf-plan`, `UID:${afterClockChange.id}@wat-wf-plan`]);
  const exportedAgain = buildCalendar([beforeClockChange, afterClockChange], {now: new Date('2026-11-15T18:00:00Z')});
  assert.deepEqual(unfoldedLines(exportedAgain).filter(line => line.startsWith('UID:')), uids);
});

test('folds UTF-8 without splitting characters or allowing raw calendar lines from event text', () => {
  const topic = `${'Żółty 🏊'.repeat(16)}; tor, płot\\rzeka\r\nBEGIN:VALARM`;
  const location = 'Stadion, sektor A; wejście 2';
  const calendar = buildCalendar([{...afterClockChange, topic, location, lecturer: null, notes: 'Pierwsza\rDruga\nTrzecia'}], {now});
  const lines = unfoldedLines(calendar);
  assert.ok(calendar.includes('\r\n '));
  assert.equal(calendar.replaceAll('\r\n', '').search(/[\r\n]/), -1);
  assert.ok(calendar.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75));
  assert.deepEqual(lines.filter(line => line.startsWith('SUMMARY:')), [
    `SUMMARY:WF · ${'Żółty 🏊'.repeat(16)}\\; tor\\, płot\\\\rzeka\\nBEGIN:VALARM`,
  ]);
  assert.equal(lines.filter(line => line === 'BEGIN:VALARM').length, 1);
  assert.ok(lines.includes('LOCATION:Stadion\\, sektor A\\; wejście 2'));
  assert.ok(lines.some(line => line.includes('Prowadzący: Nie podano') && line.includes('Uwagi: Pierwsza\\nDruga\\nTrzecia')));
});

test('exports the current published records for a group across all dates', () => {
  const plan = preparePlan(indexSchedule(records));
  const [{company, group}] = plan;
  const filters = {company, group, lecturer: '', query: ''};
  const lessons = matchingPlan(plan, filters).map(({lesson}) => lesson);
  const lines = unfoldedLines(buildCalendar(lessons, {now}));
  const expected = records.filter(lesson => lesson.company === company && JSON.stringify([company, lesson.platoon]) === group);
  assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, expected.length);
  assert.equal(lines.filter(line => line === 'TRIGGER:-PT30M').length, expected.length);
});

test('rejects empty calendars and times skipped during the Warsaw spring clock change', () => {
  assert.throws(() => buildCalendar([], {now}), /Brak zajęć/);
  const invalid = {...beforeClockChange, date: '2026-03-29', startTime: '02:30', endTime: '04:00'};
  assert.throws(() => buildCalendar([invalid], {now}), /Nie można ustalić czasu/);
});
