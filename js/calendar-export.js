import {groupLabel, warsawStart} from './personal-plan.js';
import {indexSchedule} from './schedule.js';

const utf8 = new TextEncoder();

function escapeText(value) {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

function foldLine(line) {
  if (utf8.encode(line).length <= 75) return line;
  const parts = [];
  let part = '';
  let length = 0;
  for (const character of line) {
    const bytes = utf8.encode(character).length;
    if (length + bytes > 75) {
      parts.push(part);
      part = ' ';
      length = 1;
    }
    part += character;
    length += bytes;
  }
  parts.push(part);
  return parts.join('\r\n');
}

function utcTimestamp(value) {
  return new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

function eventLines(lesson, stamp) {
  const start = warsawStart(lesson.date, lesson.startTime);
  const end = warsawStart(lesson.date, lesson.endTime);
  if (start === null || end === null || end <= start) {
    throw new Error(`Nie można ustalić czasu zajęć: ${lesson.date} ${lesson.startTime}–${lesson.endTime}.`);
  }

  const location = lesson.location || 'Nie podano';
  const description = [
    `Grupa: ${groupLabel(lesson)}`,
    `Prowadzący: ${lesson.lecturer || 'Nie podano'}`,
    `Obiekt: ${location}`,
  ];
  if (lesson.notes) description.push(`Uwagi: ${lesson.notes}`);

  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeText(lesson.id)}@wat-wf-plan`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utcTimestamp(start)}`,
    `DTEND:${utcTimestamp(end)}`,
    `SUMMARY:${escapeText(`WF · ${lesson.topic}`)}`,
    `DESCRIPTION:${escapeText(description.join('\n'))}`,
  ];
  if (lesson.location) lines.push(`LOCATION:${escapeText(location)}`);
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT30M',
    `DESCRIPTION:${escapeText(`${lesson.topic}\nObiekt: ${location}`)}`,
    'END:VALARM',
    'END:VEVENT',
  );
  return lines;
}

export function buildCalendar(lessons, {now = new Date()} = {}) {
  // Validate the exported records using the same rules as the displayed plan.
  const byDate = indexSchedule(lessons);
  if (!byDate.size) throw new Error('Brak zajęć do eksportu.');

  const stamp = utcTimestamp(now);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WAT WF Plan//Plan zajec//PL', 'CALSCALE:GREGORIAN'];
  for (const date of [...byDate.keys()].sort()) {
    for (const lesson of byDate.get(date)) lines.push(...eventLines(lesson, stamp));
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
