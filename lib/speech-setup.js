'use strict';

const { getPlayback, defaultSpeakerKey } = require('./speaker-announcements');

function registerSpeechSettings(driver, session, driverId, device) {
  const manifest = require('../app.json').drivers.find(item => item.id === driverId);
  const language = driver.homey.i18n.getLanguage();
  const label = value => typeof value === 'string' ? value : value?.[language] || value?.en || '';
  const flatten = settings => settings.flatMap(setting => setting.type === 'group' ? flatten(setting.children) : [setting]);
  const schema = flatten(manifest.settings || []).filter(setting => setting.type !== 'label');
  let settings = Object.fromEntries(schema.map(setting =>
    [setting.id, device?.getSetting(setting.id) ?? setting.value]));
  if (!device && schema.some(setting => setting.id === 'languagecode')) {
    settings.languagecode = driver.homey.__('languagecode');
  }
  let speaker = device?.getStoreValue(defaultSpeakerKey) ?? null;
  const next = driverId === 'googletts' ? (device ? null : 'list_devices') : (device ? 'configure_voice' : 'choose_voice');
  session.setHandler('get_speech_settings', () => ({
    settings, speaker, next,
    fields: schema.map(setting => ({
      ...setting, label: label(setting.label), hint: label(setting.hint),
      values: setting.values?.map(value => ({ id: value.id, label: label(value.label) }))
    }))
  }));
  session.setHandler('list_speakers', async () => {
    const playback = getPlayback(driver.homey);
    return playback.autocomplete('', true);
  });
  session.setHandler('save_speech_settings', async input => {
    if (!input || !input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) {
      throw new Error('Invalid speech settings.');
    }
    if (Object.keys(input.settings).some(key => !schema.some(setting => setting.id === key))) {
      throw new Error('Unknown speech setting.');
    }
    const values = {};
    for (const setting of schema) {
      const value = input.settings[setting.id];
      const valid = setting.type === 'checkbox' ? typeof value === 'boolean'
        : setting.type === 'number' ? typeof value === 'number' && Number.isFinite(value) &&
          (setting.min === undefined || value >= setting.min) && (setting.max === undefined || value <= setting.max)
        : setting.type === 'dropdown' && setting.values.some(option => option.id === value);
      if (!valid) throw new Error(`Invalid value for ${label(setting.label)}.`);
      values[setting.id] = value;
    }
    let selected = null;
    if (input.speaker !== null) {
      if (typeof input.speaker?.id !== 'string') throw new Error('Select a speaker from the list.');
      if (input.speaker.id === speaker?.id) selected = speaker;
      else {
        const options = await getPlayback(driver.homey).autocomplete('');
        selected = options.find(option => option.id === input.speaker.id);
        if (!selected) throw new Error('Select an available speaker or group.');
      }
    }
    if (device) {
      if (selected) await device.setStoreValue(defaultSpeakerKey, selected);
      else await device.unsetStoreValue(defaultSpeakerKey);
      try { await device.setSettings(values); }
      catch (error) {
        if (speaker) await device.setStoreValue(defaultSpeakerKey, speaker);
        else await device.unsetStoreValue(defaultSpeakerKey);
        driver.error('Saving speech settings failed', error);
        throw error;
      }
    }
    settings = values;
    speaker = selected;
  });
  return devices => devices.map(item => ({
    ...item, settings: { ...item.settings, ...settings },
    store: { ...item.store, ...(speaker ? { [defaultSpeakerKey]: speaker } : {}) }
  }));
}

module.exports = registerSpeechSettings;
