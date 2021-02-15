'use strict';

const Homey = require('homey');
const googleTTS = require('google-tts-api');
const fs = require('fs');
const path = require('path');
const util = require('util');
const textToSpeech = require('@google-cloud/text-to-speech');
    
var TtsServer = require('./lib/tts-server')

//const fetch = require('node-fetch');

//const path = require('path');

//const GoogleFunctions = require('./lib/googleFunction');


class GoogleTTStoURLApp extends Homey.App {
  Triggers ={
    urlTrigger:{List:[], Card:null},
    cloudurlTrigger:{List:[], Card:null}
  };

  async onInit() {
    this.log('MyApp has been initialized');
    
    Homey.ManagerSettings.on('set', (function(settingName) {
      if(settingName=='CloudJSON') {
          this.setCloudJSON();
      } else if(settingName=='DefaultCloudVoice') {
        this.setDefaultCloudVoice();
    }
    }).bind(this));
    await this.setCloudJSON();
    await this.setDefaultCloudVoice();
    
    TtsServer.init({client: this.client});
    var voices  = await TtsServer.getVoices();
    console.log(voices);



    const url_trigger = new Homey.FlowCardTriggerDevice('url_trigger'); // this.homey.flow.getDeviceTriggerCard('url_trigger');
    this.Triggers.cloudurlTrigger.Card = url_trigger;
    url_trigger
    .register()
    .registerRunListener( async ( args, state ) => {  return true; });
    
    const cloudurl_trigger = new Homey.FlowCardTriggerDevice('cloudurl_trigger'); // this.homey.flow.getDeviceTriggerCard('url_trigger');
    this.Triggers.cloudurlTrigger.Card = cloudurl_trigger;
    cloudurl_trigger
    .register()
    .registerRunListener( async ( args, state ) => {  return true; });
    

    var starts = [
      {id:'start_googletts', slow:false},
      {id:'start_googletts_slow', slow:true}
    ];
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];        
      const start_googlettsAction = new Homey.FlowCardAction(start.id);//this.homey.flow.getActionCard('start_googletts');
      start_googlettsAction.register().registerRunListener(( ( args, state ) => { //async
              try {
                  if(!args.device || !args.text) return false;
                  if(args.text.length>200) return  new Error("Max 200 characters");
                  var settings =  args.device.getSettings();
                  var languagecode = settings && settings.languagecode ? settings.languagecode : 'en-GB';
                  var url = googleTTS.getAudioUrl(args.text, { lang:languagecode, slow: start.slow });
                  return this.Triggers.cloudurlTrigger.Card.trigger(args.device, {url:url} );
              } catch (error) { console.log('Error: ' + error); }
              return false;
          }).bind(this));
    }


    const start_googlettscloudAction = new Homey.FlowCardAction('start_googlecloudtts');//this.homey.flow.getActionCard('start_googletts');
      start_googlettscloudAction.register().registerRunListener(( async ( args, state ) => { //async
              try {
                  if(!args.device || !args.text) return false;
                  var settings =  args.device.getSettings();
                  var languagecode = settings && settings.languagecode ? settings.languagecode : 'en-GB';
                  var ip = (await Homey.ManagerCloud.getLocalAddress()).split(':')[0];
                  //var url = 'http://' +ip + ':47333/tts/' + this.setDefaultCloudVoice +languagecode + '/' + escape(args.text);// googleTTS.getAudioUrl(args.text, { lang:languagecode, slow: start.slow });
                  var url = 'http://' +ip + ':47333/tts/' + escape(args.text);// googleTTS.getAudioUrl(args.text, { lang:languagecode, slow: start.slow });
                  return this.Triggers.cloudurlTrigger.Card.trigger(args.device, {url:url} );
              } catch (error) { console.log('Error: ' + error); }
              return false;
          }).bind(this));

    

    
    //await this.speak({text: 'test'});
  }
  
  async setDefaultCloudVoice() {
    var voice = await Homey.ManagerSettings.get('DefaultCloudVoice');
    var voices = await TtsServer.getVoices();
    var r;
    if(voices) r = _.find(voices=>voices.name==voice);
    TtsServer.DefaultCloudVoice = r;    
  }

  async setCloudJSON() {
    var json = await Homey.ManagerSettings.get('CloudJSON');
    this.credentials = JSON.parse(json);
    if(this.credentials)this.client = new textToSpeech.TextToSpeechClient({credentials:this.credentials});
    else this.client = null;
    TtsServer.client = this.client;
    
  }

}

module.exports = GoogleTTStoURLApp;