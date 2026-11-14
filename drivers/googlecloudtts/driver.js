'use strict';

const Homey = require('homey');
const { v4: uuidv4 } = require('uuid');

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

    // Repair lists the device and adds the capabilities that older devices miss.
    async onRepair(session, device) {
        session.setHandler('list_devices', async () => {
            for (const capability of ['device_url', 'device_duration']) {
                if (!device.hasCapability(capability)) await device.addCapability(capability);
            }
            return [{ name: device.getName(), data: { id: uuidv4() } }];
        });
    }

}

module.exports = GoogleCloudTTSDriver;