'use strict';

const TtsServer = require('./tts-server');
const { parseRoute, computeRoute, autocompletePlaces, fetchMap, request } = require('./maps');

const cloudOptions = { timeout: 8000, retry: null };
const sample = 'Hello';
const checks = new Map([
  ['tts', { keys: ['CloudJSON'], async run(homey) {
    if (!TtsServer.client) return false;
    const [result] = await TtsServer.callClient('synthesizeSpeech', {
      input: { text: sample }, voice: { languageCode: 'en-US', name: 'en-US-Standard-C' },
      audioConfig: { audioEncoding: 'MP3' }
    }, cloudOptions);
    if (!result?.audioContent?.length) throw new Error('Empty sample audio');
    return true;
  } }],
  ['translate', { keys: ['CloudJSON', 'CloudProject'], async run(homey, json, project) {
    const driver = homey.drivers.getDriver('translate');
    if (!driver.translateClient) return false;
    const [result] = await driver.callClient('translateText', {
      parent: `projects/${project}/locations/global`,
      contents: [sample], sourceLanguageCode: 'en', targetLanguageCode: 'nl'
    }, cloudOptions);
    if (!result?.translations?.[0]?.translatedText) throw new Error('Empty sample translation');
    return true;
  } }],
  ['youtube', { keys: ['CloudApiKey'], async run(homey, key) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({ key, part: 'id,snippet', type: 'video', q: 'Google', maxResults: '1' });
    const response = await request(url.href, { size: 64 * 1024 }, 'YouTube Data API');
    if (!Array.isArray((await response.json()).items)) throw new Error('Invalid sample search response');
    return true;
  } }],
  ['routes', { keys: ['MapsApiKey'], async run(homey, key) {
    await computeRoute(key, parseRoute('52.378,4.900', '52.373,4.893', 'WALK'));
    return true;
  } }],
  ['places', { keys: ['MapsApiKey'], async run(homey, key) {
    await autocompletePlaces(key, 'Amsterdam', 'en');
    return true;
  } }],
  ['static-map', { keys: ['MapsApiKey'], async run(homey, key) {
    await fetchMap(key, { path: '_p~iF~ps|U_ulLnnqC' });
    return true;
  } }]
]);

function failureCode(error) {
  const { googleError, httpStatus, code } = error || {};
  const detail = [
    typeof code === 'string' ? code : '', error?.details, error?.message,
    googleError?.status, googleError?.message,
    ...(Array.isArray(googleError?.details) ? googleError.details.map(item => item?.reason) : []),
    ...(Array.isArray(googleError?.errors) ? googleError.errors.map(item => item?.reason) : [])
  ].filter(value => typeof value === 'string').join(' ');
  if (/BILLING_DISABLED|billingNotEnabled|billing.*(?:disabled|not enabled|must be enabled)/i.test(detail)) return 'billing';
  if (/SERVICE_DISABLED|API_DISABLED|accessNotConfigured|(?:API|service).*(?:has not been used|is disabled|not enabled)/i.test(detail)) return 'disabled';
  if (/API_KEY_(?:INVALID|EXPIRED)|keyInvalid|invalid (?:API key|grant)|API key not valid|invalid_grant|invalid JWT/i.test(detail)
    || httpStatus === 401 || code === 16) return 'credentials';
  if (/QUOTA_EXCEEDED|RATE_LIMIT_EXCEEDED|quotaExceeded|rateLimitExceeded|dailyLimitExceeded|RESOURCE_EXHAUSTED/i.test(detail)
    || httpStatus === 429 || code === 8) return 'quota';
  if (httpStatus === 403 || code === 7) return 'access';
  if (httpStatus >= 500 || code === 4 || code === 14 || /could not be reached|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(detail)) return 'unreachable';
  return 'failed';
}

const activeChecks = new Set();
async function checkGoogleService(homey, service) {
  const check = checks.get(service);
  if (!check) return { status: 'failed' };
  if (activeChecks.has(service)) return { status: 'busy' };
  const values = check.keys.map(key => homey.settings.get(key));
  if (values.some(value => typeof value !== 'string' || !value.trim())) return { status: 'missing' };
  activeChecks.add(service);
  let timer;
  const probe = Promise.resolve().then(() => check.run(homey, ...values.map(value => value.trim())))
    .then(ok => ({ status: ok ? 'ok' : 'credentials' }), error => ({ status: failureCode(error) }))
    .finally(() => { clearTimeout(timer); activeChecks.delete(service); });
  return Promise.race([probe, new Promise(resolve => {
    timer = setTimeout(() => resolve({ status: 'unreachable' }), 12000);
  })]);
}

module.exports = { checkGoogleService };
