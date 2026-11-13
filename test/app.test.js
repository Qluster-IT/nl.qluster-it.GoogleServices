'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const test = require('node:test');

function loadApp({ getVoices = async () => [] } = {}) {
  const filename = require.resolve('../app');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  m.require = id => {
    if (id === 'homey') return { App: class {} };
    if (id === 'google-tts-api' || id === '@google-cloud/text-to-speech') return {};
    if (id === 'betterlogiclibrary') return { BL: { init: async () => {}, decode: async text => text } };
    if (id === './lib/tts-server') return { init() {}, getVoices, getUrl: async () => ({}) };
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

test('the maps driver does not load the unused Google Maps client at startup', () => {
  const filename = require.resolve('../drivers/maps/driver');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  const loaded = [];
  m.require = id => {
    loaded.push(id);
    if (id === 'homey') return { Driver: class {} };
    return Module.prototype.require.call(m, id);
  };
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  assert.equal(typeof m.exports, 'function');
  assert.ok(!loaded.includes('@googlemaps/google-maps-services-js'));
});