export function warsawToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
}

export function shiftDate(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekDates(iso) {
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const monday = shiftDate(iso, -((weekday + 6) % 7));
  return Array.from({length: 7}, (_, i) => shiftDate(monday, i));
}

export function formatDate(iso, options) {
  return new Intl.DateTimeFormat('pl-PL', {...options, timeZone: 'UTC'}).format(new Date(`${iso}T12:00:00Z`));
}

export function indexSchedule(records) {
  if (!Array.isArray(records)) throw new Error('Nieprawidłowy format planu.');
  const byDate = new Map();
  const ids = new Set();
  for (const entry of records) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.endTime) || entry.endTime <= entry.startTime ||
        ['company', 'platoon', 'topic', 'notes'].some(key => typeof entry[key] !== 'string') ||
        ['lecturer', 'location'].some(key => entry[key] !== null && typeof entry[key] !== 'string')) {
      throw new Error('Plan zawiera nieprawidłowy rekord.');
    }
    const date = new Date(`${entry.date}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== entry.date) throw new Error('Nieprawidłowa data zajęć.');
    ids.add(entry.id);
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }
  for (const lessons of byDate.values()) lessons.sort((a,b) => a.startTime.localeCompare(b.startTime) || a.company.localeCompare(b.company, 'pl', {numeric:true}) || a.platoon.localeCompare(b.platoon, 'pl', {numeric:true}));
  return byDate;
}

export function locationTone(code) {
  if (code === 'P') return 'water';
  if (['B','B1','B2','B3','H','M','J','G','X'].includes(code)) return 'hall';
  if (['S','E'].includes(code)) return 'strength';
  if (['T','Ż','L','O','K','D','A','C','F','N'].includes(code)) return 'outdoor';
  return 'other';
}

export function entryCount(count) {
  const mod10 = count % 10, mod100 = count % 100;
  const word = count === 1 ? 'wpis' : (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? 'wpisy' : 'wpisów');
  return `${count} ${word}`;
}
