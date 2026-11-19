'use strict';

const TtsServer = require('./tts-server');

const deviceVoiceKey = 'cloud_voice';
const translationSpeechKey = 'translation_speech';

function languageKey(language) {
  return typeof language === 'string' ? language.toLowerCase() : '';
}

function matchesLanguage(locale, target) {
  const code = languageKey(locale);
  const requested = languageKey(target);
  return Boolean(requested && (code === requested || (!requested.includes('-') && code.startsWith(`${requested}-`))));
}

async function listVoices() {
  return (await TtsServer.getVoices()).flatMap(voice => (voice.languageCodes || []).map(languageCode => ({
    name: voice.name, languageCode, ssmlGender: voice.ssmlGender
  })));
}

function sameVoice(a, b) {
  return a?.name === b?.name && languageKey(a?.languageCode) === languageKey(b?.languageCode);
}

function requireVoice(voices, selection, target) {
  const voice = voices.find(voice => sameVoice(voice, selection));
  if (!voice || (target && !matchesLanguage(voice.languageCode, target))) {
    throw new Error('Choose an available Cloud voice for this language.');
  }
  return voice;
}

async function validateVoice(selection) {
  return selection === null ? null : requireVoice(await listVoices(), selection);
}

async function previewVoice({ voice, target, text } = {}) {
  if (typeof text !== 'string' || text.length > 200) throw new Error('Enter up to 200 characters to preview.');
  const selected = voice === null
    ? (target ? await resolveTranslationVoice({}, target) : TtsServer.applicationVoice())
    : requireVoice(await listVoices(), voice, target);
  const audio = await TtsServer.getResponse({
    text: text.trim() || '1, 2, 3.', voice: selected, audioConfig: { audioEncoding: 'MP3' }, plainText: true
  });
  return audio.toString('base64');
}

async function validateTranslationSpeech({ enabled, voices } = {}) {
  if (typeof enabled !== 'boolean' || !Array.isArray(voices) || voices.length > 100) {
    throw new Error('Invalid announcement voice settings.');
  }
  const catalog = voices.length ? await listVoices() : [];
  const used = new Set();
  return { enabled, voices: voices.map(({ target, voice }) => {
    const key = languageKey(target);
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(key) || used.has(key)) {
      throw new Error('Choose a valid, distinct language for each voice preference.');
    }
    used.add(key);
    return { target: key, voice: requireVoice(catalog, voice, key) };
  }) };
}

async function resolveTranslationVoice(config, target) {
  const key = languageKey(target);
  const requested = config.voices?.find(item => item.target === key)?.voice;
  if (requested && matchesLanguage(requested.languageCode, key)) return requested;
  const fallback = TtsServer.applicationVoice();
  if (matchesLanguage(fallback.languageCode, key)) return fallback;
  const voices = await listVoices();
  const match = voices.filter(voice => matchesLanguage(voice.languageCode, key));
  // Use Google's default voice for the selected locale when no voice was configured.
  const languageCode = match.find(voice => languageKey(voice.languageCode) === key)?.languageCode || match[0]?.languageCode;
  if (!languageCode) throw new Error(`Cloud Text-to-Speech has no voice for ${target}.`);
  return { languageCode };
}

function registerVoicePicker(session) {
  session.setHandler('list_voices', listVoices);
  session.setHandler('preview_voice', previewVoice);
}

module.exports = {
  deviceVoiceKey, translationSpeechKey, registerVoicePicker,
  validateVoice, validateTranslationSpeech, resolveTranslationVoice
};
