'use strict';

const Homey = require('homey');
const { v4: uuidv4 } = require('uuid');
const { deviceVoiceKey, registerVoicePicker, validateVoice } = require('../../lib/speech-voices');
const registerSpeechSettings = require('../../lib/speech-setup');

class GoogleCloudTTSDriver extends Homey.Driver
{
    async onInit()
    {
        this.log('GoogleCloudTTSDriver has been initialized');        

    }

    async onPairListDevices(data)
    {
        return [{
            "name": 'Google Cloud TTS device',
            data:
            {
                "id": uuidv4()
            },
            settings:
            {
                "languagecode": "default",
                "delay" : 1000,
                "speakingRate" : 1,
                "pitch" : 0,
                "deviceprofile" : "undefined",
                "volumeGainDb" : 0,
                "prefixpause" : 0,
                "suffixpause" : 0,
                "defaultspeak" : false
            }
        }];

    }

    onPair(session) {
        const configure = registerSpeechSettings(this, session, 'googlecloudtts');
        let voice = null;
        registerVoicePicker(session);
        session.setHandler('save_voice', async selection => { voice = await validateVoice(selection); });
        session.setHandler('list_devices', async () => {
            const devices = await this.onPairListDevices();
            return configure(devices.map(device => voice ? { ...device, store: { [deviceVoiceKey]: voice } } : device));
        });
    }

    onRepair(session, device) {
        registerSpeechSettings(this, session, 'googlecloudtts', device);
        registerVoicePicker(session);
        session.setHandler('get_voice_config', () => ({ voice: device.getStoreValue(deviceVoiceKey) ?? null }));
        session.setHandler('save_voice', async selection => {
            const voice = await validateVoice(selection);
            if (voice) await device.setStoreValue(deviceVoiceKey, voice);
            else await device.unsetStoreValue(deviceVoiceKey);
        });
    }

}

module.exports = GoogleCloudTTSDriver;