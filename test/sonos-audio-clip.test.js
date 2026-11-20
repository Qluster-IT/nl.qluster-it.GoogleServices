'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const playClip = require('../lib/sonos-audio-clip');
const { resolveSonosMode } = require('../lib/speaker-announcements');
const { SpeakerControls } = require('../lib/speaker-controls');

const speaker = { id: 'dlna:uuid:rincon_00112233445501400', host: '192.168.1.10', protocol: 'sonos', name: 'Kitchen' };
const media = { url: 'http://192.168.1.2/clip.mp3', duration: 500 };

test('Flow mode overrides device mode and device mode overrides app mode', () => {
  assert.equal(resolveSonosMode('selected', 'sync', 'sync'), 'selected');
  assert.equal(resolveSonosMode('default', 'sync', 'selected'), 'sync');
  assert.equal(resolveSonosMode(undefined, 'default', 'selected'), 'selected');
  assert.equal(resolveSonosMode(undefined, undefined, undefined), 'default');
});

test('AudioClip sends room-specific volume zero and finishes only for its own clip', async () => {
  const socket = new EventEmitter();
  const commands = [];
  socket.send = (text, callback) => { commands.push(JSON.parse(text)); callback(); };
  socket.terminate = () => { socket.closed = true; };
  let active = 0;
  const done = playClip(speaker, media, 0, () => { active++; }, () => socket);
  const reply = (header, body) => socket.emit('message', JSON.stringify([header, body]));
  const status = (id, value) => reply({ type: 'audioClipStatus' }, { audioClips: [{ id, status: value }] });
  socket.emit('open');
  reply({ response: 'subscribe', cmdId: '1', success: true }, {});
  assert.equal(commands[1][0].playerId, 'RINCON_00112233445501400');
  assert.equal(commands[1][1].volume, 0);
  status('other', 'DONE');
  status('mine', 'ACTIVE');
  reply({ response: 'loadAudioClip', cmdId: '2', success: true }, { id: 'mine' });
  assert.equal(active, 1);
  assert.equal(socket.closed, undefined);
  status('mine', 'DONE');
  await done;
  assert.equal(socket.closed, true);
});

test('unsupported selected Sonos rooms fail without falling back to transport playback', async () => {
  let played = false;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const controls = new SpeakerControls(() => { played = true; }, assert.fail, () => {}, async () => {
    throw new Error('AudioClip rejected');
  });
  await assert.rejects(controls.start([speaker], media, { sonosClip: true, finished: finish }), /Kitchen.*rejected/);
  assert.match((await done).message, /Kitchen.*rejected/);
  assert.equal(played, false);
});
