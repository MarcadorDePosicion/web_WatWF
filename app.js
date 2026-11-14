import {warsawToday, shiftDate, weekDates, formatDate, indexSchedule, locationTone, entryCount} from './js/schedule.js';
import {
  preparePlan, filterOptions, matchingPlan, restoreFilters, saveFilters,
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

function applyFilters() {
  matches = matchingPlan(plan, filters);
  visibleByDate = new Map();
  for (const {lesson} of matches) {
    if (!visibleByDate.has(lesson.date)) visibleByDate.set(lesson.date, []);
    visibleByDate.get(lesson.date).push(lesson);
  }
  const active = hasFilters();
  const now = Date.now();
  if (active && !visibleByDate.has(selectedDate) && matches.length) {
    selectedDate = (upcomingLesson(matches, now) ?? matches.at(-1)).lesson.date;
  }
  get('clear-filters').disabled = !(filters.query || active);
  get('day-scope').textContent = active ? 'PLAN DNIA · WYBRANE FILTRY' : 'PLAN DNIA · WSZYSTKIE GRUPY';
  updateUpcoming(now, true);
  render();
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

function select(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < firstDate || iso > lastDate) return;
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
    if (!byDate.size) {
      state.replaceChildren(element('h2','','Plan nie zawiera jeszcze wpisów'),element('p','','Plik danych jest dostępny, ale nie zawiera zajęć do wyświetlenia.'));
      return;
    }
    const dates = [...byDate.keys()].sort();
    [firstDate,lastDate] = [dates[0], dates.at(-1)];
    const today = warsawToday();
    selectedDate = today < firstDate ? firstDate : today > lastDate ? lastDate : today;
    get('date-picker').min = firstDate;
    get('date-picker').max = lastDate;
    get('data-range').textContent = `${formatDate(firstDate,{day:'2-digit',month:'2-digit',year:'numeric'})} — ${formatDate(lastDate,{day:'2-digit',month:'2-digit',year:'numeric'})}`;
    get('total-count').textContent = `${new Intl.NumberFormat('pl-PL').format(records.length)} wpisów w rozkładzie`;
    plan = preparePlan(byDate);
    filters = restoreFilters(plan);
    get('filter-query').value = filters.query;
    updateFilterOptions();
    applyFilters();
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
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && filters) updateUpcoming();
});
load();
