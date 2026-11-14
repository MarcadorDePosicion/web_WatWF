import assert from 'node:assert/strict';
import test from 'node:test';
import {createReminders} from '../js/reminders.js';

const scope = new URL('../', import.meta.url).href;
const scriptURL = new URL('sw.js', scope).href;
const fixedTime = Date.parse('2026-11-14T06:35:00Z');

function lesson(id, minutesAway) {
  return {
    startsAt: fixedTime + minutesAway * 60_000,
    lesson: {
      id, date: '2026-11-14', startTime: '08:00', topic: 'Pływanie', location: 'Pływalnia WAT',
      company: '14 kp', platoon: '5 pl',
    },
  };
}

function browser(t, {permission = 'default', controlled = true, entries = []} = {}) {
  const calls = [];
  const messages = [];
  const stored = new Map();
  const state = {entries, prompts: 0};
  const notifications = {
    permission,
    async requestPermission() {
      state.prompts++;
      this.permission = 'granted';
      return this.permission;
    },
  };
  const registration = {
    scope,
    active: {scriptURL},
    async showNotification(title, options) { calls.push({title, options}); },
    async getNotifications() { return []; },
  };
  const worker = new EventTarget();
  worker.controller = controlled ? {scriptURL} : null;
  worker.getRegistration = async () => registration;
  const window = new EventTarget();
  window.isSecureContext = true;

  const globals = {
    window, navigator: {serviceWorker: worker}, Notification: notifications, document: new EventTarget(),
    localStorage: {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)},
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
    Object.defineProperty(globalThis, key, {configurable: true, value});
  }
  t.mock.method(Date, 'now', () => fixedTime);
  t.mock.method(globalThis, 'setInterval', () => 1);
  const make = () => createReminders({getEntries: () => state.entries, onChange: next => messages.push(next)});
  return {make, messages, notifications, registration, stored, state, calls, worker};
}

test('an opted-in scope sends reminders only inside the lead window and deduplicates after reload', async t => {
  const {make, state, calls} = browser(t, {
    entries: [lesson('past', -2), lesson('started', 0), lesson('now-due', 25), lesson('later', 32)],
  });
  const reminders = make();
  await reminders.check();
  assert.equal(state.prompts, 0);
  assert.equal(calls.length, 0);
  reminders.setLead(15);
  await reminders.enable();
  await reminders.check();
  assert.equal(state.prompts, 1);
  assert.equal(calls.length, 0);
  reminders.setLead(30);
  await reminders.check();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, 'WF o 08:00');
  assert.equal(calls[0].options.body, 'Pływanie\nObiekt: Pływalnia WAT\n14 kp · 5 pl');
  assert.equal(calls[0].options.data.lessonDate, '2026-11-14');

  const reloaded = make();
  assert.equal(reloaded.getState().enabled, true);
  assert.equal(reloaded.getState().leadMinutes, 30);
  await reloaded.check();
  assert.equal(calls.length, 1);
  reloaded.setLead(60);
  await reloaded.check();
  assert.equal(calls.length, 2);
  reloaded.disable();
  state.entries = [lesson('new-selection', 26)];
  await reloaded.check();
  assert.equal(calls.length, 2);
  assert.equal(make().getState().enabled, false);
  assert.equal(make().getState().leadMinutes, 60);
});

test('empty selection and denied permission never cause a prompt', async t => {
  const {make, state, notifications, calls} = browser(t);
  const reminders = make();
  await reminders.enable();
  assert.equal(state.prompts, 0);
  state.entries = [lesson('meeting', 12)];
  notifications.permission = 'denied';
  await reminders.enable();
  await reminders.check();
  assert.equal(reminders.getState().enabled, false);
  assert.equal(reminders.getState().permission, 'denied');
  assert.equal(calls.length, 0);
  assert.equal(state.prompts, 0);
});

test('permission result does not enable reminders after the selected plan changes', async t => {
  const {make, state, notifications, calls} = browser(t, {entries: [lesson('original', 15)]});
  let grant;
  notifications.requestPermission = () => {
    state.prompts++;
    return new Promise(resolve => { grant = resolve; });
  };
  const reminders = make();
  const enabling = reminders.enable();
  assert.equal(state.prompts, 1, 'permission request takes place before any async boundary');
  state.entries = [lesson('different', 15)];
  notifications.permission = 'granted';
  grant('granted');
  await enabling;
  await reminders.check();
  assert.equal(reminders.getState().enabled, false);
  assert.equal(calls.length, 0);
});

test('delivery rechecks the selected entries after asynchronous notification lookup', async t => {
  const {make, state, registration, calls} = browser(t, {entries: [lesson('old-selection', 25)]});
  let resolveLookup;
  let lookupStarted;
  const lookup = new Promise(resolve => { lookupStarted = resolve; });
  registration.getNotifications = () => new Promise(resolve => {
    resolveLookup = resolve;
    lookupStarted();
  });
  const reminders = make();
  await reminders.enable();
  await lookup;
  state.entries = [];
  const checked = reminders.check();
  resolveLookup([]);
  await checked;
  assert.equal(calls.length, 0);
});

test('a failed notification remains in the status until successful delivery or disabling', async t => {
  const {make, registration, messages, state, calls} = browser(t, {entries: [lesson('blocked', 12)]});
  const show = registration.showNotification;
  registration.showNotification = async () => { throw new Error('Notifications unavailable'); };
  t.mock.method(console, 'warn', () => {});
  const reminders = make();
  await reminders.enable();
  await reminders.check();
  assert.equal(reminders.getState().error, 'delivery');
  assert.equal(messages.at(-1).error, 'delivery');
  assert.equal(calls.length, 0);

  state.entries = [];
  await reminders.check();
  assert.equal(reminders.getState().error, 'delivery');
  registration.showNotification = show;
  state.entries = [lesson('blocked', 12)];
  await reminders.check();
  assert.equal(reminders.getState().error, null);
  assert.equal(calls.length, 1);
});
