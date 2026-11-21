'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');

function loadApp({ getVoices = async () => [], textToSpeech = {}, ttsServer, announcements } = {}) {
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
    if (id === './lib/speaker-announcements' && announcements) return announcements;
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

test('the release notification is attempted once across restarts and failures are logged without retry spam', async () => {
  const App = loadApp();
  for (const fail of [false, true]) {
    const settings = new Map(), excerpts = [], errors = [];
    const homey = {
      settings: { get: key => settings.get(key), set: (key, value) => settings.set(key, value) },
      __: key => `translated ${key}`,
      notifications: { createNotification: async ({ excerpt }) => {
        excerpts.push(excerpt);
        if (fail) throw new Error('offline');
      } }
    };
    for (let restart = 0; restart < 2; restart++) {
      const app = new App();
      app.homey = homey;
      app.error = (...args) => errors.push(args);
      await app._notifyReleaseFeatures();
    }
    assert.deepEqual(excerpts, ['translated speech.release_notice']);
    assert.equal(errors.length, fail ? 1 : 0);
  }
});

test('the release notification is localized and points to the wiki and forum', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'locales');
  for (const file of fs.readdirSync(dir)) {
    const notice = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).speech?.release_notice;
    assert.ok(notice, file);
    assert.match(notice, /Community Forum/, file);
    assert.match(notice, /wiki|ويكي|위키|вики/i, file);
    assert.doesNotMatch(notice, /[?\uFFFD]/, file);
  }
});

test('voice autocomplete resolves to an empty list when voices cannot be loaded', async () => {
  const App = loadApp({ getVoices: async () => { throw new Error('no credentials'); } });
  const app = new App();
  const autocompletes = [];
  const card = {
    registerRunListener() { return card; },
    getArgument: name => ({ registerAutocompleteListener: listener => {
      if (name === 'voice') autocompletes.push(listener);
    } })
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

test('Maps traffic settings, estimated delay, and colored route images', async t => {
  await t.test('requests traffic colors only for enabled driving images and reports delay without a second request', async () => {
    const { Response } = require('node-fetch');
    const requests = [];
    let fallbackInfo;
    const intervals = [{ endPolylinePointIndex: 1, speed: 'SLOW' }];
    const maps = compile('../lib/maps', {
      'node-fetch': async (_, options) => {
        requests.push(options);
        return new Response(JSON.stringify({ fallbackInfo, routes: [{
          duration: '180s', staticDuration: '90s', polyline: { encodedPolyline: '??AA' },
          travelAdvisory: { speedReadingIntervals: intervals }
        }] }));
      }
    }).exports;
    const Driver = compile('../drivers/maps/driver', { homey: { Driver: class {} }, '../../lib/maps': maps }).exports;
    const driver = new Driver();
    const settings = { MapsApiKey: 'fake-key' };
    driver.homey = { settings: { get: key => settings[key] } };
    for (const [mode, image, deviceTraffic, appTraffic, color, delay] of [
      ['DRIVE', true, true, undefined, true, 1.5],
      ['DRIVE', true, true, false, false, 1.5],
      ['DRIVE', true, false, true, false, 1.5],
      ['DRIVE', false, true, true, false, 1.5],
      ['WALK', true, true, true, false, null]
    ]) {
      settings.MapsRouteTrafficEnabled = appTraffic;
      const count = requests.length;
      const result = await driver.calculateRoute(maps.parseRoute('Utrecht', 'Amsterdam', mode), image, deviceTraffic);
      assert.equal(requests.length, count + 1);
      assert.deepEqual(JSON.parse(requests.at(-1).body).extraComputations, color ? ['TRAFFIC_ON_POLYLINE'] : undefined);
      assert.equal(requests.at(-1).headers['X-Goog-FieldMask'].includes('speedReadingIntervals'), color);
      assert.equal(result.delayMinutes, delay);
      assert.deepEqual(result.map?.intervals, color ? intervals : undefined);
    }
    fallbackInfo = { routingMode: 'FALLBACK_TRAFFIC_UNAWARE' };
    const result = await driver.calculateRoute(maps.parseRoute('Utrecht', 'Amsterdam', 'DRIVE'), false);
    assert.equal(result.delayMinutes, null);
  });

  await t.test('paints adjacent traffic segments with independent encoded paths', async () => {
    const { Response } = require('node-fetch');
    const urls = [];
    const maps = compile('../lib/maps', {
      'node-fetch': async url => {
        urls.push(new URL(url));
        return new Response('png', { headers: { 'content-type': 'image/png' } });
      }
    }).exports;
    const path = '??AA??AC'; // (0,0), (1,1), (1,1), (2,3) in polyline units.
    await maps.fetchMap('fake-key', { path, intervals: [
      { endPolylinePointIndex: 1, speed: 'NORMAL' },
      { startPolylinePointIndex: 1, endPolylinePointIndex: 2, speed: 'SLOW' },
      { startPolylinePointIndex: 2, endPolylinePointIndex: 3, speed: 'TRAFFIC_JAM' }
    ] });
    assert.deepEqual(urls[0].searchParams.getAll('path'), [
      `color:0x155BE9FF|weight:5|enc:${path}`,
      'color:0x16864AFF|weight:5|enc:??AA',
      'color:0xDC7600FF|weight:5|enc:AA??',
      'color:0xC62828FF|weight:5|enc:AAAC'
    ]);
    let omitted = false;
    const long = 'AA'.repeat(5000);
    await maps.fetchMap('fake-key', { path: long, intervals: [
      { endPolylinePointIndex: 4999, speed: 'TRAFFIC_JAM' }
    ] }, () => { omitted = true; });
    assert.equal(omitted, true);
    assert.equal(urls[1].searchParams.getAll('path').length, 1);
    await assert.rejects(() => maps.fetchMap('fake-key', { path, intervals: [
      { endPolylinePointIndex: 4, speed: 'TRAFFIC_JAM' }
    ] }), /invalid traffic interval/);
    assert.equal(urls.length, 2);
  });
});

test('speaker announcements resolve the selected speaker before synthesizing', async () => {
  const calls = [];
  let run;
  let autocomplete;
  let playbackError;
  const { registerAnnouncement, basicSpeech } = compile('../lib/speaker-announcements', {
    './speaker-playback': class extends require('../lib/speaker-playback') {
      async select({ id }) {
        calls.push(id);
        if (id === 'missing') throw new Error('Speaker unavailable');
        return { id };
      }
      async play(speaker, media) {
        if (playbackError) throw playbackError;
        calls.push([speaker.id, media]);
      }
      async autocomplete(query, mode) {
        assert.equal(mode, 'live');
        return [{ id: 'cast:abc', name: query }];
      }
    },
    'google-tts-api': { getAudioUrl: (text, { lang }) => {
      assert.deepEqual([text, lang], ['Hallo', 'nl']);
      return 'https://example.com/audio';
    } },
    'node-fetch': async () => new (require('node-fetch').Response)(Buffer.from('test audio'), {
      headers: { 'content-type': 'audio/mpeg' }
    }),
    './tts-server': { hostedDuration: async () => 1500, hostMp3: async (_, audio) => {
      assert.equal(audio.toString(), 'test audio');
      return 'http://192.168.1.1:47333/tts/test.mp3';
    } }
  }).exports;
  const homey = { flow: { getActionCard: () => ({
    registerRunListener: listener => { run = listener; },
    getArgument: () => ({ registerAutocompleteListener: listener => { autocomplete = listener; } })
  }) } };
  registerAnnouncement(homey, 'example', ({ text }) => basicSpeech(homey, text, 'nl'),
    (device, media) => calls.push(['when', device, media]));
  assert.deepEqual(await autocomplete('Kitchen'), [{ id: 'cast:abc', name: 'Kitchen' }]);
  await assert.rejects(run({ text: 'Not synthesized', speaker: { id: 'missing' } }), /unavailable/);
  await assert.rejects(run({ text: 'x'.repeat(201), speaker: { id: 'cast:abc' } }), /200 characters/);
  const speaker = { id: 'cast:abc' };
  const args = { text: 'Hallo', speaker };
  const media = { url: 'http://192.168.1.1:47333/tts/test.mp3', type: 'audio/mpeg', duration: 1500 };
  assert.equal(await run({ ...args, device: { getSetting: key => key === 'announcement_sonos_mode' ? undefined : false } }), true);
  assert.deepEqual(calls, ['missing', 'cast:abc', 'cast:abc',
    ['cast:abc', media]]);
  calls.length = 0;
  const device = { getSetting: key => key === 'trigger_when_announcing' ? true : undefined };
  playbackError = new Error('Speaker unavailable');
  await assert.rejects(run({ ...args, device }), /unavailable/);
  assert.deepEqual(calls.splice(0), ['cast:abc']);
  playbackError = null;
  assert.equal(await run({ ...args, device }), true);
  assert.deepEqual(calls, ['cast:abc', ['cast:abc', media], ['when', device, media]]);
});

test('default speakers are used only when there is no explicit selection, and failures never trigger When cards', async () => {
  const played = [], triggered = [];
  let run, generated = 0, fail = false;
  const helpers = compile('../lib/speaker-announcements', {
    './speaker-playback': class extends require('../lib/speaker-playback') {
      async select(value) { return value; }
      async play(speaker, media) {
        played.push([speaker.id, media.url]);
        if (fail) throw new Error('one speaker unavailable');
      }
    },
    './tts-server': { hostedDuration: async () => 1500 }
  }).exports;
  const homey = { flow: { getActionCard: () => ({
    getArgument: () => ({ registerAutocompleteListener() {} }),
    registerRunListener: listener => { run = listener; }
  }) } };
  let trigger = false;
  const device = {
    getStoreValue: key => key === helpers.defaultSpeakerKey ? { id: 'all' } : undefined,
    getSetting: key => key === 'trigger_when_announcing' ? trigger : undefined
  };
  helpers.registerAnnouncement(homey, 'example', async () => {
    generated++;
    return { url: 'http://local/audio.mp3' };
  }, (_, media) => triggered.push(media));
  await run({ device, text: 'Default' });
  assert.deepEqual(played, [['all', 'http://local/audio.mp3']]);
  assert.equal(triggered.length, 0);
  trigger = true;
  await run({ device, text: 'Override', speaker: { id: 'cast:chosen' } });
  assert.equal(played[1][0], 'cast:chosen');
  assert.equal(triggered.length, 1);
  fail = true;
  await assert.rejects(run({ device, text: 'Failure' }), /unavailable/);
  assert.equal(triggered.length, 1);
  assert.equal(generated, 3);
  assert.equal(await helpers.selectSpeaker(homey, { getStoreValue: () => undefined }), null);
});

test('direct playback defaults grouping and resume on, preserves opt-outs and validates volume before synthesis', async () => {
  const played = [];
  let run, generated = 0;
  const helpers = compile('../lib/speaker-announcements', {
    './speaker-playback': class extends require('../lib/speaker-playback') {
      async select(value) { return value; }
      async play(speaker, media, options) { played.push({ speaker, media, options }); }
    },
    './tts-server': { hostedDuration: async () => 1500 }
  }).exports;
  const homey = { flow: { getActionCard: () => ({
    getArgument: () => ({ registerAutocompleteListener() {} }),
    registerRunListener: listener => { run = listener; }
  }) } };
  const settings = {};
  const device = { getSetting: key => settings[key], getStoreValue: () => ({ id: 'all' }) };
  helpers.registerAnnouncement(homey, 'example', async () => {
    generated++;
    return { url: 'http://homey.invalid/tts/example.mp3' };
  });
  await run({ device, text: 'Default settings' });
  assert.deepEqual(played[0].options, { group: true, resume: true, delay: 0, volume: undefined });
  assert.equal(played[0].media.duration, 1500);
  await run({ device, text: 'One speaker', speaker: { id: 'one' }, volume: 0 });
  assert.deepEqual(played[1].options, { group: false, resume: true, delay: 0, volume: 0 });
  settings.announcement_group_sonos = settings.announcement_resume = false;
  await run({ device, text: 'Explicit opt-outs' });
  assert.equal(played[2].options.group, false);
  assert.equal(played[2].options.resume, false);
  assert.equal(played[2].media.duration, 1500);
  settings.announcement_group_sonos = true;
  for (const id of ['all_no_tvs', 'all_no_tv_speakers']) {
    await run({ device: { ...device, getStoreValue: () => ({ id }) }, text: 'Filtered default' });
    assert.equal(played.at(-1).speaker.id, id);
    assert.equal(played.at(-1).options.group, true);
  }
  await assert.rejects(run({ device, text: 'Invalid', volume: 101 }), /volume/);
  await assert.rejects(run({ device, text: 'Invalid', volume: NaN }), /volume/);
  assert.equal(generated, 5);
});

test('All snapshots fresh discovery, attempts every target in bounded batches and reports failures after playback', async () => {
  const Playback = require('../lib/speaker-playback');
  const attempted = [], errors = [];
  let active = 0, peak = 0;
  const media = { url: 'http://local/audio.mp3' };
  class TestPlayback extends Playback {
    async refresh() { return this.speakers; }
    async playSingle(target, audio) {
      assert.equal(audio, media);
      attempted.push(target.id);
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      if (target.id === '2') throw new Error('unavailable');
    }
  }
  const playback = new TestPlayback((...args) => errors.push(args));
  playback.speakers = [];
  await assert.rejects(playback.select({ id: 'all' }), /No speakers/);
  playback.speakers = Array.from({ length: 7 }, (_, id) => ({ id: String(id), name: `Speaker ${id}` }));
  const selected = await playback.select({ id: 'all' });
  playback.speakers.push({ id: 'later', name: 'Discovered later' });
  await assert.rejects(playback.play(selected, media), /1 speaker\(s\): Speaker 2: unavailable/);
  assert.deepEqual(attempted, ['0', '1', '2', '3', '4', '5', '6']);
  assert.equal(peak, 4);
  assert.equal(errors.length, 0, 'start failures are returned to the caller, not reported twice');
});

test('saved speaker groups retain their picker ID after edits and resolve only available members', async () => {
  const { listGroups, writeGroup, deleteGroup } = require('../lib/speaker-groups');
  const Playback = require('../lib/speaker-playback');
  const values = new Map();
  const settings = { get: key => values.get(key), set: (key, value) => values.set(key, value) };
  const kitchen = { id: 'dlna:uuid:kitchen', name: 'Kitchen', protocol: 'dlna' };
  const bedroom = { id: 'cast:bedroom', name: 'Bedroom', protocol: 'cast' };
  const tv = { id: 'dlna:uuid:tv', name: 'TV', protocol: 'dlna' };
  const group = await writeGroup(settings, { name: ' Downstairs ', members: [kitchen.id, bedroom.id, kitchen.id] }, [kitchen, bedroom]);
  assert.equal(group.name, 'Downstairs');
  assert.deepEqual(group.members.map(item => item.id), [kitchen.id, bedroom.id]);
  await assert.rejects(writeGroup(settings, { name: 'Nested', members: [group.id] }, []), /individual speakers/);
  await assert.rejects(writeGroup(settings, { name: 'DOWNSTAIRS', members: [tv.id] }, [tv]), /already uses/);

  const playback = new Playback(() => {}, undefined, undefined, () => listGroups(settings));
  playback.refresh = async () => [kitchen, tv];
  const [picked] = await playback.autocomplete('downstairs');
  assert.deepEqual(picked, { id: group.id, name: group.name, description: 'Saved speaker group' });
  assert.equal(Playback.isSpeakerGroup(picked.id), true);
  assert.deepEqual((await playback.select(picked)).targets, [kitchen]);

  await assert.rejects(writeGroup(settings, { id: group.id, name: 'Bedrooms',
    members: [{ id: bedroom.id, maxVolume: 101 }] }, []), /maximum volume/);
  const latest = await writeGroup(settings, { id: group.id, name: 'Bedrooms',
    members: [{ id: bedroom.id, volumeOffset: 15, maxVolume: 0 }] }, []);
  assert.equal(latest.id, group.id);
  assert.deepEqual(latest.members, [{ id: bedroom.id, name: bedroom.name, volumeOffset: 15, maxVolume: 0 }]);
  await assert.rejects(playback.select(picked), /No speakers in "Bedrooms"/);
  const renamedBedroom = { ...bedroom, id: 'cast:new-bedroom', aliases: [bedroom.id] };
  playback.refresh = async () => [renamedBedroom, tv];
  assert.deepEqual((await playback.select(picked)).targets, [{ ...renamedBedroom, volumeOffset: 15, maxVolume: 0 }]);
  const attempted = [];
  playback.playSingle = async target => attempted.push(target.id);
  await playback.play(await playback.select(picked), { url: 'http://homey.invalid/tts/example.mp3' });
  assert.deepEqual(attempted, [renamedBedroom.id]);
  await deleteGroup(settings, group.id);
  await assert.rejects(playback.select(picked), /no longer exists/);
});

test('Play Separately resolves a saved Sonos group by verified addresses and rediscovers changed addresses', async () => {
  const primary = 'RINCON_00112233445501400';
  const satellite = 'RINCON_00112233446601400';
  const id = uuid => `dlna:uuid:${uuid.toLowerCase()}`;
  const host = '192.168.1.10';
  const group = {
    id: 'group:00000000-0000-0000-0000-000000000001', name: 'Downstairs',
    members: [{ id: id(satellite), maxVolume: 25 }, { id: id(primary) }]
  };
  const values = new Map();
  const settings = { get: key => values.get(key), set: (key, value) => values.set(key, value) };
  const requests = [];
  let actual = primary;
  const zone = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1';
  const Playback = compile('../lib/speaker-playback', {
    'node-fetch': async url => {
      requests.push(url);
      if (url.endsWith('/topology')) {
        return { ok: true, text: async () => `<Envelope><Body><GetZoneGroupStateResponse><ZoneGroupState>
          &lt;ZoneGroupState&gt;&lt;ZoneGroups&gt;&lt;ZoneGroup&gt;
          &lt;ZoneGroupMember UUID="${primary}" ChannelMapSet="${primary}:LF;${satellite}:RF"&gt;
          &lt;Satellite UUID="${satellite}"/&gt;&lt;/ZoneGroupMember&gt;
          &lt;/ZoneGroup&gt;&lt;/ZoneGroups&gt;&lt;/ZoneGroupState&gt;
          </ZoneGroupState></GetZoneGroupStateResponse></Body></Envelope>` };
      }
      return { ok: true, text: async () => `<root><device>
        <deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType>
        <manufacturer>Sonos</manufacturer><roomName>Kitchen</roomName><UDN>uuid:${actual}</UDN>
        <serviceList><service><serviceType>${zone}</serviceType><controlURL>/topology</controlURL></service>
        <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/av</controlURL></service></serviceList></device></root>` };
    }
  }).exports;
  const makePlayback = () => new Playback(() => {}, undefined, undefined, () => [group], settings);
  await makePlayback().rememberSonosAddresses([{ id: id(primary), protocol: 'sonos', host, aliases: [id(satellite)] }]);
  // A new playback instance has no in-memory discovery results.
  const playback = makePlayback();
  let scans = 0;
  playback.refreshInBackground = () => {};
  playback.refresh = async () => {
    scans++;
    return [{ id: id(primary), protocol: 'sonos', host: '192.168.1.11', aliases: [id(satellite)] }];
  };
  assert.deepEqual((await playback.select(group, true)).targets.map(target => target.host), [host]);
  assert.equal((await playback.select({ id: id(satellite) }, true)).id, id(primary));
  assert.equal(scans, 0);
  assert.deepEqual(requests.splice(0), [1, 2].flatMap(() => [
    `http://${host}:1400/xml/device_description.xml`, `http://${host}:1400/topology`
  ]));
  actual = 'RINCON_00112233447701400'; // DHCP gave the saved address to a different Sonos room.
  assert.equal((await playback.select(group, true)).targets[0].host, '192.168.1.11');
  assert.equal(scans, 1);
  assert.deepEqual(requests, [`http://${host}:1400/xml/device_description.xml`]);
  await playback.select({ id: 'all' }, true);
  assert.equal(scans, 2);
  requests.length = 0;

  const restarted = makePlayback();
  actual = primary;
  let endScan;
  restarted.pending = new Promise(resolve => { endScan = resolve; });
  const selected = { id: id(primary) };
  const [first, concurrent] = await Promise.all([restarted.select(selected), restarted.select(selected, true)]);
  assert.equal(first.host, host);
  assert.equal(concurrent, first);
  assert.equal(await restarted.select(selected), first, 'warm lookup does not wait for the pending scan');
  assert.deepEqual(requests.splice(0), [
    `http://${host}:1400/xml/device_description.xml`, `http://${host}:1400/topology`
  ]);
  const moved = { ...first, host: '192.168.1.11' };
  restarted.updateSonosEndpoint(moved.id, moved, ++restarted.sonosRevision);
  const error = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
  restarted.invalidateSonosEndpoint(first, error);
  assert.equal(await restarted.select(selected), moved, 'failure on the old room object cannot invalidate the new one');
  restarted.invalidateSonosEndpoint(moved, error);
  const afterFailure = restarted.select(selected);
  endScan([]);
  await assert.rejects(afterFailure, /not available/);
  assert.equal(requests.length, 0, 'does not try the invalidated address while discovery is pending');
  assert.equal(restarted.knownSonosAddresses()[0].host, host, 'a scan miss does not erase the persisted address hint');
});

test('speech setup saves complete settings per session and preserves an offline default during repair', async () => {
  const register = compile('../lib/speech-setup', {
    './speaker-announcements': {
      defaultSpeakerKey: 'announcement_speaker',
      getPlayback: () => ({ autocomplete: async () => [{ id: 'all', name: 'All speakers' }] })
    }
  }).exports;
  const driver = { homey: { i18n: { getLanguage: () => 'nl' }, __: () => 'nl-NL' }, error() {} };
  const session = () => { const handlers = {}; return { handlers, setHandler: (id, fn) => { handlers[id] = fn; } }; };
  const first = session(), second = session();
  const decorate = register(driver, first, 'googletts');
  register(driver, second, 'googletts');
  const initial = first.handlers.get_speech_settings().settings;
  assert.equal(initial.languagecode, 'nl-NL');
  await assert.rejects(first.handlers.save_speech_settings({ settings: { ...initial, typo: true }, speaker: null }), /Unknown/);
  await assert.rejects(first.handlers.save_speech_settings({ settings: { ...initial, trigger_when_announcing: 'false' }, speaker: null }), /Invalid/);
  await assert.rejects(first.handlers.save_speech_settings({ settings: initial, speaker: { id: 'bogus' } }), /available speaker/);
  await first.handlers.save_speech_settings({ settings: initial, speaker: { id: 'all' } });
  assert.equal(decorate([{}])[0].store.announcement_speaker.id, 'all');
  assert.equal(second.handlers.get_speech_settings().speaker, null);
  let stored = { id: 'offline', name: 'Offline speaker' }, saved;
  const repair = session();
  const device = {
    getSetting: key => initial[key], getStoreValue: () => stored,
    setStoreValue: async (_, value) => { stored = value; }, unsetStoreValue: async () => { stored = null; },
    setSettings: async value => { saved = value; }
  };
  register(driver, repair, 'googletts', device);
  await repair.handlers.save_speech_settings({ settings: initial, speaker: { id: 'offline' } });
  assert.deepEqual(saved, initial);
  assert.equal(stored.id, 'offline');
  device.setSettings = async () => { throw new Error('write failed'); };
  await assert.rejects(repair.handlers.save_speech_settings({ settings: initial, speaker: null }), /write failed/);
  assert.equal(stored.id, 'offline', 'failed settings writes restore the original output selection');
});

test('Maps decodes manual BLL addresses once but leaves selected Google Place IDs untouched', async () => {
  const decoded = [];
  const Driver = compile('../drivers/maps/driver', {
    homey: { Driver: class {} },
    betterlogiclibrary: { BL: { decode: async text => { decoded.push(text); return 'Decoded address'; } } }
  }).exports;
  const driver = new Driver();
  driver.homey = { i18n: { getLanguage: () => 'en' } };
  const route = await driver.parseFlowRoute({ id: 'place_id:ChIJ_test' }, { id: '{[ address ]}' }, 'WALK');
  assert.deepEqual(decoded, ['{[ address ]}']);
  assert.equal(route.origin.waypoint.placeId, 'ChIJ_test');
  assert.equal(route.destination.waypoint.address, 'Decoded address');
});

test('Cloud default output waits without emitting URL or Finished when the checkbox is off', async () => {
  const events = [];
  const App = loadApp({
    ttsServer: { getUrl: async () => ({ url: 'http://local/speech.mp3', duration: 1, audioConfig: { audioEncoding: 'MP3' } }) },
    announcements: {
      selectSpeaker: async () => ({ id: 'all' }),
      playAnnouncement: async (_, device, speaker, media, trigger) => {
        events.push('play');
        if (device.getSetting('trigger_when_announcing')) await trigger(device, media);
      }
    }
  });
  const app = new App();
  app.homey = {};
  app.error = () => assert.fail('Unexpected timer failure');
  app.Triggers = {
    cloudurlTrigger: { Card: { trigger: async () => events.push('url') } },
    finished_trigger: { Card: { trigger: async () => events.push('finished') } }
  };
  let enabled = false;
  const device = {
    setCapabilityValue: async () => {},
    getSetting: key => key === 'delay' ? 0 : enabled
  };
  await app.sayCloudOnSpeaker({ device, text: 'Silent triggers' }, true);
  assert.deepEqual(events, ['play']);
  enabled = true;
  await app.sayCloudOnSpeaker({ device, text: 'Enabled triggers' }, true);
  assert.deepEqual(events, ['play', 'play', 'url', 'finished']);
});

test('Translate announcements use the default target, respect explicit overrides and emit translated tokens only when enabled', async () => {
  const events = [], requests = [], runs = {};
  const helpers = compile('../lib/speaker-announcements', {
    './speaker-playback': class extends require('../lib/speaker-playback') {
      async select(value) { return value; }
      async play(_, media) { events.push(['play', media.translation]); }
    },
    './tts-server': { hostedDuration: async () => 1500 }
  }).exports;
  const Driver = compile('../drivers/translate/driver', {
    homey: { Driver: class {} },
    betterlogiclibrary: { BL: { decode: async text => text.replace('{[ greeting ]}', 'Hello') } },
    '../../lib/speaker-announcements': helpers
  }).exports;
  const driver = new Driver();
  driver.log = () => {};
  driver.setCloudJSON = driver.setCloudProject = async () => {};
  const card = id => ({
    registerRunListener: run => { runs[id] = run; },
    registerArgumentAutocompleteListener() {},
    getArgument: () => ({ registerAutocompleteListener() {} }),
    trigger: async (_, tokens) => events.push(['trigger', tokens])
  });
  driver.homey = { settings: { on() {} }, flow: {
    getDeviceTriggerCard: card, getActionCard: card, getConditionCard: card
  } };
  driver.translate = async (text, source, target) => {
    requests.push([text, source, target]);
    return target === 'de' ? 'Hallo' : 'Bonjour';
  };
  driver.translationMedia = async () => ({ url: 'http://local/translation.mp3', type: 'audio/mpeg' });
  await driver.onInit();
  let enabled = false;
  const device = {
    getSetting: key => ({ languagecode: 'en', defaulttargetlanguagecode: 'fr', trigger_when_announcing: enabled,
      announcement_group_sonos: false, announcement_resume: false })[key],
    getStoreValue: key => key === helpers.defaultSpeakerKey ? { id: 'all' } : undefined,
    setCapabilityValue: async () => {}
  };
  await runs.announce_translation({ device, text: '{[ greeting ]}' });
  assert.deepEqual(events, [['play', 'Bonjour']]);
  enabled = true;
  await runs.announce_translation({ device, text: '{[ greeting ]}', targetlanguagecode: { id: 'de' } });
  assert.deepEqual(requests, [['Hello', 'en', 'fr'], ['Hello', 'en', 'de']]);
  assert.deepEqual(events[2], ['trigger', {
    url: 'http://local/translation.mp3', text: 'Hello', translation: 'Hallo',
    sourcelanguagecode: 'en', targetlanguagecode: 'de'
  }]);
  const tokens = await runs.action_translate_af_oc({ device, translate: '{[ greeting ]}' });
  assert.deepEqual(tokens, { text: 'Hello', translation: 'Bonjour', sourcelanguagecode: 'en', targetlanguagecode: 'fr' });
});

test('announcement cards continue by default, or wait until the speakers are finished and restored', async () => {
  let finished;
  const helpers = compile('../lib/speaker-announcements', {
    './speaker-playback': class extends require('../lib/speaker-playback') {
      async play(_, __, options) { finished = options.finished; }
    },
    './tts-server': { hostedDuration: async () => 1500 }
  }).exports;
  const homey = { app: { error() {} } };
  const device = { getSetting: () => undefined };
  const media = { url: 'http://local/speech.mp3', duration: 1500 };
  await helpers.playAnnouncement(homey, device, { id: 'speaker' }, media);
  assert.equal(finished, undefined);
  let done = false;
  const waiting = helpers.playAnnouncement(homey, device, { id: 'speaker' }, media, undefined, undefined, 'wait')
    .then(() => { done = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false);
  finished(null);
  await waiting;
  const failing = helpers.playAnnouncement(homey, device, { id: 'speaker' }, media, undefined, undefined, 'wait');
  await new Promise(resolve => setImmediate(resolve));
  finished(new Error('Restoring failed'));
  await assert.rejects(failing, /Restoring failed/);
});

test('speaker lists survive restart, refresh once in the background, and recover a moved Cast address before playing', async t => {
  const { EventEmitter } = require('node:events');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let host = '192.168.1.2';
  let name = 'Kitchen';
  let scans = 0;
  const Playback = compile('../lib/speaker-playback', {
    'bonjour-service': { Bonjour: class {
      find(_, callback) {
        scans++;
        callback({ addresses: [host], txt: { id: 'abc', fn: name }, port: 8009 });
        return { stop() {} };
      }
      destroy() {}
    } },
    dgram: { createSocket() {
      return Object.assign(new EventEmitter(), { send() {}, close() {} });
    } },
    net: { isIPv4: require('node:net').isIPv4, createConnection({ host: address }) {
      const socket = Object.assign(new EventEmitter(), { setTimeout() {}, destroy() {} });
      queueMicrotask(() => socket.emit(address === host ? 'connect' : 'error', new Error('address moved')));
      return socket;
    } }
  }).exports;
  const values = new Map();
  const settings = { get: key => values.get(key), set: (key, value) => values.set(key, value) };
  const makePlayback = () => new Playback(() => {}, undefined, undefined, undefined, settings);
  const first = makePlayback().listSpeakers();
  t.mock.timers.tick(2500);
  const [speaker] = await first;
  assert.deepEqual(speaker, { id: 'cast:abc', name: 'Kitchen', description: 'Google Cast' });
  assert.equal(JSON.stringify([...values.values()]).includes(host), false);
  const restarted = makePlayback();
  name = 'Dining room';
  assert.deepEqual(await restarted.listSpeakers(), [speaker], 'cached list resolves before the scan timer');
  assert.deepEqual(await restarted.autocomplete('Kitchen'), [speaker]);
  const fresh = restarted.listSpeakers('wait');
  const livePicker = restarted.autocomplete('Dining room', 'live');
  const selected = restarted.select(speaker);
  assert.equal(scans, 2, 'opening, filtering and selecting share one scan after restart');
  t.mock.timers.tick(2500);
  const updated = [{ ...speaker, name }];
  assert.deepEqual(await fresh, updated);
  assert.deepEqual(await livePicker, updated, 'the first Flow response uses the completed scan, not the persisted list');
  assert.deepEqual(await restarted.autocomplete('Dining room', 'live'), updated);
  assert.equal(scans, 2, 'another Flow lookup reuses the recent scan');
  assert.equal((await selected).host, host);
  host = '192.168.1.9';
  const moved = restarted.select(speaker);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scans, 3, 'an unreachable live address triggers one new scan');
  t.mock.timers.tick(2500);
  assert.equal((await moved).host, host);
});

test('the speaker picker discovers Cast, Sonos, DLNA and UPnP transport services', async t => {
  const { EventEmitter } = require('node:events');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0;
  const Playback = compile('../lib/speaker-playback', {
    'bonjour-service': { Bonjour: class {
      find({ type }, callback) {
        assert.equal(type, 'googlecast');
        callback({ addresses: ['192.168.1.2'], txt: { id: 'abc', fn: 'Kitchen' }, port: 8009 });
        callback({ addresses: ['192.168.1.6'], txt: { id: 'video', fn: 'Den Display', ca: '5' }, port: 8009 });
        return { stop() {} };
      }
      destroy() { closed++; }
    } },
    dgram: { createSocket() {
      const socket = new EventEmitter();
      socket.close = () => closed++;
      socket.send = query => {
        const responses = query.includes('ZonePlayer:1')
          ? [['rincon_test', '192.168.1.4', '192.168.1.4:1400']]
          : query.includes('AVTransport:1') ? [['receiver', '192.168.1.5', '192.168.1.5'], ['tv', '192.168.1.7', '192.168.1.7']]
          : [['external', '192.168.1.3', 'example.com'], ['def', '192.168.1.3', '192.168.1.3'],
            ['rincon_test_mr', '192.168.1.4', '192.168.1.4:1400']];
        for (const [id, address, host] of responses) {
          socket.emit('message', Buffer.from(`HTTP/1.1 200 OK\r\nUSN: uuid:${id}::renderer\r\nLOCATION: http://${host}/desc\r\n`),
            { address });
        }
      };
      return socket;
    } },
    'node-fetch': async (url, options) => {
      if (options.method === 'POST') {
        assert.equal(url, 'http://192.168.1.4:1400/MediaRenderer/AVTransport/Control');
        sonosActions.push(options.headers.SOAPAction);
        const action = /#([^"]+)/.exec(options.headers.SOAPAction)[1];
        return { ok: true, text: async () => `<Envelope><Body><${action}Response/></Body></Envelope>` };
      }
      if (url === 'http://192.168.1.4:1400/desc') {
        return { ok: true, text: async () => `<root><device>
          <deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType>
          <manufacturer>Sonos, Inc.</manufacturer><friendlyName>Sonos product</friendlyName><modelName>Sonos Beam (Gen 2)</modelName>
          <roomName>Living Room</roomName><UDN>uuid:RINCON_TEST</UDN>
          <deviceList><device><serviceList><service>
          <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
          <controlURL>/MediaRenderer/AVTransport/Control</controlURL>
          </service></serviceList></device></deviceList></device></root>` };
      }
      if (url === 'http://192.168.1.5/desc') {
        return { ok: true, text: async () => `<root><device><friendlyName>UPnP Hub</friendlyName>
          <deviceList><device><UDN>uuid:receiver</UDN><friendlyName>Office Receiver</friendlyName><manufacturer>Samsung</manufacturer>
          <serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:2</serviceType>
          <controlURL>/av</controlURL></service></serviceList></device></deviceList></device></root>` };
      }
      if (url === 'http://192.168.1.7/desc') {
        return { ok: true, text: async () => `<root><device><friendlyName>Living Room Display</friendlyName>
          <modelName>Samsung DTV DMR</modelName><UDN>uuid:tv</UDN><serviceList><service>
          <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
          <controlURL>/av</controlURL></service></serviceList></device></root>` };
      }
      assert.equal(url, 'http://192.168.1.3/desc');
      return { ok: true, text: async () => `<root><device><friendlyName>Den</friendlyName><UDN>uuid:def</UDN><serviceList><service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/control</controlURL></service></serviceList></device></root>` };
    }
  }).exports;
  const sonosActions = [];
  const playback = new Playback(() => {});
  const picker = playback.autocomplete('');
  const filtered = playback.autocomplete('google cast');
  t.mock.timers.tick(2500);
  assert.deepEqual(await picker, [
    { id: 'all', name: 'All speakers', description: 'All currently discoverable speakers' },
    { id: 'all_no_tvs', name: 'All speakers (no TVs)', description: 'Skip recognized TVs and video Cast receivers' },
    { id: 'all_no_tv_speakers', name: 'All speakers (no TVs or TV speakers)', description: 'Also skip recognized soundbars and home theater speakers' },
    { id: 'dlna:uuid:def', name: 'Den', description: 'UPnP / DLNA' },
    { id: 'cast:video', name: 'Den Display', description: 'Google Cast' },
    { id: 'cast:abc', name: 'Kitchen', description: 'Google Cast' },
    { id: 'dlna:uuid:rincon_test', name: 'Living Room', description: 'Sonos' },
    { id: 'dlna:uuid:tv', name: 'Living Room Display', description: 'UPnP / DLNA' },
    { id: 'dlna:uuid:receiver', name: 'Office Receiver', description: 'UPnP / DLNA' }
  ]);
  assert.deepEqual((await filtered).map(item => item.id), ['cast:video', 'cast:abc']);
  assert.equal((await playback.select({ id: 'dlna:uuid:def' })).endpoint, 'http://192.168.1.3/control');
  assert.equal((await playback.select({ id: 'dlna:uuid:receiver' })).endpoint, 'http://192.168.1.5/av');
  const tv = await playback.select({ id: 'dlna:uuid:tv' });
  assert.equal(tv.kind, 'tv');
  const sonos = await playback.select({ id: 'dlna:uuid:rincon_test_mr' });
  assert.equal(sonos.id, 'dlna:uuid:rincon_test');
  assert.equal(sonos.kind, 'tvSpeaker');
  assert.equal(closed, 2);
  const attempts = [];
  playback.playSingle = async target => attempts.push(target.id);
  for (const [id, expected] of [
    ['all_no_tvs', ['cast:abc', 'dlna:uuid:def', sonos.id, 'dlna:uuid:receiver']],
    ['all_no_tv_speakers', ['cast:abc', 'dlna:uuid:def', 'dlna:uuid:receiver']]
  ]) {
    const pending = playback.select({ id });
    t.mock.timers.tick(2500);
    // Verify the exact targets dispatched; the Sonos topology guard has its own integration test.
    const selection = await pending;
    await playback.play(selection, {});
    assert.deepEqual(attempts.splice(0).sort(), expected.sort());
  }
  playback.refresh = async () => [tv, sonos];
  await assert.rejects(playback.select({ id: 'all_no_tv_speakers' }), /No speakers match/);
  delete playback.playSingle;
  await playback.play(sonos, { url: 'http://192.168.1.1:47333/tts/test.mp3', type: 'audio/mpeg' });
  assert.deepEqual(sonosActions, [
    `"${sonos.service}#SetAVTransportURI"`, `"${sonos.service}#Play"`
  ]);
});

test('Cast TV exclusions distinguish video receivers, audio speakers and soundbars', async t => {
  const { EventEmitter } = require('node:events');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receivers = [
    { id: 'stick', fn: 'Living room', md: 'Chromecast Ultra' },
    { id: 'hub', fn: 'Office display', md: 'Google Nest Hub', ca: '13' },
    { id: 'mini', fn: 'Bedroom', md: 'Google Nest Mini', ca: '12' },
    { id: 'audio', fn: 'Kitchen', md: 'Chromecast Audio' },
    { id: 'bar', fn: 'Den', md: 'Bose Smart Ultra Soundbar', ca: '12' }
  ];
  const Playback = compile('../lib/speaker-playback', {
    'bonjour-service': { Bonjour: class {
      find({ type }, callback) {
        assert.equal(type, 'googlecast');
        receivers.forEach((txt, i) => callback({ txt, addresses: [`192.168.1.${i + 2}`], port: 8009 }));
        return { stop() {} };
      }
      destroy() {}
    } },
    dgram: { createSocket() {
      return Object.assign(new EventEmitter(), { send() {}, close() {} });
    } }
  }).exports;
  const playback = new Playback(() => {});
  const dispatched = [];
  playback.playSingle = async target => dispatched.push(target.id);
  for (const [group, expected] of [
    ['all', ['stick', 'hub', 'mini', 'audio', 'bar']],
    ['all_no_tvs', ['mini', 'audio', 'bar']],
    ['all_no_tv_speakers', ['mini', 'audio']]
  ]) {
    const pending = playback.select({ id: group });
    t.mock.timers.tick(2500);
    await playback.play(await pending, { url: 'http://homey.invalid/tts/test.mp3' });
    assert.deepEqual(dispatched.splice(0), expected.map(id => `cast:${id}`));
  }
});

test('confirmed Sonos stereo pairs are one target and keep both saved speaker IDs', async t => {
  const { EventEmitter } = require('node:events');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ids = ['RINCON_LEFT', 'RINCON_RIGHT', 'RINCON_OTHER', 'RINCON_OFFLINE'];
  const zone = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1';
  const map = `${ids[0]}:LF,LF;${ids[1]}:RF,RF`;
  // The stereo primary need not be the left speaker or the playback-group coordinator.
  let state = `<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="${ids[2]}">
    <ZoneGroupMember UUID="${ids[0]}" Invisible="1" ChannelMapSet="${map}"/>
    <ZoneGroupMember UUID="${ids[1]}" ChannelMapSet="${map}"/>
    <ZoneGroupMember UUID="${ids[2]}"/>
  </ZoneGroup></ZoneGroups></ZoneGroupState>`;
  const logs = [];
  const playUrls = [];
  let includePrimary = true;
  let includeOther = true;
  const Playback = compile('../lib/speaker-playback', {
    'bonjour-service': { Bonjour: class {
      find() { return { stop() {} }; }
      destroy() {}
    } },
    dgram: { createSocket() {
      const socket = new EventEmitter();
      socket.close = () => {};
      socket.send = query => {
        if (!query.includes('ZonePlayer:1')) return;
        [...ids, `${ids[0]}_MR`].forEach((id, i) => {
          if (!includePrimary && id === ids[1]) return;
          if (!includeOther && id === ids[2]) return;
          const address = `192.168.1.${i === 4 ? 10 : 10 + i}`;
          socket.emit('message', Buffer.from(`HTTP/1.1 200 OK\r\nUSN: uuid:${id}::renderer\r\nLOCATION: http://${address}:1400/desc\r\n`), { address });
        });
      };
      return socket;
    } },
    'node-fetch': async (url, options) => {
      const i = Number(new URL(url).hostname.split('.').pop()) - 10;
      if (url.endsWith('/av')) {
        playUrls.push(url);
        const action = /#([^"]+)/.exec(options.headers.SOAPAction)[1];
        return { ok: true, text: async () => `<Envelope><Body><${action}Response/></Body></Envelope>` };
      }
      if (url.endsWith('/topology')) {
        assert.equal(options.headers.SOAPAction, `"${zone}#GetZoneGroupState"`);
        assert.equal(options.redirect, 'error');
        if (i === 3) return { ok: false, status: 503 };
        const escaped = state.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return { ok: true, text: async () => `<s:Envelope><s:Body><u:GetZoneGroupStateResponse>
          <ZoneGroupState>${escaped}</ZoneGroupState></u:GetZoneGroupStateResponse></s:Body></s:Envelope>` };
      }
      return { ok: true, text: async () => `<root><device>
        <deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType>
        <manufacturer>Sonos</manufacturer><modelName>${i < 2 ? 'Sonos Roam SL' : 'Sonos One'}</modelName>
        <roomName>Keuken</roomName><UDN>uuid:${ids[i]}</UDN>
        <serviceList><service><serviceType>${zone}</serviceType><controlURL>/topology</controlURL></service>
        <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/av</controlURL></service></serviceList></device></root>` };
    }
  }).exports;
  const playback = new Playback((...args) => logs.push(args));
  const picker = playback.autocomplete('Keuken');
  t.mock.timers.tick(2500);
  assert.deepEqual(await picker, [
    { id: 'dlna:uuid:rincon_other', name: 'Keuken', description: 'Sonos' },
    { id: 'dlna:uuid:rincon_offline', name: 'Keuken', description: 'Sonos' },
    { id: 'dlna:uuid:rincon_right', name: 'Keuken (Stereo)', description: 'Sonos · Left: Sonos Roam SL · Right: Sonos Roam SL' }
  ]);
  assert.match(logs[0].join(' '), /topology.*HTTP 503/);
  const primary = await playback.select({ id: 'dlna:uuid:rincon_right' });
  assert.equal(await playback.select({ id: 'dlna:uuid:rincon_left' }), primary);
  assert.equal(await playback.select({ id: 'dlna:uuid:rincon_left_mr' }), primary);
  await playback.play(primary, { url: 'http://192.168.1.1:47333/tts/test.mp3', type: 'audio/mpeg' });
  assert.deepEqual(playUrls, Array(2).fill('http://192.168.1.11:1400/av'));
  includePrimary = false;
  const refreshed = playback.refresh();
  t.mock.timers.tick(2500);
  const available = await refreshed;
  assert.equal(available.some(speaker => speaker.id === 'dlna:uuid:rincon_left'), false,
    'a hidden bonded speaker cannot become an independent target when the visible partner is unavailable');
  includePrimary = true;
  state = `<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="${ids[2]}">
    <ZoneGroupMember UUID="${ids[1]}" ChannelMapSet="${map}"><Satellite UUID="${ids[0]}"/></ZoneGroupMember>
    <ZoneGroupMember UUID="${ids[2]}"/>
  </ZoneGroup></ZoneGroups></ZoneGroupState>`;
  const nested = playback.refresh();
  t.mock.timers.tick(2500);
  const nestedSpeakers = await nested;
  assert.equal(nestedSpeakers.some(speaker => speaker.id === 'dlna:uuid:rincon_left'), false);
  const nestedPrimary = await playback.select({ id: 'dlna:uuid:rincon_right' });
  assert.equal(await playback.select({ id: 'dlna:uuid:rincon_left' }), nestedPrimary);
  includeOther = false;
  state = state.replace(`<ZoneGroupMember UUID="${ids[2]}"/>`,
    `<ZoneGroupMember UUID="${ids[2]}" Location="http://192.168.1.12:1400/xml/device_description.xml"/>`);
  const all = playback.select({ id: 'all' });
  t.mock.timers.tick(2500);
  assert.ok((await all).targets.some(speaker => speaker.id === 'dlna:uuid:rincon_other'));
});

test('speaker playback loads Cast audio and sends DLNA commands in order', async () => {
  const { EventEmitter } = require('node:events');
  const commands = [];
  class Client extends EventEmitter {
    connect(options, callback) { commands.push(options); callback(); }
    launch(_, callback) {
      callback(null, { load: (media, options, done) => { commands.push({ media, options }); done(null, [{}]); } });
    }
    close() { commands.push('closed'); this.emit('close'); }
  }
  let rejectDlna = false;
  let soapFault = false, missingResponse = false;
  const Playback = compile('../lib/speaker-playback', {
    'castv2-client': { Client },
    'node-fetch': async (url, options) => {
      commands.push({ url, ...options });
      const action = /#([^"]+)/.exec(options.headers.SOAPAction)[1];
      return { ok: !rejectDlna, status: rejectDlna ? 500 : 200, text: async () => missingResponse
        ? '<Envelope><Body/></Envelope>' : rejectDlna || soapFault
        ? '<Envelope><Body><Fault><detail><UPnPError><errorCode dt:dt="string">716</errorCode></UPnPError></detail></Fault></Body></Envelope>'
        : `<Envelope><Body><${action}Response/></Body></Envelope>` };
    }
  }).exports;
  const playback = new Playback(() => {});
  const media = { url: 'http://192.168.1.1:47333/tts/test.mp3?a=1&b=2', type: 'audio/mpeg' };
  await playback.play({ host: '192.168.1.2', port: 8009, protocol: 'cast' }, media);
  assert.deepEqual(commands.splice(0), [
    { host: '192.168.1.2', port: 8009 },
    { media: { contentId: media.url, contentType: media.type, streamType: 'BUFFERED' }, options: { autoplay: true } },
    'closed'
  ]);
  const renderer = { protocol: 'dlna', endpoint: 'http://192.168.1.3/control', service: 'urn:schemas-upnp-org:service:AVTransport:1' };
  await playback.play(renderer, media);
  assert.deepEqual(commands.map(command => command.headers.SOAPAction), [
    `"${renderer.service}#SetAVTransportURI"`, `"${renderer.service}#Play"`
  ]);
  assert.match(commands[0].body, /<CurrentURI>[^<]+a=1&amp;b=2<\/CurrentURI>/);
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ removeNSPrefix: true });
  const metadata = parser.parse(commands[0].body).Envelope.Body.SetAVTransportURI.CurrentURIMetaData;
  assert.equal(parser.parse(metadata)['DIDL-Lite'].item.class, 'object.item.audioItem.musicTrack');
  commands.length = 0;
  rejectDlna = true;
  await assert.rejects(playback.play(renderer, media), /rejected SetAVTransportURI \(HTTP 500, UPnP 716\)/);
  assert.equal(commands.length, 1);
  rejectDlna = false;
  for (const fault of [true, false]) {
    commands.length = 0;
    soapFault = fault;
    missingResponse = !fault;
    await assert.rejects(playback.play(renderer, media), fault ? /HTTP 200, UPnP 716/ : /did not return SetAVTransportURI/);
    assert.equal(commands.length, 1, 'a failed load must not dispatch Play');
  }
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
  const settings = { origin: suggestions[0], destination: '52,4', travel_mode: 'WALK', route_image: false, route_traffic: true };
  await handlers.save_route(settings);
  const [paired] = await handlers.list_devices();
  const expected = { ...settings, origin: 'Utrecht', origin_homey: false, destination_homey: false };
  assert.equal(paired.name, 'Maps device');
  assert.deepEqual(paired.settings, expected);
  assert.deepEqual(paired.store.maps_route_places, { origin: { address: 'Utrecht', id: 'place_id:ChIJ_example' } });
  await assert.rejects(() => other.list_devices(), /Configure/);
  await assert.rejects(() => handlers.save_route({ ...settings, origin: '' }), /origin and destination/);
  await assert.rejects(() => handlers.save_route({ ...settings, origin: suggestions[0].id }), /instead of a place ID/);
  await assert.rejects(() => handlers.save_route({ ...settings, travel_mode: 'FLY' }), /travel mode/);
  await assert.rejects(() => handlers.save_route({ ...settings, route_image: 'true' }), /route image/);
  assert.deepEqual((await handlers.list_devices())[0].settings, expected);
  await handlers.save_route({ ...settings, origin: '', origin_homey: true });
  assert.deepEqual((await handlers.list_devices())[0].settings, { ...expected, origin: '', origin_homey: true });
});

test('Maps repair updates route settings on the existing device without refreshing the route', async () => {
  let lookupDenied = true;
  const driverMaps = compile('../lib/maps', {
    'node-fetch': async (url, options) => {
      assert.equal(url, 'https://places.googleapis.com/v1/places/ChIJ_origin?languageCode=nl');
      assert.equal(options.headers['X-Goog-FieldMask'], 'formattedAddress');
      if (lookupDenied) return new (require('node-fetch').Response)(null, { status: 403 });
      return new (require('node-fetch').Response)(JSON.stringify({ formattedAddress: 'Origin address' }));
    }
  }).exports;
  const Driver = compile('../drivers/maps/driver', { homey: { Driver: class {} }, '../../lib/maps': driverMaps }).exports;
  const Device = compile('../drivers/maps/device', { homey: { Device: class {} } }).exports;
  const driver = new Driver();
  const device = new Device();
  const settings = { origin: 'place_id:ChIJ_origin', destination: 'Utrecht', travel_mode: 'WALK', route_image: false };
  const writes = [];
  const store = {};
  const cleared = [];
  const search = [];
  let warning;
  let imageUpdates = 0;
  const errors = [];
  driver.error = (...args) => errors.push(args.join(' '));
  driver.homey = { settings: { get: () => 'fake-key' }, i18n: { getLanguage: () => 'nl' } };
  driver.searchAddresses = async query => {
    search.push(query);
    return [{ name: 'Amsterdam', id: 'place_id:ChIJ_amsterdam', google: true }];
  };
  driver.calculateRoute = () => assert.fail('Repair must not calculate a route');
  Object.assign(device, {
    driver, homey: { __: key => key },
    getSettings: () => ({ ...settings }),
    getSetting: key => settings[key],
    getStoreValue: key => store[key],
    setStoreValue: async (key, value) => { store[key] = value; },
    setSettings: async changes => { writes.push(changes); Object.assign(settings, changes); },
    unsetStoreValue: async key => cleared.push(key),
    setCapabilityValue: async (id, value) => { assert.equal(value, null); cleared.push(id); },
    setWarning: async text => { warning = text; },
    image: { update: async () => { imageUpdates++; } },
    routeMap: { path: 'old route' },
    routeImage: Promise.resolve(Buffer.from('old image'))
  });
  const handlers = {};
  driver.onRepair({ setHandler: (name, fn) => { handlers[name] = fn; } }, device);
  const unresolved = await handlers.get_route_settings();
  assert.equal(unresolved.origin, '');
  assert.equal(unresolved.address_lookup_failed, true);
  assert.match(errors[0], /denied access/);
  assert.equal(settings.origin, 'place_id:ChIJ_origin');
  assert.deepEqual(writes, []);
  lookupDenied = false;
  const saved = await handlers.get_route_settings();
  assert.deepEqual(saved, { ...settings, origin: { name: 'Origin address', id: settings.origin },
    origin_homey: false, destination_homey: false, route_traffic: true });
  assert.deepEqual(search, []);
  await handlers.save_route_settings(saved);
  const migrated = await handlers.get_route_settings();
  assert.equal(migrated.origin, 'Origin address');
  assert.deepEqual(store.maps_route_places, { origin: { address: 'Origin address', id: saved.origin.id } });
  assert.deepEqual(writes.splice(0), [{ origin: 'Origin address' }]);
  await handlers.save_route_settings(migrated);
  await assert.rejects(() => handlers.save_route_settings({ ...migrated, destination: '' }), /origin and destination/);
  assert.deepEqual(writes, []);
  assert.deepEqual(cleared, []);

  const [suggestion] = await handlers.search_address('Amsterdam');
  assert.deepEqual(search, ['Amsterdam']);
  await handlers.save_route_settings({ ...migrated, route_traffic: false });
  assert.deepEqual(writes, [{ route_traffic: false }]);
  assert.deepEqual(cleared, []);
  await handlers.save_route_settings({ ...migrated, destination: suggestion, origin_homey: true,
    travel_mode: 'DRIVE', route_image: true, route_traffic: false });
  assert.deepEqual(writes[1], { destination: suggestion.name, origin_homey: true, travel_mode: 'DRIVE', route_image: true });
  assert.deepEqual({ ...settings, destination_homey: false }, { ...migrated, ...writes[1], route_traffic: false });
  assert.deepEqual(cleared.sort(), ['maps_distance', 'maps_eta', 'maps_last_refreshed', 'maps_leave_by', 'maps_minutes', 'maps_route_state', 'maps_traffic_delay']);
  assert.equal(device.routeMap, null);
  assert.equal(device.routeImage, null);
  assert.equal(imageUpdates, 1);
  assert.equal(warning, 'maps.refresh_needed');
  const resolve = () => driverMaps.resolveSavedRoute(settings, () => ({ text: 'Homey' }), store.maps_route_places);
  assert.deepEqual(resolve().destination.waypoint, { placeId: 'ChIJ_amsterdam' });
  await device.onSettings({ newSettings: { ...settings, destination: 'Rotterdam' }, changedKeys: ['destination'] });
  settings.destination = 'Rotterdam';
  assert.deepEqual(resolve().destination.waypoint, { address: 'Rotterdam' });
  assert.equal(store.maps_route_places.destination, undefined);
  assert.equal(store.maps_route_places.origin.id, saved.origin.id);
});

test('Maps Pair and Repair forms save all route settings, including explicit opt-outs', async () => {
  const vm = require('node:vm');
  for (const [view, save] of [['pair/configure', 'save_route'], ['repair/edit_route', 'save_route_settings']]) {
    const fields = new Map();
    const get = id => {
      if (!fields.has(id)) fields.set(id, {
        value: '', checked: false, disabled: id === 'routeAddresses', handlers: {},
        addEventListener(event, handler) { this.handlers[event] = handler; },
        replaceChildren() {}
      });
      return fields.get(id);
    };
    const saved = { origin: 'Origin address', destination: '52,4', origin_homey: true, destination_homey: false,
      travel_mode: 'TRANSIT', route_image: false, route_traffic: false };
    const pairing = save === 'save_route';
    const calls = [];
    const script = fs.readFileSync(require.resolve(`../drivers/maps/${view}.js`), 'utf8');
    await vm.runInNewContext(script, {
      document: { getElementById: get }, setTimeout, clearTimeout,
      Homey: {
        __: key => key, setTitle() {}, showView: id => calls.push(id), done: () => calls.push('done'),
        async emit(event, data) {
          if (event === 'get_route_settings') return saved;
          assert.equal(event, save);
          calls.push({ ...data });
        }
      }
    });
    if (pairing) {
      get('origin').value = saved.origin;
      get('destination').value = saved.destination;
      get('travelMode').value = saved.travel_mode;
      get('routeImage').checked = saved.route_image;
      get('routeTraffic').checked = saved.route_traffic;
      get('originHomey').checked = true;
      get('originHomey').handlers.change();
    } else {
      assert.equal(get('origin').value, saved.origin);
      assert.equal(get('destination').value, saved.destination);
      assert.equal(get('travelMode').value, saved.travel_mode);
      assert.equal(get('routeImage').checked, false);
      assert.equal(get('routeTraffic').checked, false);
    }
    assert.equal(get('origin').disabled, true);
    assert.equal(get('destination').disabled, false);
    await get(pairing ? 'routeForm' : 'editRouteForm').handlers.submit({ preventDefault() {} });
    assert.deepEqual(calls, [saved, pairing ? 'list_devices' : 'done']);
  }
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
    betterlogiclibrary: { BL: { decode: async text => text } },
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
    i18n: { getLanguage: () => 'en' },
    settings: { get: name => { assert.equal(name, 'MapsApiKey'); return ' fake-maps-key '; } },
    flow: {
      getActionCard: id => ({
        registerRunListener: run => { listeners[id] = run; },
        getArgument: name => ({ registerAutocompleteListener: run => { autocomplete[name] = run; } })
      }),
      getConditionCard: () => ({ registerRunListener() {}, getArgument: () => ({ registerAutocompleteListener() {} }) })
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
  }), /Choose an address/);
  driver.searchAddresses = async query => [{ id: query, name: query }];
  assert.deepEqual(await autocomplete.from('Typed origin'), [{ id: 'Typed origin', name: 'Typed origin' }]);
  assert.deepEqual(await autocomplete.to('Typed destination'), [{ id: 'Typed destination', name: 'Typed destination' }]);
  let refreshed = false;
  await listeners.maps_refresh_route({ device: { refreshRoute: async () => { refreshed = true; } } });
  assert.ok(refreshed);
});

test('Maps conditions check saved results without requests and handle missing readings and threshold equality', async () => {
  const Driver = compile('../drivers/maps/driver', { homey: { Driver: class {} },
    betterlogiclibrary: { BL: { decode: async text => text } } }).exports;
  const driver = new Driver();
  const conditions = {};
  driver.homey = {
    i18n: { getLanguage: () => 'en' },
    __: key => key,
    flow: {
      getActionCard: () => ({
        registerRunListener() {}, getArgument: () => ({ registerAutocompleteListener() {} })
      }),
      getConditionCard: id => ({ registerRunListener: run => { conditions[id] = run; },
        getArgument: () => ({ registerAutocompleteListener() {} }) })
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
  let requests = 0;
  driver.calculateRoute = async (input, includeMap) => {
    requests++;
    assert.equal(input.origin.waypoint.placeId, 'ChIJ_origin');
    assert.equal(input.destination.waypoint.address, 'Utrecht');
    assert.equal(input.mode, 'DRIVE');
    assert.equal(includeMap, undefined);
    return { durationSeconds: 1503, tokens: { minutes: 25.1 } };
  };
  const fresh = minutes => conditions.maps_trip_takes_longer({
    from: { id: 'place_id:ChIJ_origin' }, to: 'Utrecht', mode: 'DRIVE', minutes
  });
  for (const minutes of [-1, NaN, '10']) await assert.rejects(() => fresh(minutes), /invalid_minutes/);
  assert.equal(requests, 0);
  assert.equal(await fresh(25), true);
  assert.equal(await fresh(25.05), false);
  assert.equal(await fresh(25.1), false);
  assert.equal(requests, 3);
});

test('Maps resolves each Homey endpoint on demand and validates missing coordinates', () => {
  const { resolveSavedRoute } = require('../lib/maps');
  const Device = compile('../drivers/maps/device', { homey: { Device: class {} } }).exports;
  const device = new Device();
  let latitude = 52;
  const longitude = 4;
  device.homey = { __: key => key, geolocation: { getLatitude: () => latitude, getLongitude: () => longitude } };
  const settings = { origin: 'A', destination: 'B', travel_mode: 'WALK' };
  const resolve = flags => resolveSavedRoute({ ...settings, ...flags }, () => device.getHomeyRoutePoint());
  assert.equal(resolveSavedRoute(settings, () => assert.fail('Manual routes must not read Homey location')).origin.text, 'A');
  assert.deepEqual(resolve({ origin_homey: true, origin: '' }).origin.waypoint, { location: { latLng: { latitude, longitude } } });
  assert.equal(resolve({ origin_homey: true }).destination.text, 'B');
  latitude = 53;
  const tripHome = resolve({ destination_homey: true, destination: '' });
  assert.equal(tripHome.origin.text, 'A');
  assert.equal(tripHome.destination.text, '53,4');
  latitude = null;
  assert.throws(() => resolve({ destination_homey: true }), /homey_location_unavailable/);
});

test('Maps device button refreshes the saved route and streams its camera image on demand', async t => {
  const now = Date.UTC(2026, 10, 18, 12, 0, 42);
  t.mock.timers.enable({ apis: ['Date'], now });
  const Device = compile('../drivers/maps/device', { homey: { Device: class {} } }).exports;
  const device = new Device();
  const values = { maps_refresh: true };
  const store = {};
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
    getStoreValue: key => store[key],
    setStoreValue: async (key, value) => { store[key] = value; },
    unsetStoreValue: async key => { delete store[key]; },
    hasCapability: () => true,
    setCapabilityValue: async (id, value) => { values[id] = value; },
    registerCapabilityListener: (id, fn) => { assert.equal(id, 'maps_refresh'); refresh = fn; },
    setWarning: async () => {},
    setCameraImage: async (id, title, value) => { assert.equal(id, 'route'); assert.equal(value, image); }
  });
  await device.onInit();
  assert.equal(values.maps_refresh, false);
  assert.equal(values.maps_last_refreshed ?? null, null);
  values.maps_refresh = true;
  await refresh();
  assert.equal(values.maps_refresh, false);
  assert.equal(values.maps_last_refreshed, '18 nov, 13:00');
  assert.equal(values.maps_last_refreshed, values.maps_eta);
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
  assert.equal(values.maps_last_refreshed, '18 nov, 13:01');
  assert.deepEqual(events.at(-1), {
    id: 'maps_travel_time_changed',
    tokens: { minutes: 24.7, previous_minutes: 25, change_minutes: -0.3 }
  });
  routeError = new Error('Routes API quota exceeded.');
  values.maps_refresh = true;
  t.mock.timers.tick(60 * 1000);
  await assert.rejects(() => refresh(), /quota exceeded/);
  assert.equal(values.maps_last_refreshed, '18 nov, 13:01');
  assert.equal(values.maps_refresh, false);
  assert.deepEqual(events.at(-1), { id: 'maps_refresh_failed', tokens: { error: 'Routes API quota exceeded.' } });
  assert.equal(values.maps_minutes, 24.7);
  routeError = null;
  settings.route_image = false;
  await device.onSettings({ newSettings: settings, changedKeys: ['route_image'] });
  assert.equal(values.maps_minutes, null);
  assert.equal(values.maps_last_refreshed, null);
  assert.equal(store.maps_route_state, undefined);
  await refresh();
  assert.equal(events.at(-1).id, 'maps_route_updated');
  await assert.rejects(() => source(new Writable()), /image_unavailable/);
  await device.onUninit();
});

test('Maps refresh ignores overlapping button presses and restores saved readings and route images after restart', async () => {
  const Device = compile('../drivers/maps/device', { homey: { Device: class {} } }).exports;
  const values = {
    maps_minutes: 31, maps_distance: 42, maps_eta: 'Nov 18, 6:00 PM',
    maps_last_refreshed: 'Nov 18, 2026, 5:25:00 PM', maps_refresh: false
  };
  const store = {};
  const tokens = { minutes: 28, kilometers: 39, eta: '2026-11-18T17:58:00Z' };
  const map = { path: 'encoded route', start: { latitude: 52, longitude: 5 }, end: { latitude: 53, longitude: 5 } };
  const imageBytes = Buffer.from('cached route image');
  let resolveRoute;
  let routeRequests = 0;
  let imageRequests = 0;
  let refreshListener;
  let imageSource;
  const settings = { origin: 'Utrecht', destination: 'Amsterdam', travel_mode: 'DRIVE', route_image: true };
  const makeImage = () => ({
    setStream: listener => { imageSource = listener; },
    update: async () => {},
    unregister: async () => {}
  });
  const attach = device => {
    Object.assign(device, {
      homey: {
        images: { createImage: async () => makeImage() },
        flow: { getDeviceTriggerCard: () => ({ trigger: async () => {} }) },
        __: key => key,
        clock: { getTimezone: () => 'Europe/Amsterdam' },
        i18n: { getLanguage: () => 'en' }
      },
      driver: {
        routeImagesEnabled: () => true,
        calculateRoute: async () => {
          routeRequests++;
          return new Promise(resolve => { resolveRoute = resolve; });
        },
        fetchRouteImage: async requestedMap => {
          assert.deepEqual(requestedMap, map);
          imageRequests++;
          return imageBytes;
        }
      },
      getSettings: () => settings,
      getSetting: key => settings[key],
      getCapabilityValue: key => values[key],
      hasCapability: () => true,
      setCapabilityValue: async (id, value) => { values[id] = value; },
      getStoreValue: key => store[key],
      setStoreValue: async (key, value) => { store[key] = value; },
      unsetStoreValue: async key => { delete store[key]; },
      registerCapabilityListener: (id, listener) => {
        assert.equal(id, 'maps_refresh');
        refreshListener = listener;
      },
      setWarning: async () => {},
      setCameraImage: async (id, title) => { assert.equal(id, 'route'); assert.equal(title, 'maps.image_title'); },
      error: () => {}
    });
  };
  const writeImage = () => new Writable({ write(_, __, done) { done(); } });

  const device = new Device();
  attach(device);
  await device.onInit();
  assert.equal(values.maps_minutes, 31);
  assert.equal(values.maps_last_refreshed, 'Nov 18, 2026, 5:25:00 PM');
  values.maps_refresh = true;
  const firstPress = refreshListener();
  assert.equal(routeRequests, 1);
  await refreshListener();
  assert.equal(routeRequests, 1);
  assert.equal(values.maps_refresh, true);

  resolveRoute({ tokens, map, durationSeconds: 28 * 60 });
  await firstPress;
  assert.equal(values.maps_minutes, 28);
  assert.equal(values.maps_distance, 39);
  assert.equal(values.maps_refresh, false);
  await imageSource(writeImage());
  assert.equal(imageRequests, 1);
  assert.equal(store.maps_route_state.image, imageBytes.toString('base64'));
  assert.equal(store.maps_route_state.durationSeconds, 28 * 60);
  const plan = { arrival_deadline: '2026-11-20 09:00', departure_buffer: 7 };
  await device.onSettings({ newSettings: { ...settings, ...plan }, changedKeys: Object.keys(plan) });
  Object.assign(settings, plan);
  const expectedLeaveBy = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: 'short',
    day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date('2026-11-20T07:25:00Z'));
  assert.equal(values.maps_leave_by, expectedLeaveBy);

  const savedReadings = { ...values };
  await device.onUninit();
  const restartedDevice = new Device();
  attach(restartedDevice);
  await restartedDevice.onInit();
  assert.deepEqual(values, { ...savedReadings, maps_refresh: false });
  await imageSource(writeImage());
  assert.equal(imageRequests, 1);
  assert.equal(routeRequests, 1);
  await restartedDevice.onUninit();
});

test('Maps image settings default to enabled and save an explicit opt-out', async () => {
  const vm = require('node:vm');
  for (const value of [undefined, null, true, false]) {
    const fields = Object.fromEntries([
      'cloudJSON', 'cloudProject', 'cloudApiKey', 'mapsApiKey', 'mapsRouteImages', 'mapsRouteTraffic',
      'defaultCloudVoice', 'save', 'settingsStatus'
    ].map(id => [id, { value: '', add() {}, addEventListener(_, listener) { this.click = listener; } }]));
    const writes = [];
    const context = vm.createContext({
      document: { getElementById: id => fields[id], querySelectorAll: () => [] },
      Option: class {}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../settings/settings.js'), 'utf8'), context);
    await context.onHomeyReady({
      ready() {},
      get(key, callback) { callback(null, ['MapsRouteImagesEnabled', 'MapsRouteTrafficEnabled'].includes(key) ? value : null); },
      set(key, next, callback) { writes.push([key, next]); callback(null); }
    });
    assert.equal(fields.mapsRouteImages.checked, value !== false);
    assert.equal(fields.mapsRouteTraffic.checked, value !== false);
    await fields.save.click();
    assert.deepEqual(writes, []);
    fields.mapsRouteImages.checked = !fields.mapsRouteImages.checked;
    fields.mapsRouteTraffic.checked = !fields.mapsRouteTraffic.checked;
    await fields.save.click();
    assert.deepEqual(writes, [['MapsRouteImagesEnabled', value === false], ['MapsRouteTrafficEnabled', value === false]]);
  }
});

test('Groups settings creates a named group and keeps an undiscovered member selected when editing', async () => {
  const vm = require('node:vm');
  class Element {
    children = [];
    attrs = {};
    events = {};
    value = '';
    get valueAsNumber() { return Number(this.value); }
    set textContent(value) { this.text = value; this.children = []; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key]; }
    addEventListener(event, listener) { this.events[event] = listener; }
    append(...children) { this.children.push(...children); }
    add(option) { this.append(option); }
    focus() {}
  }
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  el('generalTab').setAttribute('aria-controls', 'generalPanel');
  el('groupsTab').setAttribute('aria-controls', 'groupsPanel');
  const context = vm.createContext({
    document: { getElementById: el, querySelectorAll: () => [], createElement: () => new Element() },
    Option: class { constructor(text, value) { Object.assign(this, { text, value }); } }
  });
  const speaker = { id: 'cast:bedroom', name: 'Bedroom' };
  const requests = [];
  let groups = [];
  let online = true;
  const settled = () => new Promise(resolve => setImmediate(resolve));
  vm.runInContext(fs.readFileSync(require.resolve('../settings/speaker-groups.js'), 'utf8'), context);
  context.initSpeakerGroups({ __: key => key }, async (bridge, method, url, body) => {
    assert.equal(bridge, 'api');
    requests.push([method, url]);
    if (url === '/api-ready') return { ready: true };
    if (url.startsWith('/announcement-speakers')) return online ? [speaker] : [];
    if (method === 'GET') return groups;
    assert.equal(url, '/speaker-groups');
    assert.equal(body.name, 'Upstairs');
    const [member] = body.members;
    assert.equal(member.id, speaker.id);
    assert.equal(member.volumeOffset, 15);
    assert.equal(member.maxVolume, 35);
    const saved = { id: 'group:fixture', name: body.name, members: [{ ...speaker, ...member }] };
    groups = [saved];
    return saved;
  });
  assert.deepEqual(requests, [], 'opening General does not scan for speakers');
  el('groupsTab').events.click();
  await settled();
  assert.equal(el('groupsPanel').hidden, false);
  assert.equal(el('generalActions').hidden, true);
  el('speakerGroupAdd').events.click();
  await settled();
  el('speakerGroupName').value = 'Upstairs';
  el('speakerGroupName').events.input();
  const row = () => el('speakerGroupMembers').children[0];
  const checkbox = () => row().children[0].children[0];
  checkbox().checked = true;
  checkbox().events.change();
  for (const [i, value] of [15, 35].entries()) {
    const [heading, input] = row().children[1].children[i].children;
    assert.equal(input.type, 'range');
    input.value = String(value);
    input.events.input();
    assert.equal(heading.children[1].text, i === 0 ? '+15' : '35%');
  }
  assert.equal(el('speakerGroupSave').disabled, false);
  el('speakerGroupSave').events.click();
  await settled();
  assert.equal(el('speakerGroupSelect').value, 'group:fixture');
  online = false;
  el('speakerGroupRefresh').events.click();
  await settled();
  assert.equal(checkbox().checked, true);
  assert.equal(row().children[1].children[1].children[1].value, '35');
  assert.equal(el('speakerGroupSave').disabled, true, 'a scan does not change saved membership');
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

test('Cloud TTS Pair and Repair validate, preview and save a voice without replacing the device', async () => {
  const voice = { name: 'nl-NL-Test-A', languageCode: 'nl-NL', ssmlGender: 'FEMALE' };
  const voices = compile('../lib/speech-voices', {
    './tts-server': {
      getVoices: async () => [{ ...voice, languageCodes: ['nl-NL'] }],
      getResponse: async request => {
        assert.deepEqual(request.voice, voice);
        assert.equal(request.plainText, true);
        return Buffer.from('preview');
      }
    }
  }).exports;
  const Driver = compile('../drivers/googlecloudtts/driver', {
    homey: { Driver: class {} }, '../../lib/speech-voices': voices
  }).exports;
  const session = () => ({ setHandler(event, fn) { this[event] = fn; } });
  const driver = new Driver();
  const pair = session();
  driver.homey = { i18n: { getLanguage: () => 'en' }, __: () => 'en' };
  driver.onPair(pair);
  assert.equal((await pair.list_devices())[0].store.cloud_voice, undefined);
  await assert.rejects(() => pair.save_voice({ ...voice, languageCode: 'en-GB' }), /available Cloud voice/);
  await pair.save_voice(voice);
  assert.deepEqual((await pair.list_devices())[0].store.cloud_voice, voice);
  assert.equal(Buffer.from(await pair.preview_voice({ voice, text: 'Hallo' }), 'base64').toString(), 'preview');
  const repair = session();
  const store = new Map();
  driver.onRepair(repair, {
    getSetting: () => undefined,
    getStoreValue: key => store.get(key), setStoreValue: (key, value) => store.set(key, value),
    unsetStoreValue: key => store.delete(key)
  });
  assert.deepEqual(await repair.get_voice_config(), { voice: null });
  await repair.save_voice(voice);
  assert.deepEqual(await repair.get_voice_config(), { voice });
  await repair.save_voice(null);
  assert.deepEqual(await repair.get_voice_config(), { voice: null });
});

test('Translate Cloud speech resolves voices for the selected target only', async () => {
  const voice = { name: 'nl-NL-Test-A', languageCode: 'nl-NL', ssmlGender: 'FEMALE' };
  const { validateTranslationSpeech, resolveTranslationVoice } = compile('../lib/speech-voices', {
    './tts-server': {
      getVoices: async () => [{ ...voice, languageCodes: ['nl-NL'] }],
      applicationVoice: () => ({ name: 'en-GB-App', languageCode: 'en-GB' })
    }
  }).exports;
  const config = await validateTranslationSpeech({ enabled: true, voices: [{ target: 'nl', voice }] });
  assert.deepEqual(await resolveTranslationVoice(config, 'nl'), voice);
  assert.deepEqual(await resolveTranslationVoice(config, 'nl-NL'), voice);
  await assert.rejects(resolveTranslationVoice(config, 'nl-BE'), /no voice for nl-BE/);
  assert.deepEqual(await resolveTranslationVoice(config, 'en'), { name: 'en-GB-App', languageCode: 'en-GB' });
  await assert.rejects(resolveTranslationVoice(config, 'fr'), /no voice for fr/);
  await assert.rejects(validateTranslationSpeech({ enabled: true, voices: [{ target: 'fr', voice }] }), /for this language/);
});