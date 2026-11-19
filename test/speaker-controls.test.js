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

function fixture({ count = 2, failJoin, unsupportedVolume = false, changeVolume = false, changeSource = false,
  bondLag = 0, resetCoordinatorOnJoin = false, nestedBond = false, startupStates = [], failAnnouncementAt = 0,
  failDetach, returnToInput = false, detachOnInput, staleDetachObserver = false, omitFollower = false,
  loseJoinReply = false, missingBondAfterDetach = false, resumeTransitions = 0 } = {}) {
  const calls = [], reports = [];
  let announcements = 0;
  let staleDetachReads = 1;
  let pendingResume = 0;
  const positions = {};
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
      const staleDetach = staleDetachObserver && id === 'A' &&
        calls.some(([target, command]) => target === 'B' && command === 'BecomeCoordinatorOfStandaloneGroup') &&
        staleDetachReads-- > 0;
      const coordinatorFor = room => staleDetach && room === 'B' ? 'A' : states[room].coordinator;
      const groups = [...new Set(rooms.map(coordinatorFor))];
      const hideBond = (states.A.coordinator !== 'A' && bondLag-- > 0) ||
        (missingBondAfterDetach && calls.some(([, command]) => command === 'BecomeCoordinatorOfStandaloneGroup'));
      return result(action, { ZoneGroupState: `<ZoneGroupState><ZoneGroups>${groups.map(coordinator =>
        `<ZoneGroup Coordinator="${coordinator}">${rooms.filter(room => coordinatorFor(room) === coordinator &&
          !(omitFollower && id === 'A' && room === 'B'))
          .map(room => {
            const bond = room === 'A' && !hideBond ? (nestedBond
              ? '<Satellite UUID="STEREO_HIDDEN"/>' : '<ZoneGroupMember UUID="STEREO_HIDDEN" Invisible="1"/>') : '';
            const attrs = `UUID="${room}" Invisible="0"${room === 'A' ? ' ChannelMapSet="A:LF;STEREO_HIDDEN:RF"' : ''}`;
            return nestedBond ? `<ZoneGroupMember ${attrs}>${bond}</ZoneGroupMember>` : `<ZoneGroupMember ${attrs}/>${bond}`;
          }).join('')}</ZoneGroup>`).join('')}</ZoneGroups></ZoneGroupState>` });
    }
    if (action === 'GetMediaInfo') return result(action, { CurrentURI: state.uri, CurrentURIMetaData: '<metadata/>' });
    if (action === 'GetTransportInfo') {
      if (id === 'B' && state.state === 'TRANSITIONING' && pendingResume > 0) {
        if (--pendingResume === 0) state.state = 'PLAYING';
      }
      if (state.uri.startsWith('http://homey.invalid/tts/')) {
        if (changeSource) state.uri = 'http://user.invalid/new-source';
        if (returnToInput) state.uri = `x-sonos-htastream:${id}:spdif`;
        if (changeVolume) state.volume = 44;
        return result(action, { CurrentTransportState: startupStates.shift() || 'STOPPED' });
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
        if (id === failJoin && !loseJoinReply) throw new Error('network failure while joining');
        state.coordinator = body.CurrentURI.slice('x-rincon:'.length);
        if (id === failJoin) {
          state.uri = body.CurrentURI;
          throw new Error('network failure while joining');
        }
        if (resetCoordinatorOnJoin) positions[state.coordinator] = '0:00:00';
      } else {
        state.uri = body.CurrentURI;
        state.state = 'STOPPED';
        if (id === detachOnInput && state.uri.startsWith('x-sonos-htastream:')) state.coordinator = id;
      }
    }
    if (action === 'BecomeCoordinatorOfStandaloneGroup') {
      if (id === failDetach) throw new Error('network failure while leaving');
      if (id !== detachOnInput) state.coordinator = id;
      state.uri = '';
    }
    if (action === 'Seek' && body.Unit === 'REL_TIME') positions[id] = body.Target;
    if (action === 'Play') {
      pendingResume = id === 'B' ? resumeTransitions : 0;
      state.state = pendingResume ? 'TRANSITIONING' : 'PLAYING';
    }
    if (action === 'Pause') state.state = 'PAUSED_PLAYBACK';
    return result(action, {});
  };
  const Controls = load(fetch);
  const controls = new Controls(async (speaker, media) => {
    calls.push([speaker.name, 'announcement']);
    if (++announcements === failAnnouncementAt) throw new Error('speaker failed to start');
    states[speaker.name].uri = media.url;
  }, error => reports.push(error));
  return { controls, states, speakers, calls, reports, fetch, positions };
}

async function finish(t, controls) {
  let finished = false;
  const completion = controls.tail.then(() => { finished = true; });
  for (let i = 0; i < 48 && !finished; i++) {
    t.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(finished, 'speaker cleanup finished');
  await completion;
}

test('TV speaker exclusions leave existing mixed Sonos groups alone even without grouping or resume', async () => {
  const { controls, states, speakers, calls } = fixture({ count: 3 });
  states.B.coordinator = 'A';
  const options = { group: false, resume: false, excludedSonos: [speakers[1]] };
  await controls.start([speakers[0], speakers[2]], announcement, options);
  await controls.tail;
  assert.deepEqual(calls.filter(([, action]) => action !== 'GetZoneGroupState'), [['C', 'announcement']]);
  assert.equal(states.B.coordinator, 'A');

  await assert.rejects(controls.start([speakers[0]], announcement, options), /No speakers are available outside/);
  assert.deepEqual(calls.filter(([, action]) => action !== 'GetZoneGroupState'), [['C', 'announcement']]);
});

test('saved groups leave mixed Sonos rooms alone, but allow a bonded stereo speaker', async () => {
  const { controls, states, speakers, calls } = fixture({ count: 3, nestedBond: true });
  states.C.coordinator = 'B';
  await controls.start(speakers.slice(0, 2), announcement, { restrictSonosToTargets: true });
  await controls.tail;
  assert.deepEqual(calls.filter(([, action]) => action !== 'GetZoneGroupState'), [['A', 'announcement']]);
  assert.equal(states.C.coordinator, 'B');
});

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

test('pre-existing Sonos groups return without automatically playing previously paused audio', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers, calls, reports } = fixture({ count: 3 });
  states.B.coordinator = 'A';
  states.A.state = 'PAUSED_PLAYBACK';
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(states.B.coordinator, 'A');
  assert.equal(states.C.coordinator, 'C');
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
  assert.equal(calls.some(call => call[0] === 'A' && call[1] === 'Play'), false);
  assert.equal(states.C.state, 'PLAYING');
  assert.deepEqual(reports, []);
});

test('a bonded room waits until both channels appear in the new group before announcement playback', async () => {
  const { controls, speakers, calls, reports } = fixture({ bondLag: 1 });
  await controls.start([speakers[1], speakers[0]], announcement, { group: true, resume: true });
  const playbackIndex = calls.findIndex(call => call[1] === 'announcement');
  const joins = calls.findIndex(call => call[0] === 'A' && call[1] === 'SetAVTransportURI');
  assert.ok(calls.slice(joins + 1, playbackIndex).filter(call => call[1] === 'GetZoneGroupState').length >= 2,
    'playback waits for the hidden stereo member to join');
  await controls.tail;
  assert.deepEqual(reports, []);
});

test('nested Sonos satellites count as bonded members when grouping', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, calls, reports } = fixture({ nestedBond: true });
  await controls.start([speakers[1], speakers[0]], announcement, { group: true, resume: true });
  assert.equal(calls.filter(call => call[1] === 'announcement').length, 1);
  await finish(t, controls);
  assert.deepEqual(reports, []);
});

test('a discovered stereo coordinator leads the temporary group even if discovered last', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls } = fixture();
  speakers[0].stereo = { left: 'Roam SL', right: 'Roam SL' };
  await controls.start([speakers[1], speakers[0]], announcement, { group: true, resume: true });
  assert.equal(states.B.coordinator, 'A');
  assert.deepEqual(calls.filter(call => call[1] === 'announcement').map(call => call[0]), ['A']);
  await finish(t, controls);
  assert.equal(states.B.coordinator, 'B');
});

test('DLNA pause at the end of a clip does not split a queued playback session', async () => {
  const { controls, speakers, calls, reports } = fixture({ count: 1, startupStates: ['PLAYING', 'PAUSED_PLAYBACK'] });
  speakers[0].protocol = 'dlna';
  await controls.start(speakers, { ...announcement, duration: 2000 }, { resume: true });
  await controls.start(speakers, { ...announcement, url: 'http://homey.invalid/tts/second.mp3' }, { resume: true });
  assert.equal(calls.some(call => call[1] === 'SetAVTransportURI'), false);
  await controls.tail;
  assert.equal(calls.filter(call => call[1] === 'Play').length, 1);
  assert.deepEqual(reports, []);
});

test('queued announcements keep the original group and source until the final announcement completes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers, calls, reports } = fixture();
  await controls.start(speakers, announcement, { group: true, resume: true });
  const next = controls.start(speakers, { ...announcement, url: 'http://homey.invalid/tts/second.mp3' },
    { group: true, resume: true });
  assert.equal(calls.filter(call => call[1] === 'announcement').length, 1);
  t.mock.timers.tick(1000);
  await next;
  assert.equal(calls.filter(call => call[1] === 'announcement').length, 2);
  assert.equal(calls.some(call => call[1] === 'BecomeCoordinatorOfStandaloneGroup'), false);
  assert.equal(calls.some(call => call[1] === 'SetAVTransportURI' && call[2].CurrentURI === 'x-rincon-queue:A#0'), false);
  await finish(t, controls);
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
  assert.equal(states.B.uri, 'x-rincon-queue:B#0');
  assert.deepEqual(reports, []);
});

test('a failed queued announcement still restores the original Sonos sources and groups', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers, reports } = fixture({ failAnnouncementAt: 2 });
  await controls.start(speakers, announcement, { group: true, resume: true });
  const next = controls.start(speakers, { ...announcement, url: 'http://homey.invalid/tts/second.mp3' },
    { group: true, resume: true });
  t.mock.timers.tick(1000);
  await assert.rejects(next, /speaker failed to start/);
  await controls.tail;
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
  assert.equal(states.B.uri, 'x-rincon-queue:B#0');
  assert.equal(states.B.coordinator, 'B');
  assert.deepEqual(reports, []);
});

test('a queued announcement with different settings waits for the restored Sonos stream before taking a new snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers, calls, reports } = fixture({ resumeTransitions: 3 });
  const source = 'x-rincon-mp3radio://media.invalid/audio.mp3';
  states.B.uri = source;
  await controls.start(speakers, announcement, { group: true, resume: true });
  const next = controls.start(speakers, announcement, { group: true, resume: true, volume: 25 });
  t.mock.timers.tick(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.B.state, 'TRANSITIONING');
  assert.equal(calls.filter(([, action]) => action === 'announcement').length, 1);
  await finish(t, controls);
  await next;
  assert.equal(states.B.uri, source);
  assert.equal(states.B.state, 'PLAYING');
  assert.deepEqual(reports, []);
});

test('unverified Sonos restoration rejects queued announcements without playing them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, calls, reports } = fixture({ resumeTransitions: 100 });
  await controls.start(speakers, announcement, { group: true, resume: true });
  const rejected = assert.rejects(controls.start(speakers, announcement, { group: true, resume: true, volume: 25 }),
    /previous speaker playback could not be restored/);
  await finish(t, controls);
  await rejected;
  assert.equal(calls.filter(([, action]) => action === 'announcement').length, 1);
  assert.match(reports[0]?.message, /did not confirm that the original source resumed/);
});

test('an initially stopped speaker does not let the next announcement interrupt startup', async () => {
  const { controls, speakers, calls, reports } = fixture({ count: 1, startupStates: ['STOPPED', 'PLAYING', 'STOPPED'] });
  await controls.start(speakers, { ...announcement, duration: 1800 }, { resume: true });
  const next = controls.start(speakers, announcement, { resume: true });
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(calls.filter(call => call[1] === 'announcement').length, 1);
  await next;
  await controls.tail;
  assert.deepEqual(reports, []);
});

test('Sonos TV and line-in sources are restored without an unsupported seek', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const uri of ['x-sonos-htastream:A:spdif', 'x-rincon-stream:A']) {
    const { controls, speakers, states, calls, reports } = fixture();
    states.A.uri = uri;
    await controls.start(speakers, announcement, { group: true, resume: true });
    await finish(t, controls);
    assert.equal(states.A.uri, uri);
    assert.equal(states.A.state, 'PLAYING');
    assert.equal(calls.some(call => call[0] === 'A' && call[1] === 'Seek'), false);
    assert.deepEqual(reports, []);
  }
});

test('a Sonos MP3 radio source resumes after grouping without seeking its elapsed stream time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls, reports } = fixture();
  const source = 'x-rincon-mp3radio://media.invalid/audio.mp3';
  states.B.uri = source;
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(states.B.coordinator, 'B');
  assert.equal(states.B.uri, source);
  assert.equal(states.B.state, 'PLAYING');
  assert.ok(calls.some(([room, action]) => room === 'B' && action === 'Play'));
  assert.ok(!calls.some(([room, action]) => room === 'B' && action === 'Seek'));
  assert.deepEqual(reports, []);
});

test('Sonos removes temporary members even when its coordinator automatically returns to TV', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls, reports } = fixture({ returnToInput: true });
  states.A.uri = 'x-sonos-htastream:A:spdif';
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(states.B.coordinator, 'B');
  assert.equal(states.B.uri, 'x-rincon-queue:B#0');
  assert.equal(states.B.state, 'PLAYING');
  assert.equal(states.A.uri, 'x-sonos-htastream:A:spdif');
  assert.ok(!calls.some(([room, action]) => room === 'A' && action === 'SetAVTransportURI'));
  assert.deepEqual(reports, []);
});

test('a failed Sonos detach does not prevent other rooms from leaving and restoring playback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, reports } = fixture({ count: 3, failDetach: 'B' });
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(states.C.coordinator, 'C');
  assert.equal(states.C.uri, 'x-rincon-queue:C#0');
  assert.match(reports[0]?.message, /B: could not leave the temporary Sonos group/);
});

test('TV autoplay leaving the temporary group does not strand the other Sonos rooms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls, reports } = fixture({ count: 3 });
  states.B.uri = 'x-sonos-htastream:B:spdif';
  await controls.start(speakers, announcement, { group: true, resume: true });
  states.B.coordinator = 'B';
  await finish(t, controls);
  assert.equal(states.C.coordinator, 'C');
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
  assert.equal(states.B.uri, 'x-sonos-htastream:B:spdif');
  assert.ok(!calls.some(([room, action]) => room === 'B' && action === 'BecomeCoordinatorOfStandaloneGroup'));
  assert.deepEqual(reports, []);
});

test('a Sonos room already back in its original group does not strand other rooms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls, reports } = fixture({ count: 3 });
  await controls.start(speakers, announcement, { group: true, resume: true });
  Object.assign(states.B, { coordinator: 'B', uri: '', state: 'STOPPED' });
  await finish(t, controls);
  assert.equal(states.B.uri, 'x-rincon-queue:B#0');
  assert.equal(states.B.state, 'PLAYING');
  assert.equal(states.C.coordinator, 'C');
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
  assert.ok(!calls.some(([room, action]) => room === 'B' && action === 'BecomeCoordinatorOfStandaloneGroup'));
  assert.deepEqual(reports, []);
});

test('Sonos pauses the original coordinator before joining rooms, then resumes it after the announcement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls } = fixture();
  await controls.start(speakers, announcement, { group: true, resume: true });
  const pause = calls.findIndex(([room, action]) => room === 'A' && action === 'Pause');
  const join = calls.findIndex(([room, action, args]) => room === 'B' &&
    action === 'SetAVTransportURI' && args.CurrentURI === 'x-rincon:A');
  assert.ok(pause >= 0 && join > pause);
  assert.equal(states.A.state, 'PAUSED_PLAYBACK');
  await finish(t, controls);
  assert.equal(states.A.state, 'PLAYING');
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
});

test('a stale view from the temporary Sonos coordinator does not block restoration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, reports } = fixture({ staleDetachObserver: true });
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
  assert.equal(states.B.uri, 'x-rincon-queue:B#0');
  assert.deepEqual(reports, []);
});

test('Sonos does not resume music if the original bonded membership cannot be verified', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, calls, reports } = fixture({ missingBondAfterDetach: true });
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.ok(!calls.some(([room, command]) => room === 'A' && command === 'Play'));
  assert.match(reports[0]?.message, /original Sonos group could not be verified/);
});

test('inconsistent Sonos membership does not play an existing follower independently', async t => {
  const { controls, speakers, states, calls } = fixture({ omitFollower: true });
  Object.assign(states.B, { coordinator: 'A', uri: 'x-rincon:A' });
  await assert.rejects(controls.start(speakers, announcement, { group: true, resume: true }), /group includes a room/);
  await controls.tail;
  assert.ok(!calls.some(([room, action]) => room === 'B' && action === 'announcement'));
  assert.equal(states.B.coordinator, 'A');
});

test('TV input is restored when transport clears before the soundbar topology updates', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, reports } = fixture({ detachOnInput: 'B' });
  states.B.uri = 'x-sonos-htastream:B:spdif';
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(states.B.coordinator, 'B');
  assert.equal(states.B.uri, 'x-sonos-htastream:B:spdif');
  assert.equal(states.B.state, 'PLAYING');
  assert.deepEqual(reports, []);
});
test('original Sonos groups are rebuilt before restoring their queue position', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls, positions } = fixture({ count: 3, resetCoordinatorOnJoin: true });
  states.B.coordinator = 'A';
  await controls.start([speakers[2], speakers[0], speakers[1]], announcement, { group: true, resume: true });
  await finish(t, controls);
  const rejoin = calls.findLastIndex(call => call[0] === 'B' && call[1] === 'SetAVTransportURI' && call[2].CurrentURI === 'x-rincon:A');
  const seek = calls.findLastIndex(call => call[0] === 'A' && call[1] === 'Seek' && call[2].Unit === 'REL_TIME');
  assert.ok(rejoin >= 0 && seek > rejoin);
  assert.equal(positions.A, '0:01:23');
  assert.equal(states.B.coordinator, 'A');
});

test('an already grouped Sonos pair is not needlessly regrouped and resumes the original source', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, states, calls } = fixture();
  states.B.coordinator = 'A';
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(states.A.uri, 'x-rincon-queue:A#0');
  assert.equal(states.B.coordinator, 'A');
  assert.equal(calls.some(call => call[1] === 'BecomeCoordinatorOfStandaloneGroup'), false);
  assert.equal(calls.some(call => call[0] === 'B' && call[1] === 'SetAVTransportURI'), false);
});

test('user source or topology changes prevent stale Sonos regrouping', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const changeSource of [false, true]) {
    const { controls, states, speakers, calls, reports } = fixture({ count: 3, changeSource });
    await controls.start(speakers.slice(0, 2), announcement, { group: true, resume: true });
    if (!changeSource) states.C.coordinator = 'A';
    await finish(t, controls);
    assert.equal(calls.some(call => call[1] === 'BecomeCoordinatorOfStandaloneGroup'), false);
    if (changeSource) assert.equal(states.A.uri, 'http://user.invalid/new-source');
    else assert.equal(states.C.coordinator, 'A');
    assert.deepEqual(reports, []);
  }
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

test('a Sonos join that took effect before its reply was lost is rolled back', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers } = fixture({ failJoin: 'B', loseJoinReply: true });
  await assert.rejects(controls.start(speakers, announcement, { group: true, resume: false }), /network failure while joining/);
  assert.equal(states.B.coordinator, 'B');
  assert.equal(states.B.uri, 'x-rincon-queue:B#0');
  await finish(t, controls);
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

test('group members use individual offsets and caps, restore volume, and ignore both without a Flow volume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers, calls } = fixture({ count: 3 });
  Object.assign(speakers[0], { volumeOffset: 15 });
  Object.assign(speakers[1], { volumeOffset: 15, maxVolume: 35 });
  Object.assign(speakers[2], { volumeOffset: -30 });
  await controls.start(speakers, announcement, { group: true, resume: true, volume: 25 });
  // The renderer advertises a 0–60 range in steps of two; 22 would exceed the 35% cap.
  assert.deepEqual(Object.values(states).map(room => room.volume), [24, 20, 0]);
  await finish(t, controls);
  assert.deepEqual(Object.values(states).map(room => room.volume), [12, 12, 12]);
  calls.length = 0;
  await controls.start(speakers, announcement, { group: true, resume: true });
  await finish(t, controls);
  assert.equal(calls.some(([, action]) => action === 'SetVolume'), false);
});

test('queued announcements with different group volume adjustments use their own levels', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, states, speakers } = fixture({ count: 1 });
  const options = { resume: true, volume: 25 };
  await controls.start([{ ...speakers[0], volumeOffset: 15 }], announcement, options);
  assert.equal(states.A.volume, 24);
  const next = controls.start([{ ...speakers[0], volumeOffset: -5 }], announcement, options);
  t.mock.timers.tick(1000);
  await next;
  assert.equal(states.A.volume, 12);
  await finish(t, controls);
  assert.equal(states.A.volume, 12);
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

test('unmanaged announcements also wait for their audio before starting the next one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controls, speakers, calls } = fixture({ count: 1 });
  await controls.start(speakers, { ...announcement, duration: 2000 }, {});
  const next = controls.start(speakers, announcement, {});
  assert.equal(calls.filter(call => call[1] === 'announcement').length, 1);
  t.mock.timers.tick(2000);
  await next;
  assert.equal(calls.filter(call => call[1] === 'announcement').length, 2);
  t.mock.timers.tick(0);
  await controls.tail;
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
