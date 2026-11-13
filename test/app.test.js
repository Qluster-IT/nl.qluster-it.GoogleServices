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
    if (id === '@google-cloud/text-to-speech') return textToSpeech;
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

test('heavy Google client libraries are not loaded at startup', () => {
  const cases = [
    ['../drivers/maps/driver', '@googlemaps/google-maps-services-js'],
    ['../drivers/translate/driver', '@google-cloud/translate'],
    ['../app', '@google-cloud/text-to-speech'],
    ['../lib/tts-server', 'music-metadata']
  ];
  for (const [file, heavy] of cases) {
    const filename = require.resolve(file);
    const m = new Module(filename, module);
    m.filename = filename;
    m.paths = module.paths;
    const loaded = [];
    m.require = id => {
      loaded.push(id);
      if (id === 'homey') return { App: class {}, Driver: class {} };
      if (id === './lib/tts-server') return {};
      return Module.prototype.require.call(m, id);
    };
    m._compile(fs.readFileSync(filename, 'utf8'), filename);
    assert.ok(m.exports, file);
    assert.ok(!loaded.includes(heavy), `${file} loads ${heavy}`);
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