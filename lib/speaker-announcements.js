'use strict';

const SpeakerPlayback = require('./speaker-playback');
const googleTTS = require('google-tts-api');
const fetch = require('node-fetch');
const TtsServer = require('./tts-server');
const { listGroups } = require('./speaker-groups');

const playback = new WeakMap();

function getPlayback(homey) {
  let speakers = playback.get(homey);
  if (!speakers) {
    speakers = new SpeakerPlayback((...args) => homey.app?.error(...args),
      typeof homey.__ === 'function' ? key => homey.__(`speech.speaker_${key}`) : undefined,
      error => {
        homey.app.error('Restoring an announcement failed', error);
        homey.notifications.createNotification({ excerpt: `Restoring speaker playback failed: ${error.message}` })
          .catch(notificationError => homey.app.error('Reporting speaker restoration failed', notificationError));
      }, () => listGroups(homey.settings));
    playback.set(homey, speakers);
  }
  return speakers;
}

const defaultSpeakerKey = 'announcement_speaker';

function validateVolume(volume) {
  if (volume !== undefined && (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100)) {
    throw new Error('Announcement volume must be between 0 and 100%.');
  }
}

async function selectSpeaker(homey, device, explicit) {
  const choice = explicit ?? device.getStoreValue?.(defaultSpeakerKey);
  return choice ? getPlayback(homey).select(choice) : null;
}

async function playAnnouncement(homey, device, speaker, media, triggerWhenCards, volume) {
  const options = {
    group: SpeakerPlayback.isSpeakerGroup(speaker.id) && (device.getSetting('announcement_group_sonos') ?? true) === true,
    resume: (device.getSetting('announcement_resume') ?? true) === true,
    delay: device.getSetting('delay') ?? 0,
    volume
  };
  validateVolume(volume);
  if (!Number.isFinite(media.duration) || media.duration < 0) media.duration = await TtsServer.hostedDuration(media.url);
  await getPlayback(homey).play(speaker, media, options);
  if (triggerWhenCards && device.getSetting('trigger_when_announcing') === true) {
    await triggerWhenCards(device, media);
  }
}

function registerAnnouncement(homey, id, makeMedia, triggerWhenCards) {
  const speakers = getPlayback(homey);
  const card = homey.flow.getActionCard(id);
  card.getArgument('speaker').registerAutocompleteListener(query => speakers.autocomplete(query));
  card.registerRunListener(async args => {
    if (typeof args.text !== 'string' || !args.text.trim()) throw new Error('Enter text to announce.');
    validateVolume(args.volume);
    const speaker = await selectSpeaker(homey, args.device, args.speaker);
    if (!speaker) throw new Error('Select a speaker or configure a default speaker in Pair or Repair.');
    const media = await makeMedia(args);
    await playAnnouncement(homey, args.device, speaker, media, triggerWhenCards, args.volume);
    return true;
  });
  return card;
}

async function basicSpeech(homey, text, lang, slow = false) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter text to announce.');
  if (text.length > 200) throw new Error('Google TTS announcements support up to 200 characters.');
  const source = googleTTS.getAudioUrl(text, { lang, slow });
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

module.exports = { registerAnnouncement, basicSpeech, getPlayback, selectSpeaker, playAnnouncement, defaultSpeakerKey };
