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
  server.homey = { error: (...args) => errors.push(args), notifications: { createNotification: async () => {} } };
  server.client = { synthesizeSpeech: async () => { requests++; return [{ audioContent: binary }]; } };
  server.DefaultCloudVoice = { name: 'test', ssmlGender: 'NEUTRAL', languageCodes: ['en-GB'] };
  const device = { homey: { cloud: { getLocalAddress: async () => '127.0.0.1' } }, getSettings: () => ({ deviceprofile: 'test-profile' }) };
  const get = text => server.getUrl({ args: { text, device } });
  return { server, get, binary, parsed, errors, requests: () => requests };
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
