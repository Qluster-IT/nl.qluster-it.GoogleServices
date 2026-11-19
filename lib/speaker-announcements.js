'use strict';

const SpeakerPlayback = require('./speaker-playback');
const googleTTS = require('google-tts-api');
const fetch = require('node-fetch');
const TtsServer = require('./tts-server');

const playback = new WeakMap();

function registerAnnouncement(homey, id, makeMedia, triggerWhenCards) {
  let speakers = playback.get(homey);
  if (!speakers) {
    speakers = new SpeakerPlayback((...args) => homey.app?.error(...args),
      typeof homey.__ === 'function' ? key => homey.__(`speech.speaker_${key}`) : undefined);
    playback.set(homey, speakers);
  }
  const card = homey.flow.getActionCard(id);
  card.getArgument('speaker').registerAutocompleteListener(query => speakers.autocomplete(query));
  card.registerRunListener(async args => {
    if (typeof args.text !== 'string' || !args.text.trim()) throw new Error('Enter text to announce.');
    const speaker = await speakers.select(args.speaker);
    const media = await makeMedia(args);
    await speakers.play(speaker, media);
    if (triggerWhenCards && args.device.getSetting('trigger_when_announcing') === true) {
      await triggerWhenCards(args.device, media);
    }
    return true;
  });
  return card;
}

async function basicSpeech(homey, text, lang) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter text to announce.');
  if (text.length > 200) throw new Error('Google TTS announcements support up to 200 characters.');
  const source = googleTTS.getAudioUrl(text, { lang });
  let audio;
  try {
    const response = await fetch(source, { timeout: 5000, redirect: 'error', size: 512 * 1024 });
    if (!response.ok || !/^audio\/mpeg\b/i.test(response.headers.get('content-type') || '')) {
      response.body?.destroy();
      throw new Error('Unexpected speech response.');
    }
    audio = await response.buffer();
  } catch {
    // Transport errors can include the Google URL with the announcement text.
    throw new Error('Google TTS could not generate audio for this text and language.');
  }
  return { url: await TtsServer.hostMp3(homey, audio), type: 'audio/mpeg' };
}

module.exports = { registerAnnouncement, basicSpeech };
