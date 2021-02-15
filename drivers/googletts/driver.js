'use strict';

const Homey = require('homey');
const { v4: uuidv4 } = require('uuid');

class GoogleTTSDriver extends Homey.Driver
{
    async onInit()
    {
        this.log('GoogleTTSDriver has been initialized');        

    }
    onPairListDevices(data, callback) {
        this.onPairListDevicesAsync().then(function(l) { callback(null, l); });

    }
    async onPairListDevicesAsync()
    {
        return Promise.resolve({
            "name": 'Google TTS device',
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

module.exports = GoogleTTSDriver;