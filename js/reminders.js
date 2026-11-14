import {groupLabel} from './personal-plan.js';

const appScope = new URL('../', import.meta.url);
const workerUrl = new URL('sw.js', appScope).href;
const iconUrl = new URL('icons/icon-192.png', appScope).href;
const scopeKey = `wat-wf-plan.reminders.v1:${appScope.pathname}`;
const preferencesKey = `${scopeKey}:preferences`;
const sentKey = `${scopeKey}:sent`;
const leadChoices = [15, 30, 60];
const minute = 60_000;
const checkInterval = 15_000;

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The current tab can still operate when persistent storage is unavailable.
  }
}

function readPreferences() {
  const stored = readStorage(preferencesKey);
  return {
    enabled: stored?.enabled === true,
    leadMinutes: leadChoices.includes(stored?.leadMinutes) ? stored.leadMinutes : 30,
  };
}

function entryKey({lesson, startsAt}) {
  return `${lesson.id}:${startsAt}`;
}

function isDue({startsAt}, now, leadMinutes) {
  return Number.isFinite(startsAt) && startsAt > now && startsAt - now <= leadMinutes * minute;
}

export function createReminders({getEntries, onChange = () => {}}) {
  const workers = navigator.serviceWorker;
  const NotificationAPI = globalThis.Notification;
  const supported = window.isSecureContext && Boolean(workers) &&
    typeof NotificationAPI?.requestPermission === 'function';
  const shownHere = new Map();
  let preferences = readPreferences();
  let lastState;
  let requestingPermission = false;
  let preferencesVersion = 0;
  let checkRunning;
  let checkRequested = false;
  let error = null;

  function getState() {
    const permission = supported ? NotificationAPI.permission : 'unsupported';
    return {
      supported,
      permission,
      enabled: preferences.enabled && permission === 'granted',
      leadMinutes: preferences.leadMinutes,
      ready: supported && workers.controller?.scriptURL === workerUrl,
      error,
    };
  }

  function reportState() {
    const state = getState();
    const snapshot = JSON.stringify(state);
    if (snapshot !== lastState) {
      lastState = snapshot;
      onChange(state);
    }
    return state;
  }

  function savePreferences() {
    writeStorage(preferencesKey, preferences);
    reportState();
    void check();
  }

  async function displayDue() {
    let state = getState();
    const entries = getEntries();
    const checkedAt = Date.now();
    if (!state.enabled || !state.ready || !entries.some(entry => isDue(entry, checkedAt, state.leadMinutes))) return;

    const registration = await workers.getRegistration(appScope.href);
    if (registration?.scope !== appScope.href || registration.active?.scriptURL !== workerUrl ||
        typeof registration.showNotification !== 'function') return;

    function currentDue(key) {
      const current = getState();
      if (!current.enabled || !current.ready) return null;
      const entry = getEntries().find(entry => entryKey(entry) === key);
      return entry && isDue(entry, Date.now(), current.leadMinutes) ? entry : null;
    }

    const notify = async () => {
      state = getState();
      const now = Date.now();
      const stored = readStorage(sentKey);
      const sent = new Map(Object.entries(stored ?? {}).filter(([, start]) => Number.isFinite(start) && start > now));
      for (const [key, start] of shownHere) {
        if (start <= now) shownHere.delete(key);
        else sent.set(key, start);
      }
      const due = getEntries().filter(entry => isDue(entry, now, state.leadMinutes));
      for (const candidate of due) {
        const key = entryKey(candidate);
        if (sent.has(key) || !currentDue(key)) continue;

        const tag = `${scopeKey}:${key}`;
        const visible = await registration.getNotifications?.({tag}).catch(() => []);
        // Filtering, permission and time may change during the asynchronous lookup.
        const entry = currentDue(key);
        if (!entry) continue;
        if (!visible?.length) {
          const {lesson} = entry;
          const body = [lesson.topic, `Obiekt: ${lesson.location || 'niepodany'}`];
          if (lesson.company && lesson.platoon) body.push(groupLabel(lesson));
          await registration.showNotification(`WF o ${lesson.startTime}`, {
            body: body.join('\n'),
            icon: iconUrl,
            lang: 'pl',
            tag,
            data: {lessonDate: lesson.date},
          });
        }
        shownHere.set(key, entry.startsAt);
        sent.set(key, entry.startsAt);
        writeStorage(sentKey, Object.fromEntries(sent));
        if (error === 'delivery') {
          error = null;
          reportState();
        }
      }
    };

    // Serialize delivery and persisted deduplication when multiple tabs are open.
    if (navigator.locks) {
      await navigator.locks.request(scopeKey, {ifAvailable: true}, lock => lock ? notify() : undefined);
    } else {
      await notify();
    }
  }

  function check() {
    reportState();
    if (!supported) return;
    checkRequested = true;
    if (!checkRunning) {
      checkRunning = (async () => {
        while (checkRequested) {
          checkRequested = false;
          try {
            await displayDue();
          } catch (cause) {
            if (getState().enabled && error !== 'delivery') {
              error = 'delivery';
              reportState();
              console.warn('Nie udało się wyświetlić przypomnienia o zajęciach:', cause);
            }
          }
        }
        checkRunning = undefined;
      })();
    }
    return checkRunning;
  }

  async function enable() {
    const state = getState();
    const originalEntries = getEntries();
    if (!state.supported || state.permission === 'denied' || !originalEntries.length || requestingPermission) return state;

    // The browser prompt must run inside the click's user activation.
    requestingPermission = true;
    const version = preferencesVersion;
    error = null;
    try {
      const decision = state.permission === 'granted' ? 'granted' : await NotificationAPI.requestPermission();
      const currentEntries = getEntries();
      const sameScope = originalEntries.length === currentEntries.length &&
        originalEntries.every((entry, index) => entryKey(entry) === entryKey(currentEntries[index]));
      if (decision === 'granted' && version === preferencesVersion && sameScope) {
        preferences.enabled = true;
        savePreferences();
      }
    } catch (cause) {
      if (version === preferencesVersion) {
        error = 'permission';
        console.warn('Nie udało się uzyskać dostępu do powiadomień:', cause);
      }
    } finally {
      requestingPermission = false;
    }
    return reportState();
  }

  function disable() {
    preferencesVersion += 1;
    preferences.enabled = false;
    error = null;
    savePreferences();
  }

  function setLead(value) {
    const minutes = Number(value);
    if (!leadChoices.includes(minutes) || minutes === preferences.leadMinutes) return;
    preferences.leadMinutes = minutes;
    savePreferences();
  }

  if (supported) {
    workers.addEventListener('controllerchange', check);
    for (const event of ['focus', 'pageshow']) window.addEventListener(event, check);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check();
    });
    window.addEventListener('storage', event => {
      if (event.key !== preferencesKey && event.key !== null) return;
      preferencesVersion += 1;
      preferences = readPreferences();
      check();
    });
    setInterval(check, checkInterval);
  }

  return {getState, setLead, enable, disable, check};
}
