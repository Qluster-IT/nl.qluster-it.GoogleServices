'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
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