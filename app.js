import {warsawToday, shiftDate, weekDates, formatDate, indexSchedule, locationTone, entryCount} from './js/schedule.js';
import {registerOffline, setSavedPlanState} from './js/pwa.js';
import {buildCalendar} from './js/calendar-export.js';
import {createReminders} from './js/reminders.js';
import {
  preparePlan, filterOptions, matchingPlan, restoreFilters, saveFilters, filterStorageKey,
  normalizeSearch, groupLabel, upcomingLesson, countdownLabel,
} from './js/personal-plan.js';

const get = id => document.getElementById(id);
const filterLabels = {
  company: 'Wszystkie kompanie i wydziały',
  group: 'Wszystkie plutony i grupy',
  lecturer: 'Wszyscy prowadzący',
};
let plan = [], matches = [], visibleByDate = new Map();
let filters, selectedDate, firstDate, lastDate, upcoming, countdownTimer;
let requestingPermission = false;

const reminders = createReminders({getEntries: personalMatches, onChange: renderReminderSettings});

function personalMatches() {
  return filters?.group || filters?.lecturer ? matches : [];
}

function renderReminderSettings(state) {
  const entries = personalMatches();
  const toggle = get('toggle-reminders');
  const lead = get('reminder-lead');
  const status = get('reminder-status');
  const exportStatus = get('calendar-export-status');
  const selected = Boolean(filters?.group || filters?.lecturer);
  const noScope = 'Wybierz pluton, grupę lub prowadzącego.';
  const empty = 'Brak zajęć pasujących do filtrów.';

  lead.value = String(state.leadMinutes);
  lead.disabled = !state.supported;
  toggle.textContent = state.enabled ? 'Wyłącz powiadomienia' : 'Włącz powiadomienia';
  toggle.disabled = requestingPermission || (!state.enabled && (
    !state.supported || state.permission === 'denied' || !entries.length
  ));

  if (requestingPermission) status.textContent = 'Oczekiwanie na zgodę przeglądarki.';
  else if (!state.supported) status.textContent = 'Powiadomienia webowe są niedostępne w tym widoku. Na iPhonie otwórz aplikację z ekranu głównego.';
  else if (state.permission === 'denied') status.textContent = 'Powiadomienia są zablokowane. Zmień uprawnienia witryny w ustawieniach przeglądarki.';
  else if (!selected) status.textContent = noScope;
  else if (!entries.length) status.textContent = empty;
  else if (state.error === 'permission') status.textContent = 'Nie udało się poprosić o zgodę. Spróbuj ponownie lub użyj kalendarza.';
  else if (!state.enabled) status.textContent = 'Powiadomienia wyłączone.';
  else if (state.error === 'delivery') status.textContent = 'Przeglądarka nie wyświetliła przypomnienia. Sprawdź ustawienia powiadomień lub użyj kalendarza.';
  else if (!state.ready) status.textContent = 'Oczekiwanie na uruchomienie obsługi powiadomień.';
  else if (!upcomingLesson(entries, Date.now())) status.textContent = 'Powiadomienia włączone. Brak nowych terminów w wybranym planie.';
  else status.textContent = `Powiadomienia włączone · ${state.leadMinutes} min przed zajęciami.`;

  get('export-calendar').disabled = !entries.length;
  if (!selected) exportStatus.textContent = noScope;
  else if (!entries.length) exportStatus.textContent = empty;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function lessonCard(lesson) {
  const card = element('article', `lesson-card ${locationTone(lesson.locationCode)}`);
  const top = element('div', 'card-top');
  top.append(element('span', 'location-badge', lesson.location || 'Obiekt niepodany'), element('span', 'lesson-hours', `${lesson.startTime}–${lesson.endTime}`));
  const title = element('h3', '', lesson.topic);
  const meta = element('div', 'lesson-meta');
  meta.append(element('span', 'group-tag', groupLabel(lesson)));
  if (lesson.year && !lesson.platoon.includes('rok')) meta.append(element('span', '', /rok/i.test(lesson.year) ? lesson.year : `${lesson.year} rok`));
  if (lesson.kind === 'retake') meta.append(element('span', '', 'Powtarzanie przedmiotu'));
  card.append(top, title, meta, element('p', 'lecturer', lesson.lecturer || 'Prowadzący niepodany'));
  if (lesson.notes || lesson.sources?.length) {
    const details = element('details');
    details.append(element('summary', '', 'Uwagi i źródło'));
    if (lesson.notes) details.append(element('p', '', lesson.notes));
    for (const source of lesson.sources || []) {
      details.append(element('p', 'font-mono', `${source.file} · ${source.sheet} · ${source.cell}`));
    }
    card.append(details);
  }
  return card;
}

function hasFilters() {
  return Boolean(normalizeSearch(filters.query) || filters.company || filters.group || filters.lecturer);
}

function updateFilterOptions() {
  for (const [field, label] of Object.entries(filterLabels)) {
    const select = get(`filter-${field}`);
    const options = filterOptions(plan, filters, field);
    select.replaceChildren(new Option(label, ''), ...options.map(([value, name]) => new Option(name, value)));
    select.value = filters[field];
    select.disabled = options.length === 0;
  }
}

function updateUpcoming(now = Date.now(), refresh = false) {
  const next = upcomingLesson(matches, now);
  if (refresh || next !== upcoming) {
    upcoming = next;
    get('upcoming-details').hidden = !next;
    get('upcoming-empty').hidden = Boolean(next);
    get('upcoming-countdown').hidden = !next;
    if (next) {
      const {lesson} = next;
      const date = formatDate(lesson.date, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
      get('upcoming-time').textContent = `${date} · ${lesson.startTime}–${lesson.endTime}`;
      get('upcoming-topic').textContent = lesson.topic;
      get('upcoming-location').textContent = `Obiekt: ${lesson.location || 'niepodany'}`;
      get('upcoming-lecturer').textContent = `Prowadzący: ${lesson.lecturer || 'niepodany'}`;
      get('upcoming-group').textContent = groupLabel(lesson);
    } else {
      get('upcoming-empty').textContent = hasFilters()
        ? 'Brak nadchodzących zajęć pasujących do filtrów.'
        : 'Brak nadchodzących zajęć w tym rozkładzie.';
    }
  }
  if (next) {
    const label = countdownLabel(next.startsAt - now);
    const timer = get('upcoming-countdown');
    if (timer.textContent !== label) timer.textContent = label;
  }
}

function applyFilters({keepDate = false} = {}) {
  matches = matchingPlan(plan, filters);
  visibleByDate = new Map();
  for (const {lesson} of matches) {
    if (!visibleByDate.has(lesson.date)) visibleByDate.set(lesson.date, []);
    visibleByDate.get(lesson.date).push(lesson);
  }
  const active = hasFilters();
  const now = Date.now();
  if (!keepDate && active && !visibleByDate.has(selectedDate) && matches.length) {
    selectedDate = (upcomingLesson(matches, now) ?? matches.at(-1)).lesson.date;
  }
  get('clear-filters').disabled = !(filters.query || active);
  get('day-scope').textContent = active ? 'PLAN DNIA · WYBRANE FILTRY' : 'PLAN DNIA · WSZYSTKIE GRUPY';
  updateUpcoming(now, true);
  render();
  get('calendar-export-status').textContent = '';
  renderReminderSettings(reminders.getState());
  reminders.check();
}

function render() {
  const today = warsawToday();
  const lessons = visibleByDate.get(selectedDate) || [];
  get('date-picker').value = selectedDate;
  get('month-label').textContent = formatDate(selectedDate, {month:'long', year:'numeric'});
  get('day-title').textContent = formatDate(selectedDate, {weekday:'long', day:'numeric', month:'long'});
  get('day-count').textContent = entryCount(lessons.length);
  get('previous-day').disabled = selectedDate <= firstDate;
  get('next-day').disabled = selectedDate >= lastDate;
  get('today').disabled = today < firstDate || today > lastDate;
  get('today').title = get('today').disabled ? 'Dzisiejsza data jest poza zakresem tego planu.' : 'Przejdź do dzisiejszej daty';
  const week = weekDates(selectedDate).map(iso => {
    const button = element('button', 'week-day');
    button.type = 'button';
    button.disabled = iso < firstDate || iso > lastDate;
    button.setAttribute('aria-pressed', String(iso === selectedDate));
    button.setAttribute('aria-label', `${formatDate(iso, {weekday:'long', day:'numeric', month:'long'})}, ${entryCount(visibleByDate.get(iso)?.length || 0)}${iso === today ? ', dzisiaj' : ''}`);
    if (iso === today) button.setAttribute('aria-current', 'date');
    button.append(element('span','weekday', formatDate(iso, {weekday:'short'})), element('span','number', String(Number(iso.slice(-2)))));
    const dot = element('span', visibleByDate.has(iso) ? 'day-indicator' : 'min-h-[5px]');
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot);
    button.addEventListener('click', () => select(iso));
    return button;
  });
  // Preserve keyboard focus when replacing the week buttons.
  const focusedWeek = get('week').contains(document.activeElement);
  get('week').replaceChildren(...week);
  if (focusedWeek) get('week').querySelector('[aria-pressed="true"]').focus();
  const fragment = document.createDocumentFragment();
  const blocks = new Map();
  for (const lesson of lessons) {
    const key = `${lesson.startTime}–${lesson.endTime}`;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(lesson);
  }
  for (const [hours, entries] of blocks) {
    const block = element('section','time-block');
    block.setAttribute('aria-label', `Zajęcia ${hours}`);
    const time = element('h3','block-time', entries[0].startTime);
    time.append(element('span','',`do ${entries[0].endTime}`));
    const cards = element('div','block-cards');
    cards.append(...entries.map(lessonCard));
    block.append(time,cards);
    fragment.append(block);
  }
  if (!lessons.length) {
    const empty = element('div','state-panel');
    const title = hasFilters() && !matches.length ? 'Brak zajęć pasujących do filtrów' : 'Brak wpisów na ten dzień';
    const message = hasFilters() ? 'Zmień filtry lub wybierz inny dzień w kalendarzu.' : 'Wybierz inny dzień w kalendarzu.';
    empty.append(element('h3', '', title), element('p', '', message));
    fragment.append(empty);
  }
  get('timeline').replaceChildren(fragment);
}

function isPlanDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < firstDate || iso > lastDate) return false;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function select(iso) {
  if (!isPlanDate(iso)) return;
  selectedDate = iso;
  render();
}

async function load() {
  get('schedule').hidden = true;
  const state = get('load-state');
  state.hidden = false;
  state.replaceChildren(element('h2','','Wczytywanie planu'), element('p','','Pobieramy rozkład zajęć z dokumentów SWF WAT.'));
  try {
    const response = await fetch('./data/schedule.json', {signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const records = await response.json();
    const byDate = indexSchedule(records);
    setSavedPlanState(response.headers.get('X-WAT-Cache') === 'fallback');
    if (!byDate.size) {
      state.replaceChildren(element('h2','','Plan nie zawiera jeszcze wpisów'),element('p','','Plik danych jest dostępny, ale nie zawiera zajęć do wyświetlenia.'));
      return;
    }
    const dates = [...byDate.keys()].sort();
    [firstDate,lastDate] = [dates[0], dates.at(-1)];
    const today = warsawToday();
    selectedDate = today < firstDate ? firstDate : today > lastDate ? lastDate : today;
    const requestedDate = new URLSearchParams(window.location.search).get('date');
    const keepDate = isPlanDate(requestedDate);
    if (keepDate) selectedDate = requestedDate;
    get('date-picker').min = firstDate;
    get('date-picker').max = lastDate;
    get('data-range').textContent = `${formatDate(firstDate,{day:'2-digit',month:'2-digit',year:'numeric'})} — ${formatDate(lastDate,{day:'2-digit',month:'2-digit',year:'numeric'})}`;
    get('total-count').textContent = `${new Intl.NumberFormat('pl-PL').format(records.length)} wpisów w rozkładzie`;
    plan = preparePlan(byDate);
    filters = restoreFilters(plan);
    get('filter-query').value = filters.query;
    updateFilterOptions();
    applyFilters({keepDate});
    state.hidden = true;
    get('schedule').hidden = false;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(updateUpcoming, 1000);
  } catch (error) {
    console.error('Nie udało się wczytać planu:', error);
    state.replaceChildren(element('h2','','Nie udało się wczytać planu'), element('p','','Sprawdź połączenie i spróbuj ponownie. Jeśli uruchamiasz projekt lokalnie, otwórz go przez serwer HTTP, nie bezpośrednio z pliku.'));
    const retry = element('button','','Spróbuj ponownie');
    retry.addEventListener('click', load);
    state.append(retry);
  }
}

get('date-picker').addEventListener('change', event => {
  if (event.target.validity.valid) select(event.target.value);
  else event.target.value = selectedDate;
});
get('previous-day').addEventListener('click', () => select(shiftDate(selectedDate, -1)));
get('next-day').addEventListener('click', () => select(shiftDate(selectedDate, 1)));
get('today').addEventListener('click', () => select(warsawToday()));
get('plan-filters').addEventListener('submit', event => event.preventDefault());
get('filter-query').addEventListener('input', event => {
  filters.query = event.target.value;
  saveFilters(filters);
  applyFilters();
});
for (const field of Object.keys(filterLabels)) {
  get(`filter-${field}`).addEventListener('change', event => {
    filters[field] = event.target.value;
    updateFilterOptions();
    saveFilters(filters);
    applyFilters();
  });
}
get('clear-filters').addEventListener('click', () => {
  filters = {query: '', company: '', group: '', lecturer: ''};
  get('filter-query').value = '';
  get('filter-query').focus();
  updateFilterOptions();
  saveFilters(filters);
  applyFilters();
});
get('show-upcoming').addEventListener('click', () => {
  if (!upcoming) return;
  select(upcoming.lesson.date);
  const heading = get('day-title');
  heading.focus({preventScroll: true});
  heading.scrollIntoView({block: 'start'});
});
get('reminder-lead').addEventListener('change', event => {
  reminders.setLead(Number(event.target.value));
});
get('toggle-reminders').addEventListener('click', async () => {
  if (reminders.getState().enabled) {
    reminders.disable();
    return;
  }
  requestingPermission = true;
  renderReminderSettings(reminders.getState());
  try {
    await reminders.enable();
  } finally {
    requestingPermission = false;
    renderReminderSettings(reminders.getState());
  }
});
get('export-calendar').addEventListener('click', () => {
  const entries = personalMatches();
  if (!entries.length) return;
  const status = get('calendar-export-status');
  try {
    const content = buildCalendar(entries.map(({lesson}) => lesson));
    const url = URL.createObjectURL(new Blob([content], {type: 'text/calendar;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wat-wf-plan.ics';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status.textContent = `Plik gotowy do importu · ${entryCount(entries.length)}.`;
  } catch (error) {
    console.error('Eksport planu do kalendarza nie powiódł się:', error);
    status.textContent = 'Nie udało się przygotować pliku kalendarza.';
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && filters) updateUpcoming();
});
// Keep reminder scope aligned when the personal plan is edited in another tab.
window.addEventListener('storage', event => {
  if (!filters || (event.key !== filterStorageKey && event.key !== null)) return;
  filters = restoreFilters(plan);
  get('filter-query').value = filters.query;
  updateFilterOptions();
  applyFilters();
});
load();
registerOffline();
