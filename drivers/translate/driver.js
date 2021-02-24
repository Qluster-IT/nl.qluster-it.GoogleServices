'use strict';

const Homey = require('homey');
const { v4: uuidv4 } = require('uuid');
const {TranslationServiceClient} = require('@google-cloud/translate');

const {Defer} = require('./../../lib/proto');
const projectId = 'projects/homeyman';
    

class GoogleTranslateDriver extends Homey.Driver
{
    async onInit()
    {
        this.log('GoogleTranslateDriver has been initialized');

        Homey.ManagerSettings.on('set', (function(settingName) {
            if(settingName=='CloudJSON') {
                this.setCloudJSON();
            }
        }).bind(this));
        await this.setCloudJSON();
        // this.on("credentialsUpdated", (credentials)=> {
        //     console.log("on.credentialsUpdated");
        //     console.log(credentials);
        // });

        var conditions = [
            {id:'condition_translate', triggerAndWait: true}
        ];
        for (let i = 0; i < conditions.length; i++) {
            const condition = conditions[i];      
            const conditionCard = new Homey.FlowCardCondition(condition.id);
            conditionCard.register().registerRunListener(( ( args, state ) => {
                console.log(condition.id + '.registerRunListener args: ');
                var defer = new Defer();
                try {
                    if(!args.device || !args.translate || !args.targetlanguagecode) return Promise.resolve(false);
                    var promises = [];
                    promises.push(args.device.setCapabilityValue('device_translate', args.translate));
                            
                    this.translate(args.translate, args.device.getSetting('languagecode'), args.targetlanguagecode).then((translation)=> {
                        if(!translation) {
                            defer.reject("Could not translate");
                            return;
                        }
                        promises.push(args.device.setCapabilityValue('device_translation', translation));

                        // if(condition.triggerAndWait) {
                        //     var triggered = !!this.Triggers.cloudurlTrigger.Card.trigger(args.device, {url:url.url, text:args.text, duration :url.duration } );
                        //     if(triggered) promises.push(this.SetFinishedTimer(args.device, {url:url.url, text:args.text, duration :url.duration }));
                        //     else this.ClearFinishedTimer(args.device);
                        // }            

                        var all = Promise.all(promises);                   
                        all.then(()=> {
                            defer.resolve(true);
                        }).catch((err)=> {
                            defer.reject();
                        });
                    }).catch(err=>{console.log('err: ' + error);defer.reject('Did you configure the JSON in the settingspage?');});
                } catch (error) { 
                    console.log('error: ' + error);
                    defer.reject('Did you configure the JSON in the settingspage?');
                }
                return defer.promise;
            }).bind(this));
        }
    }


    onPairListDevices(data, callback) {
        this.onPairListDevicesAsync(data).then(function(l) { callback(null, l); });

    }

    async onPairListDevicesAsync(data)
    {
        return Promise.resolve({
            "name": 'Google Translate',
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

    async setCloudJSON() {
        var json = await Homey.ManagerSettings.get('CloudJSON');
        this.credentials = json ? JSON.parse(json) : null;
        if(this.credentials){
          this.translateClient  = new TranslationServiceClient({credentials:this.credentials});
        }
        else {
          this.translateClient = null;
        }
    }
    async translate(text, source, target) {        
        const [translation] = await this.translateClient.translateText({ contents:[text], sourceLanguageCode:source, targetLanguageCode:target, parent: projectId});
        // console.log(`Text: ${text}`);
        // console.log(`Translation: ${translation}`);
        // console.log(translation);
        return translation && translation.translations && translation.translations.length>0 ? translation.translations[0].translatedText : null;
      }

}

module.exports = GoogleTranslateDriver;