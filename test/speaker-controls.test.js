'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { XMLParser } = require('fast-xml-parser');

const announcement = { url: 'http://homey.invalid/tts/test.mp3', type: 'audio/mpeg', duration: 0 };
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function load(fetch, cast) {
  const filename = require.resolve('../lib/speaker-controls');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  m.require = id => id === 'node-fetch' ? fetch : id === 'castv2-client' ? cast : Module.prototype.require.call(m, id);
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  return m.exports.SpeakerControls;
}

function fixture({ count = 2, failJoin, unsupportedVolume = false, changeVolume = false, changeSource = false } = {}) {
  const calls = [], reports = [];
  const rooms = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
  const states = Object.fromEntries(rooms.map(id => [id, {
    uri: `x-rincon-queue:${id}#0`, state: 'PLAYING', volume: 12, coordinator: id
  }]));
  const speakers = rooms.map(id => ({
    id: `dlna:uuid:${id}`, name: id, protocol: 'sonos', endpoint: `http://${id}/transport`,
    service: 'AVTransport', scpd: `http://${id}/transport-description`, topology: `http://${id}/topology`,
    rendering: { endpoint: `http://${id}/rendering`, service: 'RenderingControl', scpd: `http://${id}/rendering-description` }
  }));
  const response = (body, status = 200) => ({ ok: status === 200, status, text: async () => body });
  const result = (action, fields) => response(`<Envelope><Body><${action}Response>${Object.entries(fields)
    .map(([key, value]) => `<${key}>${escape(value)}</${key}>`).join('')}</${action}Response></Body></Envelope>`);
  const fetch = async (address, options) => {
    const url = new URL(address), id = url.hostname.toUpperCase(), state = states[id];
    if (!options?.method) {
      const actions = url.pathname.includes('rendering') ? ['GetVolume', 'SetVolume'] :
        ['GetMediaInfo', 'GetTransportInfo', 'GetPositionInfo', 'SetAVTransportURI', 'Play', 'Seek', 'BecomeCoordinatorOfStandaloneGroup'];
      return response(`<scpd><actionList>${actions.map(name => `<action><name>${name}</name></action>`).join('')}</actionList>
        <serviceStateTable><stateVariable><name>Volume</name><allowedValueRange><minimum>0</minimum><maximum>60</maximum><step>2</step></allowedValueRange></stateVariable></serviceStateTable></scpd>`);
    }
    const action = /#([^"]+)/.exec(options.headers.SOAPAction)[1];
    const body = new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(options.body).Envelope.Body[action];
    calls.push([id, action, body]);
    if (action === 'GetZoneGroupState') {
      const groups = [...new Set(Object.values(states).map(room => room.coordinator))];
      return result(action, { ZoneGroupState: `<ZoneGroupState><ZoneGroups>${groups.map(coordinator =>
        `<ZoneGroup Coordinator="${coordinator}">${rooms.filter(room => states[room].coordinator === coordinator)
          .map(room => `<ZoneGroupMember UUID="${room}" Invisible="0"/>${room === 'A' ? '<ZoneGroupMember UUID="STEREO_HIDDEN" Invisible="1"/>' : ''}`).join('')}</ZoneGroup>`).join('')}</ZoneGroups></ZoneGroupState>` });
    }
    if (action === 'GetMediaInfo') return result(action, { CurrentURI: state.uri, CurrentURIMetaData: '<metadata/>' });
    if (action === 'GetTransportInfo') {
      if (state.uri === announcement.url) {
        if (changeSource) state.uri = 'http://user.invalid/new-source';
        if (changeVolume) state.volume = 44;
        return result(action, { CurrentTransportState: 'STOPPED' });
      }
      return result(action, { CurrentTransportState: state.state });
    }
    if (action === 'GetPositionInfo') return result(action, { Track: '3', RelTime: '0:01:23' });
    if (action === 'GetVolume') return result(action, { CurrentVolume: state.volume });
    if (action === 'SetVolume') {
      if (unsupportedVolume) return response('<Envelope><Body><Fault><detail><UPnPError><errorCode>401</errorCode></UPnPError></detail></Fault></Body></Envelope>', 500);
      state.volume = Number(body.DesiredVolume);
    }
    if (action === 'SetAVTransportURI') {
      if (body.CurrentURI.startsWith('x-rincon:')) {
        if (id === failJoin) throw new Error('network failure while joining');
        state.coordinator = body.CurrentURI.slice('x-rincon:'.length);
      } else {
        state.uri = body.CurrentURI;
        state.state = 'STOPPED';
      }
    }
    if (action === 'BecomeCoordinatorOfStandaloneGroup') { state.coordinator = id; state.uri = ''; }
    if (action === 'Play') state.state = 'PLAYING';
    return result(action, {});
  };
  const Controls = load(fetch);
  const controls = new Controls(async (speaker, media) => {
    calls.push([speaker.name, 'announcement']);
    states[speaker.name].uri = media.url;
  }, error => reports.push(error));
  return { controls, states, speakers, calls, reports, fetch };
}

async function finish(t, controls) {
  t.mock.timers.tick(1000);
  await controls.tail;
}

test('temporary Sonos grouping restores sources, queue positions, groups and scaled volume without touching bonded members', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers, calls, reports } = fixture();
  await controls.start(speakers, announcement, { group: true, resume: true, volume: 50 });
  assert.equal(states.B.coordinator, 'A');
  assert.equal(states.A.volume, 30);
  assert.equal(states.B.volume, 30);
  assert.deepEqual(calls.filter(call => call[1] === 'announcement').map(call => call[0]), ['A']);
  await finish(t, controls);
  for (const id of ['A', 'B']) {
    assert.deepEqual(states[id], { uri: `x-rincon-queue:${id}#0`, state: 'PLAYING', volume: 12, coordinator: id });
    assert.deepEqual(calls.filter(call => call[0] === id && call[1] === 'Seek').map(call => [call[2].Unit, call[2].Target]),
      [['TRACK_NR', '3'], ['REL_TIME', '0:01:23']]);
  }
  assert.equal(calls.some(call => call[0] === 'STEREO_HIDDEN'), false);
  assert.deepEqual(reports, []);
});

test('a failed Sonos join rolls back previous joins even with resume off and still attempts unaffected rooms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers, calls, reports } = fixture({ count: 3, failJoin: 'C' });
  await assert.rejects(controls.start(speakers, announcement, { group: true, resume: false }), /C: network failure while joining/);
  assert.equal(states.B.coordinator, 'B');
  assert.ok(calls.some(call => call[0] === 'B' && call[1] === 'Play'), 'rollback resumed B before fallback playback');
  assert.deepEqual(calls.filter(call => call[1] === 'announcement').map(call => call[0]), ['A', 'B']);
  await finish(t, controls);
  assert.deepEqual(reports, [], 'start errors are not reported twice');
});

test('UPnP volume zero is preserved, omitted volume is untouched, and changed user volume or sources are not overwritten', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const options of [{ resume: true, volume: 0 }, { resume: true }, { resume: true, volume: 50 }]) {
    const changed = options.volume === 50;
    const { controls, states, speakers, calls } = fixture({ count: 1, changeVolume: changed, changeSource: changed });
    await controls.start(speakers, announcement, options);
    assert.equal(states.A.volume, options.volume === undefined ? 12 : options.volume * .6);
    await finish(t, controls);
    assert.equal(states.A.volume, changed ? 44 : 12);
    assert.equal(states.A.uri, changed ? 'http://user.invalid/new-source' : 'x-rincon-queue:A#0');
    if (options.volume === undefined) assert.equal(calls.some(call => call[1] === 'SetVolume'), false);
  }
});

test('advertised but unsupported volume falls back quietly; actual communication errors reject playback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture1 = fixture({ count: 1, unsupportedVolume: true });
  await fixture1.controls.start(fixture1.speakers, announcement, { volume: 25 });
  await finish(t, fixture1.controls);
  assert.equal(fixture1.states.A.volume, 12);
  assert.deepEqual(fixture1.reports, []);
  const Controls = load(async () => { throw new Error('network unavailable'); });
  let played = false;
  const reports = [];
  const controls = new Controls(async () => { played = true; }, error => reports.push(error));
  await assert.rejects(controls.start(fixture1.speakers, announcement, { resume: true }), /network unavailable/);
  await controls.tail;
  assert.equal(played, false);
  assert.deepEqual(reports, []);
});

test('later unmanaged playback waits for previous managed restoration and invalid lifetimes fail before playback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, calls, states } = fixture({ count: 1 });
  await assert.rejects(controls.start([], announcement, { resume: true }), /No speakers/);
  await assert.rejects(controls.start(speakers, { ...announcement, duration: NaN }, { resume: true }), /duration/);
  await controls.start(speakers, announcement, { resume: true });
  const next = controls.start(speakers, { ...announcement, url: 'http://next.invalid/audio' }, {});
  assert.equal(calls.filter(call => call[1] === 'announcement').length, 1);
  await finish(t, controls);
  await next;
  assert.equal(states.A.uri, 'http://next.invalid/audio');
});

test('Cast restores Default Media Receiver media and physical volume, but keeps user changes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const userChanged of [false, true]) {
    const loads = [], reports = [];
    let level = .2, closed = false, announced = false;
    const original = { media: { contentId: 'previous', contentType: 'audio/mpeg' }, currentTime: 23, playerState: 'PLAYING' };
    const player = {
      getStatus(callback) {
        callback(null, announced ? { media: { contentId: userChanged ? 'user-choice' : announcement.url }, playerState: 'IDLE' } : original);
      },
      load(media, options, callback) { loads.push([media, options]); announced = true; callback(null); }
    };
    class Client extends EventEmitter {
      connect(_, callback) { callback(); }
      getStatus(callback) { callback(null, { volume: { level }, applications: [{ appId: 'default' }] }); }
      join(_, receiver, callback) { callback(null, player); }
      setVolume(volume, callback) { level = volume.level; callback(); }
      getVolume(callback) { callback(null, { level: userChanged ? .7 : level }); }
      close() { closed = true; }
    }
    const Controls = load(null, { Client, DefaultMediaReceiver: { APP_ID: 'default' } });
    const controls = new Controls(null, error => reports.push(error));
    await controls.start([{ protocol: 'cast', name: 'Cast', host: '127.0.0.1' }], announcement, { resume: true, volume: 0 });
    assert.equal(level, 0);
    await finish(t, controls);
    assert.equal(loads.length, userChanged ? 1 : 2);
    if (!userChanged) {
      assert.deepEqual(loads[1], [original.media, { autoplay: true, currentTime: 23 }]);
      assert.equal(level, .2);
    }
    assert.equal(closed, true);
    assert.deepEqual(reports, []);
  }
});
