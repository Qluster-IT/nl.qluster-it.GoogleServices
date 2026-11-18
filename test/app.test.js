'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');

function loadApp({ getVoices = async () => [], textToSpeech = {}, ttsServer } = {}) {
  const filename = require.resolve('../app');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  m.require = id => {
    if (id === 'homey') return { App: class {} };
    if (id === 'google-tts-api') return {};
    if (id === '@google-cloud/text-to-speech/build/src/v1') return textToSpeech;
    if (id === 'betterlogiclibrary') return { BL: { init: async () => {}, decode: async text => text } };
    if (id === './lib/tts-server') return ttsServer || { init() {}, setClient() {}, getVoices, getUrl: async () => ({}) };
    return Module.prototype.require.call(m, id);
  };
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  return m.exports;
}

function createDevice() {
  return { getSetting: () => 0 };
}

test('replacing speech settles the previous finished wait instead of leaving its Flow pending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const App = loadApp();
  const app = new App();
  const triggered = [];
  app.Triggers.finished_trigger.Card = { trigger: (device, tokens) => { triggered.push(tokens.text); return true; } };
  const device = createDevice();

  const first = app.SetFinishedTimer(device, { duration: 5000, text: 'first' });
  const second = app.SetFinishedTimer(device, { duration: 5000, text: 'second' });
  assert.equal(await first, false);

  t.mock.timers.tick(6000);
  assert.equal(await second, true);
  assert.deepEqual(triggered, ['second']);
  assert.equal(device.finishedTimer, null);
  assert.equal(device.finishedDefer, null);

  app.ClearFinishedTimer(device);
});

test('voice autocomplete resolves to an empty list when voices cannot be loaded', async () => {
  const App = loadApp({ getVoices: async () => { throw new Error('no credentials'); } });
  const app = new App();
  const autocompletes = [];
  const card = {
    registerRunListener() { return card; },
    getArgument: () => ({ registerAutocompleteListener: listener => autocompletes.push(listener) })
  };
  app.log = () => {};
  app.homey = {
    settings: { on() {}, get: async () => null },
    notifications: { createNotification: async () => {} },
    flow: { getActionCard: () => card, getConditionCard: () => card, getDeviceTriggerCard: () => card }
  };
  app.Triggers.finished_trigger = { List: [], Card: null };

  await app.onInit();
  assert.ok(autocompletes.length > 0);
  const result = await Promise.race([
    autocompletes[0]('nl', {}),
    new Promise(resolve => setImmediate(() => resolve('pending')))
  ]);
  assert.deepEqual(result, []);
});

test('Google Translate speech cards fail the Flow when the text is longer than 200 characters', async () => {
  const App = loadApp();
  const app = new App();
  const runs = {};
  const card = id => ({
    registerRunListener(listener) { runs[id] = listener; return this; },
    getArgument: () => ({ registerAutocompleteListener() {} })
  });
  app.log = () => {};
  app.homey = {
    settings: { on() {}, get: async () => null },
    notifications: { createNotification: async () => {} },
    flow: { getActionCard: card, getConditionCard: card, getDeviceTriggerCard: card }
  };
  app.Triggers.finished_trigger = { List: [], Card: null };
  await app.onInit();
  const log = console.log;
  console.log = () => {};
  try {
    for (const id of ['start_googletts', 'start_googletts_slow', 'start_googletts_af', 'start_googletts_slow_af']) {
      await assert.rejects(runs[id]({ device: {}, text: 'x'.repeat(201) }), /Max 200 characters/, id);
    }
  } finally { console.log = log; }
});

test('the TTS server has homey before startup looks up the default voice', async () => {
  const order = [];
  const App = loadApp({ ttsServer: { init: ({ homey }) => order.push(homey ? 'init' : 'init without homey'), setClient() {}, getVoices: async () => { order.push('getVoices'); return []; } } });
  const app = new App();
  const card = { registerRunListener() { return card; }, getArgument: () => ({ registerAutocompleteListener() {} }) };
  app.log = () => {};
  app.homey = {
    settings: { on() {}, get: async () => null },
    notifications: { createNotification: async () => {} },
    flow: { getActionCard: () => card, getConditionCard: () => card, getDeviceTriggerCard: () => card }
  };
  app.Triggers.finished_trigger = { List: [], Card: null };
  await app.onInit();
  assert.deepEqual(order, ['init', 'getVoices']);
});

function compile(file, stubs) {
  const filename = require.resolve(file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  const loaded = [];
  m.require = id => {
    loaded.push(id);
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    return Module.prototype.require.call(m, id);
  };
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { exports: m.exports, loaded };
}

test('Maps calculates the four modes, with traffic only for driving and geometry only for the device image', async () => {
  const { Response } = require('node-fetch');
  const calls = [];
  const maps = compile('../lib/maps', {
    'node-fetch': async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ routes: [{
        duration: '90s', distanceMeters: 1234, polyline: { encodedPolyline: 'a?b' }
      }] }));
    }
  }).exports;
  for (const [mode, linkMode] of [['DRIVE', 'driving'], ['TRANSIT', 'transit'], ['WALK', 'walking'], ['BICYCLE', 'bicycling']]) {
    const showMap = mode === 'DRIVE';
    const input = maps.parseRoute('52.1, 4.3', 'Central Station, Utrecht', mode);
    const { tokens } = await maps.computeRoute('fake-key', input, showMap);
    const { options } = calls.at(-1);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.origin, { location: { latLng: { latitude: 52.1, longitude: 4.3 } } });
    assert.deepEqual(body.destination, { address: 'Central Station, Utrecht' });
    assert.equal(body.travelMode, mode);
    assert.equal(body.routingPreference, showMap ? 'TRAFFIC_AWARE' : undefined);
    assert.equal(options.headers['X-Goog-FieldMask'].includes('encodedPolyline'), showMap);
    assert.equal(tokens.minutes, 1.5);
    assert.equal(tokens.kilometers, 1.23);
    assert.ok(Date.parse(tokens.eta) >= Date.now() + 85000);
    assert.equal(new URL(tokens.link).searchParams.get('travelmode'), linkMode);
    assert.ok(!tokens.link.includes('fake-key'));
  }
  assert.throws(() => maps.parseRoute('98, 4', 'Utrecht', 'WALK'), /Coordinates/);
});

test('Maps autocomplete uses the dedicated Places endpoint and reports errors without leaking the key', async () => {
  const { Response } = require('node-fetch');
  let response = { suggestions: [{ placePrediction: { placeId: 'ChIJ_example', text: { text: 'Example address' } } }] };
  let status = 200;
  let calls = 0;
  const maps = compile('../lib/maps', {
    'node-fetch': async (url, options) => {
      calls++;
      assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
      assert.equal(options.headers['X-Goog-Api-Key'], 'example-secret');
      assert.deepEqual(JSON.parse(options.body), { input: 'Utrecht', languageCode: 'nl' });
      if (response instanceof Error) throw response;
      return new Response(Readable.from([Buffer.from(JSON.stringify(response))]), { status });
    }
  }).exports;
  await assert.rejects(() => maps.autocompletePlaces('example-secret', 'ab', 'nl'), /3 and 512/);
  assert.equal(calls, 0);
  assert.deepEqual(await maps.autocompletePlaces('example-secret', ' Utrecht ', 'nl'), [
    { label: 'Example address', value: 'place_id:ChIJ_example' }
  ]);
  response = {};
  assert.deepEqual(await maps.autocompletePlaces('example-secret', 'Utrecht', 'nl'), []);
  response = { suggestions: [{}] };
  await assert.rejects(() => maps.autocompletePlaces('example-secret', 'Utrecht', 'nl'), /invalid address/);
  status = 403;
  await assert.rejects(() => maps.autocompletePlaces('example-secret', 'Utrecht', 'nl'), /Places API \(New\) denied access/);
  response = new Error('Request headers included example-secret');
  await assert.rejects(() => maps.autocompletePlaces('example-secret', 'Utrecht', 'nl'), error => {
    assert.match(error.message, /could not be reached/);
    assert.ok(!error.message.includes('example-secret'));
    return true;
  });
});

test('Maps pairing validates the route and keeps settings isolated between sessions', async () => {
  let searches = 0;
  let searchError;
  const Driver = compile('../drivers/maps/driver', {
    homey: { Driver: class {} },
    '../../lib/maps': {
      ...require('../lib/maps'),
      autocompletePlaces: async (key, query, language) => {
        searches++;
        assert.deepEqual([key, query, language], ['fake-key', 'Utrecht', 'nl']);
        if (searchError) throw searchError;
        return [{ label: 'Utrecht', value: 'place_id:ChIJ_example' }];
      }
    }
  }).exports;
  const driver = new Driver();
  driver.getDevices = () => [];
  const errors = [];
  driver.error = (...args) => errors.push(args);
  driver.homey = {
    settings: { get: () => 'fake-key' }, i18n: { getLanguage: () => 'nl' },
    __: (key, tokens) => tokens?.address || tokens?.error || key
  };
  const handlers = {};
  const other = {};
  driver.onPair({ setHandler: (name, fn) => { handlers[name] = fn; } });
  driver.onPair({ setHandler: (name, fn) => { other[name] = fn; } });
  assert.equal(searches, 0);
  await assert.rejects(() => handlers.list_devices(), /Configure/);
  const suggestions = await handlers.search_address('Utrecht');
  assert.deepEqual(suggestions.map(result => result.id), ['place_id:ChIJ_example', 'Utrecht']);
  assert.equal(suggestions[0].google, true);
  assert.deepEqual(suggestions[1], { name: 'Utrecht', id: 'Utrecht', description: 'maps.address.typed_help' });
  assert.deepEqual(await handlers.search_address(''), []);
  assert.deepEqual((await handlers.search_address(' 52, 4 '))[0], {
    name: '52, 4', id: '52,4', description: 'maps.address.typed_help'
  });
  assert.equal((await handlers.search_address('A'))[0].id, 'A');
  assert.equal(searches, 1);
  searchError = new Error('Places API (New) denied access.');
  const fallback = await handlers.search_address('Utrecht');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].id, 'Utrecht');
  assert.equal(fallback[0].name, 'Utrecht');
  assert.match(fallback[0].description, /denied access/);
  assert.equal(errors.length, 1);
  searchError = new TypeError('Unexpected programming error');
  await assert.rejects(() => handlers.search_address('Utrecht'), /Unexpected programming error/);
  const settings = { origin: 'place_id:ChIJ_example', destination: '52,4', travel_mode: 'WALK', route_image: false };
  await handlers.save_route(settings);
  const [paired] = await handlers.list_devices();
  assert.equal(paired.name, 'Maps device');
  assert.deepEqual(paired.settings, settings);
  await assert.rejects(() => other.list_devices(), /Configure/);
  await assert.rejects(() => handlers.save_route({ ...settings, origin: '' }), /origin and destination/);
  await assert.rejects(() => handlers.save_route({ ...settings, travel_mode: 'FLY' }), /travel mode/);
  await assert.rejects(() => handlers.save_route({ ...settings, route_image: 'true' }), /route image/);
  assert.deepEqual((await handlers.list_devices())[0].settings, settings);
});

test('Maps selected place IDs are used for routing and Google Maps links', async () => {
  const { Response } = require('node-fetch');
  const maps = compile('../lib/maps', {
    'node-fetch': async (_, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.origin, { placeId: 'ChIJ_origin' });
      assert.deepEqual(body.destination, { placeId: 'ChIJ_destination' });
      return new Response(JSON.stringify({ routes: [{ duration: '90s', distanceMeters: 1000 }] }));
    }
  }).exports;
  const input = maps.parseRoute('place_id:ChIJ_origin', 'place_id:ChIJ_destination', 'DRIVE');
  const { tokens } = await maps.computeRoute('fake-key', input);
  const link = new URL(tokens.link);
  assert.equal(link.searchParams.get('origin_place_id'), 'ChIJ_origin');
  assert.equal(link.searchParams.get('destination_place_id'), 'ChIJ_destination');
  assert.throws(() => maps.parseRoute('place_id:', 'Utrecht', 'DRIVE'), /valid Google Maps location/);
});

test('Maps only reads its own key, and a one-off calculation returns tags without touching the device', async () => {
  const { exports: Driver } = compile('../drivers/maps/driver', {
    homey: { Driver: class {} },
    '../../lib/maps': {
      parseRoute: require('../lib/maps').parseRoute,
      computeRoute: async (key, input, includeMap) => {
        assert.equal(key, 'fake-maps-key');
        assert.deepEqual(input, {
          origin: { text: 'A', waypoint: { address: 'A' } },
          destination: { text: 'B', waypoint: { address: 'B' } }, mode: 'WALK'
        });
        assert.equal(includeMap, undefined);
        return { tokens: { minutes: 5 } };
      }
    }
  });
  const listeners = {};
  const autocomplete = {};
  const driver = new Driver();
  driver.homey = {
    settings: { get: name => { assert.equal(name, 'MapsApiKey'); return ' fake-maps-key '; } },
    flow: {
      getActionCard: id => ({
        registerRunListener: run => { listeners[id] = run; },
        getArgument: name => ({ registerAutocompleteListener: run => { autocomplete[name] = run; } })
      }),
      getConditionCard: () => ({ registerRunListener() {} })
    }
  };
  driver.onInit();
  const device = { refreshRoute: async () => assert.fail('One-off Flow refreshed the device') };
  assert.deepEqual(await listeners.maps_calculate_route({ device, from: 'A', to: 'B', mode: 'WALK' }), { minutes: 5 });
  assert.deepEqual(await listeners.maps_calculate_route({
    device, from: { id: 'A', name: 'Ignored origin label' }, to: { id: 'B', name: 'Ignored destination label' }, mode: 'WALK'
  }), { minutes: 5 });
  await assert.rejects(() => listeners.maps_calculate_route({
    device, from: { name: 'No selected value' }, to: 'B', mode: 'WALK'
  }), /origin and destination/);
  driver.searchAddresses = async query => [{ id: query, name: query }];
  assert.deepEqual(await autocomplete.from('Typed origin'), [{ id: 'Typed origin', name: 'Typed origin' }]);
  assert.deepEqual(await autocomplete.to('Typed destination'), [{ id: 'Typed destination', name: 'Typed destination' }]);
  let refreshed = false;
  await listeners.maps_refresh_route({ device: { refreshRoute: async () => { refreshed = true; } } });
  assert.ok(refreshed);
});

test('Maps conditions check saved results without requests and handle missing readings and threshold equality', async () => {
  const Driver = compile('../drivers/maps/driver', { homey: { Driver: class {} } }).exports;
  const driver = new Driver();
  const conditions = {};
  driver.homey = {
    __: key => key,
    flow: {
      getActionCard: () => ({
        registerRunListener() {}, getArgument: () => ({ registerAutocompleteListener() {} })
      }),
      getConditionCard: id => ({ registerRunListener: run => { conditions[id] = run; } })
    }
  };
  driver.onInit();
  let current = null;
  const device = { getCapabilityValue: () => current };
  assert.equal(await conditions.maps_route_available({ device }), false);
  await assert.rejects(() => conditions.maps_travel_time_above({ device, minutes: 10 }), /route_unavailable/);
  current = 25;
  assert.equal(await conditions.maps_route_available({ device }), true);
  assert.equal(await conditions.maps_travel_time_above({ device, minutes: 24.9 }), true);
  assert.equal(await conditions.maps_travel_time_above({ device, minutes: 25 }), false);
  assert.equal(await conditions.maps_travel_time_above({ device, minutes: 30 }), false);
  for (const minutes of [-1, NaN, '10']) {
    await assert.rejects(() => conditions.maps_travel_time_above({ device, minutes }), /invalid_minutes/);
  }
  current = 0;
  assert.equal(await conditions.maps_route_available({ device }), true);
});

test('Maps device button refreshes the saved route and streams its camera image on demand', async t => {
  const now = Date.UTC(2026, 10, 18, 12, 0, 0);
  t.mock.timers.enable({ apis: ['Date'], now });
  const Device = compile('../drivers/maps/device', { homey: { Device: class {} } }).exports;
  const device = new Device();
  const values = { maps_refresh: true };
  let source;
  let refresh;
  let imageFetches = 0;
  let failImage = false;
  let routeError;
  const events = [];
  let imagesEnabled = false;
  const settings = { origin: 'Utrecht', destination: 'Amsterdam', travel_mode: 'TRANSIT', route_image: true };
  const tokens = { minutes: 25, kilometers: 40, eta: '2026-11-18T12:00:00Z', link: 'https://www.google.com/maps/dir/?api=1' };
  const image = { setStream: fn => { source = fn; }, update: async () => {}, unregister: async () => {} };
  Object.assign(device, {
    homey: {
      images: { createImage: async () => image },
      flow: { getDeviceTriggerCard: id => ({ trigger: async (target, values) => {
        assert.equal(target, device);
        events.push({ id, tokens: { ...values } });
      } }) },
      __: key => key, clock: { getTimezone: () => 'Europe/Amsterdam' }, i18n: { getLanguage: () => 'nl' }
    },
    driver: {
      routeImagesEnabled: () => imagesEnabled,
      calculateRoute: async (input, includeMap) => {
        assert.equal(input.origin.text, 'Utrecht');
        assert.equal(input.destination.text, 'Amsterdam');
        assert.equal(input.mode, 'TRANSIT');
        assert.equal(includeMap, imagesEnabled && settings.route_image);
        if (routeError) throw routeError;
        return { tokens, map: includeMap ? { path: 'example' } : null };
      },
      fetchRouteImage: async map => {
        assert.deepEqual(map, { path: 'example' });
        imageFetches++;
        if (failImage) throw new Error('Google timed out');
        return Buffer.from('image bytes');
      }
    },
    getSettings: () => settings,
    getSetting: key => settings[key],
    getCapabilityValue: key => values[key],
    hasCapability: () => true,
    setCapabilityValue: async (id, value) => { values[id] = value; },
    registerCapabilityListener: (id, fn) => { assert.equal(id, 'maps_refresh'); refresh = fn; },
    setWarning: async () => {},
    setCameraImage: async (id, title, value) => { assert.equal(id, 'route'); assert.equal(value, image); }
  });
  await device.onInit();
  assert.equal(values.maps_refresh, false);
  assert.equal(values.maps_last_refreshed, null);
  values.maps_refresh = true;
  await refresh();
  assert.equal(values.maps_refresh, false);
  assert.equal(values.maps_last_refreshed, '18 nov 2026, 13:00:00');
  assert.deepEqual(events, [{ id: 'maps_route_updated', tokens }]);
  await assert.rejects(() => source(new Writable()), /image_unavailable/);
  assert.equal(imageFetches, 0);
  imagesEnabled = true;
  await refresh();
  assert.equal(values.maps_minutes, 25);
  assert.equal(values.maps_distance, 40);
  assert.match(values.maps_eta, /13:00/);
  assert.equal(imageFetches, 0);
  const chunks = [];
  await source(new Writable({ write(chunk, _, done) { chunks.push(chunk); done(); } }));
  assert.equal(Buffer.concat(chunks).toString(), 'image bytes');
  assert.equal(imageFetches, 1);
  await Promise.all([source(new Writable({ write(_, __, done) { done(); } })),
    source(new Writable({ write(_, __, done) { done(); } }))]);
  assert.equal(imageFetches, 1);
  imagesEnabled = false;
  await assert.rejects(() => source(new Writable()), /image_unavailable/);
  imagesEnabled = true;
  await refresh();
  await Promise.all([source(new Writable({ write(_, __, done) { done(); } })),
    source(new Writable({ write(_, __, done) { done(); } }))]);
  assert.equal(imageFetches, 2);
  failImage = true;
  device.error = () => {};
  await refresh();
  await assert.rejects(() => source(new Writable()), /timed out/);
  await assert.rejects(() => source(new Writable()), /timed out/);
  assert.equal(imageFetches, 3);
  assert.equal(events.some(event => event.id === 'maps_refresh_failed'), false);
  failImage = false;
  await refresh();
  await source(new Writable({ write(_, __, done) { done(); } }));
  assert.equal(imageFetches, 4);
  assert.equal(events.filter(event => event.id === 'maps_travel_time_changed').length, 0);
  tokens.minutes = 24.7;
  t.mock.timers.tick(60 * 1000);
  await refresh();
  assert.equal(values.maps_last_refreshed, '18 nov 2026, 13:01:00');
  assert.deepEqual(events.at(-1), {
    id: 'maps_travel_time_changed',
    tokens: { minutes: 24.7, previous_minutes: 25, change_minutes: -0.3 }
  });
  routeError = new Error('Routes API quota exceeded.');
  values.maps_refresh = true;
  t.mock.timers.tick(60 * 1000);
  await assert.rejects(() => refresh(), /quota exceeded/);
  assert.equal(values.maps_last_refreshed, '18 nov 2026, 13:01:00');
  assert.equal(values.maps_refresh, false);
  assert.deepEqual(events.at(-1), { id: 'maps_refresh_failed', tokens: { error: 'Routes API quota exceeded.' } });
  assert.equal(values.maps_minutes, 24.7);
  routeError = null;
  settings.route_image = false;
  await device.onSettings({ newSettings: settings, changedKeys: ['route_image'] });
  assert.equal(values.maps_minutes, null);
  assert.equal(values.maps_last_refreshed, null);
  await refresh();
  assert.equal(events.at(-1).id, 'maps_route_updated');
  await assert.rejects(() => source(new Writable()), /image_unavailable/);
  await device.onUninit();
});

test('Maps image settings default to enabled and save an explicit opt-out', async () => {
  const vm = require('node:vm');
  for (const value of [undefined, null, true, false]) {
    const fields = Object.fromEntries([
      'cloudJSON', 'cloudProject', 'cloudApiKey', 'mapsApiKey', 'mapsRouteImages',
      'defaultCloudVoice', 'save', 'settingsStatus'
    ].map(id => [id, { value: '', add() {}, addEventListener(_, listener) { this.click = listener; } }]));
    const writes = [];
    const context = vm.createContext({
      document: { getElementById: id => fields[id] },
      Option: class {}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../settings/settings.js'), 'utf8'), context);
    await context.onHomeyReady({
      ready() {},
      get(key, callback) { callback(null, key === 'MapsRouteImagesEnabled' ? value : null); },
      set(key, next, callback) { writes.push([key, next]); callback(null); }
    });
    assert.equal(fields.mapsRouteImages.checked, value !== false);
    await fields.save.click();
    assert.deepEqual(writes, []);
    fields.mapsRouteImages.checked = !fields.mapsRouteImages.checked;
    await fields.save.click();
    assert.deepEqual(writes, [['MapsRouteImagesEnabled', value === false]]);
  }
});

test('Maps images default to enabled, respect opt-outs and have no refresh quota', async () => {
  let requests = 0;
  const { exports: Driver } = compile('../drivers/maps/driver', {
    homey: { Driver: class {} },
    '../../lib/maps': { fetchMap: async () => {
      requests++;
      if (requests === 1) throw Error('Google timed out');
    } }
  });
  const values = new Map([['MapsApiKey', 'fake-key']]);
  function newDriver() {
    const driver = new Driver();
    driver.homey = { settings: { get: key => values.get(key), set: (key, value) => values.set(key, value) } };
    return driver;
  }
  const first = newDriver();
  assert.equal(first.routeImagesEnabled(), true);
  values.set('MapsRouteImagesEnabled', null);
  assert.equal(first.routeImagesEnabled(), true);
  values.set('MapsRouteImagesEnabled', false);
  await assert.rejects(() => first.fetchRouteImage({ path: 'a' }), /disabled/);
  assert.equal(requests, 0);
  values.delete('MapsRouteImagesEnabled');
  await assert.rejects(() => first.fetchRouteImage({ path: 'a' }), /timed out/);
  values.set('MapsRouteImagesEnabled', true);
  const restarted = newDriver();
  for (let i = 0; i < 30; i++) {
    await restarted.fetchRouteImage({ path: 'b' });
  }
  assert.equal(requests, 31);
});

test('Maps Static keeps the Google image intact and redacts transport errors containing the API key', async () => {
  const { Response } = require('node-fetch');
  let fail = false;
  const maps = compile('../lib/maps', {
    'node-fetch': async url => {
      if (fail) throw new Error(`Could not fetch ${url}`);
      const { searchParams } = new URL(url);
      assert.equal(searchParams.get('path').split('enc:')[1], 'a?b');
      assert.equal(searchParams.get('maptype'), 'roadmap');
      assert.deepEqual(searchParams.getAll('markers'), [
        'color:0x155BE9|label:A|52,4', 'color:0x155BE9|label:B|53,5'
      ]);
      return new Response(Buffer.from('original png bytes'), { headers: { 'content-type': 'image/png' } });
    }
  }).exports;
  const map = { path: 'a?b', start: { latitude: 52, longitude: 4 }, end: { latitude: 53, longitude: 5 } };
  assert.equal((await maps.fetchMap('example-secret', map)).toString(), 'original png bytes');
  fail = true;
  await assert.rejects(() => maps.fetchMap('example-secret', map), error => {
    assert.match(error.message, /Maps Static API could not be reached/);
    assert.ok(!error.message.includes('example-secret'));
    return true;
  });
});

test('heavy libraries are not loaded at startup', () => {
  const cases = [
    ['../drivers/maps/driver', '@googlemaps/google-maps-services-js'],
    ['../drivers/translate/driver', '@google-cloud/translate'],
    ['../app', '@google-cloud/text-to-speech'],
    ['../app', 'lodash'],
    ['../lib/tts-server', 'music-metadata'],
    ['../lib/tts-server', 'lodash']
  ];
  for (const [file, heavy] of cases) {
    const { exports, loaded } = compile(file, { homey: { App: class {}, Driver: class {} }, './lib/tts-server': {} });
    assert.ok(exports, file);
    assert.ok(!loaded.some(id => id === heavy || id.startsWith(heavy + '/')), `${file} loads ${heavy}`);
  }
});

test('Cloud clients are loaded from their version folder instead of the whole package', async () => {
  const homey = {
    settings: { get: async () => '{"client_email":"a@example.com","private_key":"key"}' },
    notifications: { createNotification: async () => {} }
  };
  const app = compile('../app', { homey: { App: class {} }, 'google-tts-api': {}, betterlogiclibrary: { BL: {} }, './lib/tts-server': { setClient() {} } });
  const appInstance = new app.exports();
  appInstance.homey = homey;
  assert.equal(await appInstance.setCloudJSON(), true);

  const driver = compile('../drivers/translate/driver', { homey: { Driver: class {} }, betterlogiclibrary: { BL: {} } });
  const driverInstance = new driver.exports();
  driverInstance.homey = homey;
  driverInstance.setLanguages = async () => {};
  await driverInstance.setCloudJSON();

  try {
    assert.ok(appInstance.client instanceof require('@google-cloud/text-to-speech').TextToSpeechClient);
    assert.ok(driverInstance.translateClient instanceof require('@google-cloud/translate').v3.TranslationServiceClient);
    assert.ok(!app.loaded.includes('@google-cloud/text-to-speech'), 'app loads the text-to-speech package index');
    assert.ok(!driver.loaded.includes('@google-cloud/translate'), 'driver loads the translate package index');
  } finally {
    await Promise.all([appInstance.client && appInstance.client.close(), driverInstance.translateClient && driverInstance.translateClient.close()]);
  }
});
test('Cloud TTS client is replaced only when the saved credentials actually change', async () => {
  const created = [];
  const assigned = [];
  class TextToSpeechClient { constructor(options) { created.push(options.credentials); } }
  const App = loadApp({ textToSpeech: { TextToSpeechClient }, ttsServer: { setClient: client => assigned.push(client) } });
  const app = new App();
  let json = '{"client_email":"a@example.com","private_key":"one"}';
  app.homey = { settings: { get: async () => json }, notifications: { createNotification: async () => {} } };

  assert.equal(await app.setCloudJSON(), true);
  const first = app.client;
  json = '{ "private_key": "one", "client_email": "a@example.com" }';
  assert.equal(await app.setCloudJSON(), false, 'formatting or key order alone is not a change');
  assert.equal(app.client, first);

  json = '{"client_email":"a@example.com","private_key":"two"}';
  assert.equal(await app.setCloudJSON(), true);
  assert.notEqual(app.client, first);

  json = '';
  assert.equal(await app.setCloudJSON(), true);
  assert.equal(app.client, null);
  assert.equal(await app.setCloudJSON(), false);
  assert.equal(created.length, 2);
  assert.deepEqual(assigned.map(client => client && client.constructor.name), ['TextToSpeechClient', 'TextToSpeechClient', null]);
});

test('Translation client is replaced only on a credentials change and closes after its running requests', async () => {
  const created = [];
  const closed = [];
  const running = [];
  class TranslationServiceClient {
    constructor(options) { this.key = options.credentials.private_key; created.push(this.key); }
    getSupportedLanguages() { return new Promise(resolve => running.push(() => resolve([{ languages: [] }]))); }
    async close() { closed.push(this.key); }
  }
  const { exports: Driver } = compile('../drivers/translate/driver', {
    homey: { Driver: class {} },
    betterlogiclibrary: { BL: {} },
    '@google-cloud/translate/build/src/v3': { TranslationServiceClient }
  });
  const driver = new Driver();
  driver.projectLocation = 'projects/test-project/locations/global';
  let json = '{"client_email":"a@example.com","private_key":"one"}';
  driver.homey = { settings: { get: async () => json }, notifications: { createNotification: async () => {} }, i18n: { getLanguage: () => 'en' } };
  const tick = () => new Promise(resolve => setImmediate(resolve));

  const first = driver.setCloudJSON();
  await tick();
  json = '{ "private_key": "one", "client_email": "a@example.com" }';
  await driver.setCloudJSON();
  assert.deepEqual(created, ['one'], 'formatting or key order alone is not a change');

  json = '{"client_email":"a@example.com","private_key":"two"}';
  const second = driver.setCloudJSON();
  await tick();
  assert.deepEqual(closed, [], 'a running request must not lose its client');
  running[0]();
  await first;
  await tick();
  assert.deepEqual(closed, ['one']);

  running[1]();
  await second;
  json = '';
  await driver.setCloudJSON();
  await tick();
  assert.equal(driver.translateClient, null);
  assert.deepEqual(created, ['one', 'two']);
  assert.deepEqual(closed, ['one', 'two']);
});

test('Translation requests use the configured project in the global API location', async () => {
  const requests = [];
  class TranslationServiceClient {
    async getSupportedLanguages(request) {
      requests.push(['languages', request]);
      return [{ languages: [{ displayName: 'English', languageCode: 'en' }] }];
    }
    async translateText(request) {
      requests.push(['translate', request]);
      return [{ translations: [{ translatedText: 'bonjour' }] }];
    }
    async close() {}
  }
  const { exports: Driver } = compile('../drivers/translate/driver', {
    homey: { Driver: class {} },
    betterlogiclibrary: { BL: {} },
    '@google-cloud/translate/build/src/v3': { TranslationServiceClient }
  });
  const driver = new Driver();
  const settings = {
    CloudJSON: '{"client_email":"a@example.com","private_key":"key"}',
    CloudProject: 'test-project'
  };
  driver.homey = {
    settings: { get: async name => settings[name] },
    i18n: { getLanguage: () => 'en' }
  };

  await driver.setCloudJSON();
  assert.deepEqual(requests, [], 'language lookup waits until the project setting is loaded');
  await driver.setCloudProject();
  assert.equal(await driver.translate('hello', 'en', 'fr'), 'bonjour');
  assert.deepEqual(requests.map(([method, request]) => [method, request.parent]), [
    ['languages', 'projects/test-project/locations/global'],
    ['translate', 'projects/test-project/locations/global']
  ]);
  assert.deepEqual(driver.languages.map(language => language.id), ['en']);
  await driver.translateClient.close();
});

test('pairing another YouTube or Maps device gets a new id instead of failing', async () => {
  for (const [file, firstId] of [['../drivers/youtube/driver', 'youtubedevice'], ['../drivers/maps/driver', 'mapsdevice']]) {
    const { exports: Driver } = compile(file, { homey: { Driver: class {} }, betterlogiclibrary: { BL: {} }, 'youtube-search': () => {} });
    const driver = new Driver();
    driver.getDevices = () => [];
    assert.equal((await driver.onPairListDevices())[0].data.id, firstId, file);
    driver.getDevices = () => [{ getData: () => ({ id: firstId }) }];
    const [device] = await driver.onPairListDevices();
    assert.notEqual(device.data.id, firstId, file);
    assert.match(device.data.id, /^[0-9a-f-]{36}$/, file);
  }
});

test('repairing a Cloud TTS device lists it and adds only its missing capabilities', async () => {
  const { exports: Driver } = compile('../drivers/googlecloudtts/driver', { homey: { Driver: class {} } });
  const handlers = {};
  // The SDK 3 pair session only offers setHandler and emit.
  const session = { setHandler(event, handler) { handlers[event] = handler; return this; }, emit: async () => {} };
  const added = [];
  const device = { getName: () => 'Kitchen', hasCapability: id => id === 'device_url', addCapability: async id => { added.push(id); } };
  await new Driver().onRepair(session, device);
  const devices = await handlers.list_devices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'Kitchen');
  assert.ok(devices[0].data.id);
  assert.deepEqual(added, ['device_duration']);
});