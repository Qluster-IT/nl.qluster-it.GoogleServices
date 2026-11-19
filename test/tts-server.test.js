'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const test = require('node:test');

function createServer() {
  const filename = require.resolve('../lib/tts-server');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  const parsed = [];
  m.require = id => {
    if (id === 'betterlogiclibrary') return { BL: { decode: async text => text } };
    if (id === 'music-metadata') return { parseBuffer: async buffer => {
      parsed.push(buffer);
      return { format: { duration: 1.5 } };
    } };
    return Module.prototype.require.call(m, id);
  };
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  const server = m.exports;
  const binary = Buffer.alloc(32, 1);
  const errors = [];
  let requests = 0;
  const timers = [];
  server.homey = {
    error: (...args) => errors.push(args),
    notifications: { createNotification: async () => {} },
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => { timer.active = false; }
  };
  server.client = { synthesizeSpeech: async () => { requests++; return [{ audioContent: binary }]; } };
  server.DefaultCloudVoice = { name: 'test', ssmlGender: 'NEUTRAL', languageCodes: ['en-GB'] };
  const device = { homey: { cloud: { getLocalAddress: async () => '127.0.0.1' } }, getSettings: () => ({ deviceprofile: 'test-profile' }) };
  const get = text => server.getUrl({ args: { text, device } });
  return { server, get, binary, parsed, errors, timers, requests: () => requests };
}

test('TTS cache retains only the 100 most recently used completed entries', async () => {
  const { server, get, requests } = createServer();
  const first = await get('text-0');
  for (let i = 1; i < 100; i++) await get(`text-${i}`);
  assert.equal(await get('text-0'), first);
  assert.equal(requests(), 100, 'same device profile should hit the cache');
  await get('text-100');
  assert.equal(server.Urls.length, 100);
  assert.ok(server.Urls.includes(first));
  assert.equal(server.Urls.some(url => url.text === 'text-1'), false);
  for (let i = 101; i < 130; i++) await get(`text-${i}`);
  assert.equal(server.Urls.length, 100);
});

test('TTS duration parsing reuses the audio buffer and failures do not poison the cache', async () => {
  const { server, get, binary, parsed, errors } = createServer();
  const result = await get('valid');
  assert.equal(result.binary, binary);
  assert.equal(parsed[0], binary);
  assert.equal(result.duration, 1500);
  const failure = new Error('synthetic synthesis failure');
  server.client.synthesizeSpeech = async () => { throw failure; };
  await assert.rejects(get('failure'), error => error === failure);
  assert.equal(server.Urls.length, 1);
  assert.ok(errors.length > 0);
  server.client.synthesizeSpeech = async () => [{ audioContent: binary }];
  assert.ok(await get('failure'));
  assert.equal(server.Urls.length, 2);
});

test('Cloud TTS uses an explicit Flow voice before the device and app defaults', async () => {
  const { server, binary } = createServer();
  const requests = [];
  server.client.synthesizeSpeech = async request => {
    requests.push(request);
    return [{ audioContent: binary }];
  };
  let stored = { name: 'nl-NL-Device', languageCode: 'nl-NL', ssmlGender: 'FEMALE' };
  const device = {
    homey: { cloud: { getLocalAddress: async () => '127.0.0.1' } },
    getSettings: () => ({}), getStoreValue: () => stored
  };
  const args = { text: 'Sample', device };
  await server.getUrl({ args });
  await server.getUrl({ args, voice: { id: 'fr-FR-Flow', languagecode: 'fr-FR', gender: 'NEUTRAL' } });
  stored = null;
  await server.getUrl({ args });
  assert.deepEqual(requests.map(({ voice }) => [voice.name, voice.languageCode]), [
    ['nl-NL-Device', 'nl-NL'], ['fr-FR-Flow', 'fr-FR'], ['test', 'en-GB']
  ]);
});

test('TTS entries are not exposed while synthesis is still pending', async () => {
  const { server, get, binary } = createServer();
  let complete;
  server.client.synthesizeSpeech = () => new Promise(resolve => { complete = resolve; });
  const pending = get('pending');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(server.Urls.length, 0);
  complete([{ audioContent: binary }]);
  assert.equal((await pending).binary, binary);
  assert.equal(server.Urls.length, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('replaced TTS clients close only after their in-flight requests finish', async () => {
  const { server, get, binary } = createServer();
  const closed = [];
  const pending = deferred();
  const old = { synthesizeSpeech: () => pending.promise, close: async () => { closed.push('old'); } };
  const idle = { synthesizeSpeech: async () => [{ audioContent: binary }], close: async () => { closed.push('idle'); } };
  const next = { synthesizeSpeech: async () => [{ audioContent: binary }], close: async () => { closed.push('next'); } };
  server.client = old;
  const running = get('in flight');
  await new Promise(resolve => setImmediate(resolve));

  server.setClient(old);
  server.setClient(next);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(closed, [], 'an in-flight request must not lose its client');
  assert.ok(await get('new client'));

  pending.resolve([{ audioContent: binary }]);
  assert.ok(await running);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(closed, ['old']);

  server.setClient(idle);
  server.setClient(next);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(closed, ['old', 'next', 'idle']);
  assert.equal(server.clientCalls.size, 0);
  assert.equal(server.retiredClients.size, 0);
});

test('Cloud voices are sorted by name and a missing list gives no voices', async () => {
  const { server } = createServer();
  const voices = [{ name: 'nl-NL-B' }, { name: 'en-GB-A', n: 1 }, { name: 'de-DE-A' }, { name: 'en-GB-A', n: 2 }];
  server.client = { listVoices: async () => [{ voices }] };
  assert.deepEqual((await server.getVoices()).map(v => v.n || v.name), ['de-DE-A', 1, 2, 'nl-NL-B']);
  server.client = { listVoices: async () => [{}] };
  assert.deepEqual(await server.getVoices(), []);
});

test('the voice list is asked from Google once while typing, again with new credentials, and released after 10 minutes', async () => {
  const { server, timers } = createServer();
  let requests = 0;
  const client = () => ({ listVoices: async () => { requests++; return [{ voices: [{ name: 'b' }, { name: 'a' }] }]; }, close: async () => {} });
  server.client = null;
  server.setClient(client());
  await Promise.all([server.getVoices(), server.getVoices()]);
  (await server.getVoices()).pop();
  assert.deepEqual((await server.getVoices()).map(voice => voice.name), ['a', 'b'], 'a caller cannot change the kept list');
  assert.equal(requests, 1);

  server.setClient(server.client);
  assert.equal(timers[0].active, true, 'unchanged credentials keep the existing cache timer');
  server.setClient(client());
  assert.equal(server.voicesCache, null, 'the old list is released with the old credentials');
  assert.equal(timers[0].active, false, 'the old timeout must not retain its client and voice list');
  await server.getVoices();
  assert.equal(requests, 2);

  const timer = timers[timers.length - 1];
  assert.equal(timer.ms, 10 * 60 * 1000);
  timer.fn();
  assert.equal(server.voicesCache, null);
  await server.getVoices();
  assert.equal(requests, 3);
  timers[0].fn();
  assert.ok(server.voicesCache, 'an expired timer of older credentials leaves the current list alone');
});

test('a voice list that Google could not deliver is asked again on the next call', async () => {
  const { server, timers } = createServer();
  let requests = 0;
  server.client = { listVoices: async () => { if (++requests === 1) throw new Error('unavailable'); return [{ voices: [{ name: 'a' }] }]; } };
  await assert.rejects(server.getVoices(), /unavailable/);
  assert.equal(timers.filter(timer => timer.active).length, 0, 'a failed request leaves no cache timer');
  assert.deepEqual((await server.getVoices()).map(voice => voice.name), ['a']);
  assert.equal(requests, 2);
});

test('an old pending voice request cannot invalidate the new cache, and closing releases its timer', async () => {
  const { server, timers } = createServer();
  let fail;
  let closed = false;
  server.client = {
    listVoices: () => new Promise((resolve, reject) => { fail = reject; }),
    close: async () => { closed = true; }
  };
  const pending = server.getVoices();
  const rejected = assert.rejects(pending, /old request failed/);
  server.setClient({ listVoices: async () => [{ voices: [{ name: 'new' }] }] });
  await server.getVoices();
  const cache = server.voicesCache;
  assert.equal(timers[0].active, false);
  assert.equal(closed, false, 'client remains available until its pending request settles');
  fail(new Error('old request failed'));
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, true);
  assert.equal(server.voicesCache, cache);
  assert.equal(timers.filter(timer => timer.active).length, 1);
  server.close();
  assert.equal(server.voicesCache, null);
  assert.equal(timers.filter(timer => timer.active).length, 0);
});

test('requests with a foreign host header get one reply instead of a second write', async () => {
  const filename = require.resolve('../lib/tts-server');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  let handler;
  m.require = id => {
    if (id === 'http') return { createServer: h => { handler = h; return { on() { return this; }, listen() { return this; } }; } };
    if (id === 'betterlogiclibrary') return { BL: {} };
    if (id === 'music-metadata') return {};
    return Module.prototype.require.call(m, id);
  };
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  const server = m.exports;
  server.init({ client: null, homey: {} });
  server.ip = '127.0.0.1';
  server.Urls = [{ id: 'abc', binary: Buffer.alloc(4), audioConfig: { audioEncoding: 'MP3' } }];
  let heads = 0;
  const res = { writeHead() { if (heads++) throw new Error('ERR_HTTP_HEADERS_SENT'); }, write() {}, end() {} };
  handler({ headers: { host: 'other:47333' }, url: '/tts/abc.mp3' }, res);
  assert.equal(heads, 1);

  const reply = url => {
    const out = { body: [] };
    handler({ headers: { host: '127.0.0.1:47333' }, url }, {
      writeHead: (status, headers) => { out.status = status; out.headers = headers; },
      write: chunk => out.body.push(chunk),
      end: chunk => { if (chunk) out.body.push(chunk); }
    });
    return out;
  };
  const audio = reply('/tts/abc.mp3');
  assert.equal(audio.headers['content-type'], 'audio/mpeg');
  assert.equal(audio.body[0], server.Urls[0].binary);
  assert.equal(reply('/tts/unknown.mp3').body[0], JSON.stringify({ status: 'ok' }));
});

test('a busy TTS port is logged as a TTS server error instead of an uncaught exception', async () => {
  const { EventEmitter } = require('node:events');
  const filename = require.resolve('../lib/tts-server');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  m.require = id => {
    if (id === 'http') return { createServer: () => {
      const server = new EventEmitter();
      server.listen = () => {
        process.nextTick(() => server.emit('error', Object.assign(new Error('listen EADDRINUSE: :::47333'), { code: 'EADDRINUSE' })));
        return server;
      };
      return server;
    } };
    if (id === 'betterlogiclibrary') return { BL: {} };
    return Module.prototype.require.call(m, id);
  };
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  const errors = [];
  m.exports.init({ client: null, homey: { error: (...args) => errors.push(args) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].code, 'EADDRINUSE');
});