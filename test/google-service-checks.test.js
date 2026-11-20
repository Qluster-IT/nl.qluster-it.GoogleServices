'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const TtsServer = require('../lib/tts-server');
const { checkGoogleService } = require('../lib/google-service-checks');

test('checks use saved credentials, do not log raw provider errors, and distinguish failure causes', async () => {
  const homey = { settings: { get: key => key === 'CloudJSON' ? '{"example":true}' : undefined } };
  assert.deepEqual(await checkGoogleService(homey, 'translate'), { status: 'missing' });
  assert.deepEqual(await checkGoogleService(homey, 'unknown'), { status: 'failed' });
  const previous = TtsServer.client;
  try {
    TtsServer.client = {
      async synthesizeSpeech(request, options) {
        assert.equal(request.input.text, 'Hello');
        assert.equal(options.timeout, 8000);
        return [{ audioContent: Buffer.from([1]) }];
      }
    };
    assert.deepEqual(await checkGoogleService(homey, 'tts'), { status: 'ok' });
    for (const [status, code, details] of [
      ['disabled', 7, 'SERVICE_DISABLED'],
      ['billing', 7, 'BILLING_DISABLED'],
      ['credentials', 16, 'synthetic-sensitive-detail'],
      ['quota', 8, 'synthetic-sensitive-detail'],
      ['access', 7, 'synthetic-sensitive-detail'],
    ]) {
      TtsServer.client.synthesizeSpeech = async () => { throw Object.assign(new Error(details), { code }); };
      assert.deepEqual(await checkGoogleService(homey, 'tts'), { status });
    }
  } finally {
    TtsServer.client = previous;
  }
});
