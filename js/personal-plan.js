const collator = new Intl.Collator('pl', {numeric: true});
const storageKey = 'wat-wf-plan.filters.v1';
const filterFields = ['company', 'group', 'lecturer'];
const emptyFilters = {query: '', company: '', group: '', lecturer: ''};

export function groupLabel(lesson) {
  return lesson.company === lesson.platoon ? lesson.platoon : `${lesson.company} · ${lesson.platoon}`;
}

export function normalizeSearch(value) {
  return value.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '')
    .replaceAll('ł', 'l').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function preparePlan(byDate) {
  const plan = [];
  const startTimes = new Map();
  for (const date of [...byDate.keys()].sort()) {
    for (const lesson of byDate.get(date)) {
      const slot = `${lesson.date}T${lesson.startTime}`;
      if (!startTimes.has(slot)) startTimes.set(slot, warsawStart(lesson.date, lesson.startTime));
      const lecturer = lesson.lecturer?.trim() ?? '';
      plan.push({
        lesson,
        startsAt: startTimes.get(slot),
        company: lesson.company,
        group: JSON.stringify([lesson.company, lesson.platoon]),
        lecturer: lecturer.toLocaleLowerCase('pl'),
        search: normalizeSearch([
          lesson.company, lesson.company.replaceAll(' ', ''), lesson.platoon,
          lesson.platoon.replaceAll(' ', ''), lesson.group, lesson.lecturer,
          lesson.topic, lesson.location, lesson.sourceCode,
        ].join(' ')),
      });
    }
  }
  return plan;
}

function matchesSelection(entry, filters, except) {
  return filterFields.every(field => field === except || !filters[field] || entry[field] === filters[field]);
}

export function filterOptions(plan, filters, field) {
  const options = new Map();
  for (const entry of plan) {
    const value = entry[field];
    if (!value || options.has(value) || !matchesSelection(entry, filters, field)) continue;
    const {lesson} = entry;
    const label = field === 'group' ? groupLabel(lesson) : lesson[field].trim();
    options.set(value, label);
  }
  return [...options].sort(([, a], [, b]) => collator.compare(a, b));
}

export function matchingPlan(plan, filters) {
  const query = normalizeSearch(filters.query);
  const words = query ? query.split(' ') : [];
  return plan.filter(entry => matchesSelection(entry, filters) && words.every(word => entry.search.includes(word)));
}

export function restoreFilters(plan) {
  const filters = {...emptyFilters};
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return filters;
  }
  if (!stored || typeof stored !== 'object') return filters;
  if (typeof stored.query === 'string') filters.query = stored.query.slice(0, 120);
  for (const field of filterFields) {
    if (filterOptions(plan, filters, field).some(([value]) => value === stored[field])) {
      filters[field] = stored[field];
    }
  }
  return filters;
}

export function saveFilters(filters) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(filters));
  } catch {
    // Filters remain usable when browser storage is disabled or full.
  }
}

const offsetFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Warsaw', timeZoneName: 'longOffset', hour: '2-digit',
});

function offsetAt(timestamp) {
  const zone = offsetFormatter.formatToParts(timestamp).find(part => part.type === 'timeZoneName').value;
  const [, sign, hours, minutes] = zone.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
}

export function warsawStart(date, time) {
  const wallTime = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set([offsetAt(wallTime - 86_400_000), offsetAt(wallTime + 86_400_000)]);
  // The earlier occurrence wins on clock rollback. A skipped local time has no instant.
  const instants = [...offsets].map(offset => wallTime - offset)
    .filter(instant => instant + offsetAt(instant) === wallTime);
  return instants.length ? Math.min(...instants) : null;
}

export function upcomingLesson(plan, now) {
  return plan.find(entry => entry.startsAt !== null && entry.startsAt > now);
}

export function countdownLabel(milliseconds) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `Za ${seconds} sek.`;
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'dzień' : 'dni'}`);
  if (hours) parts.push(`${hours} godz.`);
  if (minutes % 60 || !parts.length) parts.push(`${minutes % 60} min`);
  return `Za ${parts.join(' ')}`;
}
