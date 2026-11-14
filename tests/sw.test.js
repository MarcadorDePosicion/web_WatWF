import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const scope = 'https://example.test/web_WatWF/';
const prefix = `wat-wf:${scope}:`;
const readAsset = (path, encoding) => readFileSync(new URL(`../${path}`, import.meta.url), encoding);
const source = readAsset('sw.js', 'utf8');
const schedule = readAsset('data/schedule.json', 'utf8');
const metadata = readAsset('data/schedule.meta.json', 'utf8');
const json = body => new Response(body, {headers: {'Content-Type': 'application/json'}});
const schedulePath = 'data/schedule.json';
const metadataPath = 'data/schedule.meta.json';

function worker({clock = setTimeout, windows = []} = {}) {
  const listeners = new Map();
  const stores = new Map();
  const state = {claimed: false, networkRequests: [], openedWindows: []};
  state.network = async url => {
    if (url === `${scope}${schedulePath}`) return json(schedule);
    if (url === `${scope}${metadataPath}`) return json(metadata);
    return new Response(readAsset(url.slice(scope.length)));
  };
  const fetch = async (request, options) => {
    const url = request.url ?? request;
    state.networkRequests.push(url);
    return state.network(url, options);
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: key => store.get(key)?.clone(),
        put: (key, response) => Promise.resolve(store.set(key, response)),
        async addAll(requests) {
          const responses = await Promise.all(requests.map(fetch));
          if (responses.some(response => !response.ok)) throw new Error('Precache request failed');
          requests.forEach((request, index) => store.set(request.url, responses[index]));
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: name => stores.delete(name),
    match: async (key, {cacheName}) => stores.get(cacheName)?.get(key)?.clone(),
  };
  runInNewContext(source, {
    self: {
      registration: {scope},
      clients: {
        claim: () => { state.claimed = true; },
        matchAll: async ({type}) => type === 'window' ? windows : [],
        openWindow: async url => { state.openedWindows.push(url); },
      },
      addEventListener: (name, callback) => listeners.set(name, callback),
    },
    caches, fetch, URL, Request, Response, Headers, AbortController, setTimeout: clock, clearTimeout,
  });
  return {
    state,
    stores,
    lifecycle(name) {
      let result;
      listeners.get(name)({waitUntil: promise => { result = promise; }});
      return result;
    },
    request(url, {mode = 'cors', method = 'GET', headers = new Headers()} = {}) {
      let result;
      listeners.get('fetch')({request: {url, mode, method, headers}, respondWith: promise => { result = promise; }});
      return result;
    },
    notificationClick(data) {
      let completion;
      let closed = false;
      listeners.get('notificationclick')({
        notification: {data, close: () => { closed = true; }},
        waitUntil: promise => { completion = promise; },
      });
      return {closed, completion};
    },
  };
}

test('offline boot serves the scoped app shell and real schedule data', async () => {
  const app = worker();
  await app.lifecycle('install');
  await app.lifecycle('activate');
  assert.equal(app.state.claimed, true);
  app.state.network = () => { throw new Error('Offline'); };
  const home = await app.request(`${scope}?start=home`, {mode: 'navigate'});
  assert.equal(await home.text(), readAsset('index.html', 'utf8'));
  for (const path of [
    'app.js', 'js/schedule.js', 'js/personal-plan.js', 'js/install.js', 'js/pwa.js',
    'js/reminders.js', 'js/calendar-export.js', 'styles/app.css', 'manifest.json',
  ]) {
    assert.equal(await (await app.request(`${scope}${path}`)).text(), readAsset(path, 'utf8'));
  }
  const manifest = JSON.parse(readAsset('manifest.json', 'utf8'));
  for (const icon of manifest.icons) {
    const path = icon.src.replace(/^\.\//, '');
    const bytes = await (await app.request(`${scope}${path}`)).arrayBuffer();
    assert.deepEqual(Buffer.from(bytes), readAsset(path));
  }
  const plan = await app.request(`${scope}${schedulePath}`);
  const details = await app.request(`${scope}${metadataPath}`, {mode: 'navigate'});
  assert.equal(plan.headers.get('X-WAT-Cache'), 'fallback');
  assert.equal(details.headers.get('X-WAT-Cache'), 'fallback');
  assert.equal((await plan.json()).length, (await details.json()).report.recordCount);
  assert.equal(app.request('https://example.test/other/app.js'), undefined);
  assert.equal(app.request('https://outside.test/web_WatWF/app.js'), undefined);
  assert.equal(app.request(`${scope}data/sources/plan.xlsx`), undefined);
  assert.equal(app.request(`${scope}${schedulePath}`, {method: 'POST'}), undefined);
});

test('a valid network update replaces cached data and invalid responses leave it intact', async () => {
  const app = worker();
  await app.lifecycle('install');
  const [lesson] = JSON.parse(schedule);
  const fresh = JSON.stringify([{...lesson, topic: 'Zaktualizowany temat'}]);
  app.state.network = () => json(fresh);
  const response = await app.request(`${scope}${schedulePath}`);
  assert.equal(response.headers.get('X-WAT-Cache'), null);
  assert.equal(await response.text(), fresh);

  for (const failure of [
    () => new Response('Not found', {status: 404}),
    () => new Response('<html>Portal zastępczy</html>', {headers: {'Content-Type': 'text/html'}}),
    () => json('{invalid'),
    () => json(JSON.stringify([{...lesson, date: '2026-02-30'}])),
    () => { throw new Error('Offline'); },
  ]) {
    app.state.network = failure;
    const cached = await app.request(`${scope}${schedulePath}`);
    assert.equal(cached.headers.get('X-WAT-Cache'), 'fallback');
    assert.equal(await cached.text(), fresh);
  }
});

test('a stalled data request is aborted and falls back to the installed schedule', async () => {
  let timeout;
  const app = worker({clock: (callback, delay) => {
    timeout = delay;
    return setTimeout(callback, 0);
  }});
  await app.lifecycle('install');
  app.state.network = (_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
  });
  const response = await app.request(`${scope}${schedulePath}`);
  assert.ok(timeout < 20_000);
  assert.equal(response.headers.get('X-WAT-Cache'), 'fallback');
  assert.equal(await response.text(), schedule);
});

test('failed replacement leaves old cache intact; activation removes only this scope’s older versions', async () => {
  const app = worker();
  app.stores.set(`${prefix}old`, new Map());
  app.stores.set('wat-wf:https://example.test/other/:v1', new Map());
  app.stores.set('unrelated-cache', new Map());
  const goodNetwork = app.state.network;
  app.state.network = url => url === `${scope}${metadataPath}` ? json('{}') : goodNetwork(url);
  await assert.rejects(app.lifecycle('install'), /Invalid schedule data/);
  assert.equal(app.stores.size, 3);
  assert.equal(app.stores.has(`${prefix}old`), true);

  app.state.network = goodNetwork;
  await app.lifecycle('install');
  await app.lifecycle('activate');
  assert.equal(app.stores.has(`${prefix}old`), false);
  assert.equal(app.stores.has('wat-wf:https://example.test/other/:v1'), true);
  assert.equal(app.stores.has('unrelated-cache'), true);
});

test('a notification click navigates and focuses this app’s window for the lesson date', async () => {
  const lessonDate = '2026-11-16';
  const target = `${scope}?date=${lessonDate}`;
  const calls = [];
  const appWindow = {
    url: `${scope}index.html`,
    async navigate(url) {
      calls.push(['navigate', url]);
      return {focus: () => calls.push(['focus'])};
    },
  };
  const app = worker({windows: [{url: 'https://example.test/other/'}, appWindow]});
  const click = app.notificationClick({lessonDate});
  assert.equal(click.closed, true);
  await click.completion;
  assert.deepEqual(calls, [['navigate', target], ['focus']]);
  assert.deepEqual(app.state.openedWindows, []);
});

test('a notification click focuses a window that already shows the lesson date', async () => {
  const lessonDate = '2026-11-16';
  let focused = false;
  const app = worker({windows: [{url: `${scope}?date=${lessonDate}`, focus: () => { focused = true; }}]});
  await app.notificationClick({lessonDate}).completion;
  assert.equal(focused, true);
  assert.deepEqual(app.state.openedWindows, []);
});

test('a notification click opens only the scoped date URL when navigation is unavailable', async () => {
  const lessonDate = '2026-11-16';
  const app = worker({windows: [{url: scope, async navigate() { throw new Error('Navigation unavailable'); }}]});
  await app.notificationClick({lessonDate, url: 'https://outside.test/'}).completion;
  assert.deepEqual(app.state.openedWindows, [`${scope}?date=${lessonDate}`]);

  const invalid = app.notificationClick({lessonDate: 'https://outside.test/'});
  assert.equal(invalid.completion, undefined);
  assert.equal(app.state.openedWindows.length, 1);
});
