'use strict';

const Homey = require('homey');
const { v4: uuidv4 } = require('uuid');

class GoogleCloudTTSDriver extends Homey.Driver
{
    async onInit()
    {
        this.log('GoogleCloudTTSDriver has been initialized');        

    }
    onPairListDevices(data, callback) {
        this.onPairListDevicesAsync().then(function(l) { callback(null, l); });

    }
    async onPairListDevicesAsync()
    {
        return Promise.resolve({
            "name": 'Google Cloud TTS device',
            data:
            {
                "id": uuidv4()
            },
            settings:
            {
                "languagecode": Homey.__('languagecode') || 'en-GB'
            }
        });

    }

}

module.exports = GoogleCloudTTSDriver;