import {warsawToday, shiftDate, weekDates, formatDate, indexSchedule, locationTone, entryCount} from './js/schedule.js';

const get = id => document.getElementById(id);
let byDate = new Map(), selectedDate, firstDate, lastDate;
const today = warsawToday();

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
  meta.append(element('span', 'group-tag', lesson.company === lesson.platoon ? lesson.platoon : `${lesson.company} · ${lesson.platoon}`));
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

function render() {
  const lessons = byDate.get(selectedDate) || [];
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
    button.setAttribute('aria-label', `${formatDate(iso, {weekday:'long', day:'numeric', month:'long'})}, ${entryCount(byDate.get(iso)?.length || 0)}${iso === today ? ', dzisiaj' : ''}`);
    if (iso === today) button.setAttribute('aria-current', 'date');
    button.append(element('span','weekday', formatDate(iso, {weekday:'short'})), element('span','number', String(Number(iso.slice(-2)))));
    const dot = element('span', byDate.has(iso) ? 'day-indicator' : 'min-h-[5px]');
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
    empty.append(element('span','text-accent text-3xl','—'),element('h3','','Brak wpisów na ten dzień'), element('p','','W dostarczonym rozkładzie nie ma zajęć z tą datą. Wybierz inny dzień w kalendarzu.'));
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
    byDate = indexSchedule(records);
    if (!byDate.size) {
      state.replaceChildren(element('h2','','Plan nie zawiera jeszcze wpisów'),element('p','','Plik danych jest dostępny, ale nie zawiera zajęć do wyświetlenia.'));
      return;
    }
    const dates = [...byDate.keys()].sort();
    [firstDate,lastDate] = [dates[0], dates.at(-1)];
    selectedDate = today < firstDate ? firstDate : today > lastDate ? lastDate : today;
    get('date-picker').min = firstDate;
    get('date-picker').max = lastDate;
    get('data-range').textContent = `${formatDate(firstDate,{day:'2-digit',month:'2-digit',year:'numeric'})} — ${formatDate(lastDate,{day:'2-digit',month:'2-digit',year:'numeric'})}`;
    get('total-count').textContent = `${new Intl.NumberFormat('pl-PL').format(records.length)} wpisów w rozkładzie`;
    render();
    state.hidden = true;
    get('schedule').hidden = false;
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
get('today').addEventListener('click', () => select(today));
load();
