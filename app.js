'use strict';
const _ = require('lodash');
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
      // } else if(settingName=='DefaultCloudLanguageCode') {
      //   this.setDefaultCloudLanguageCode();
      }
    }).bind(this));
    await this.setCloudJSON();
    await this.setDefaultCloudVoice();   
    //await this.setDefaultCloudLanguageCode();

    TtsServer.init({client: this.client, homey: Homey});
    



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

    var startsClouds = [
      {id:'start_googlecloudtts'},
      {id:'start_googlecloudtts_speed'},
      {id:'start_googlecloudtts_speed_pitch'}
    ];

    for (let i = 0; i < startsClouds.length; i++) {
      const start = startsClouds[i];
      
      const start_googlettscloudAction = new Homey.FlowCardAction(start.id);//this.homey.flow.getActionCard('start_googletts');
      start_googlettscloudAction.register().registerRunListener(( async ( args, state ) => { //async
              try {
                  if(!args.device || !args.text) return false;
                  var url = await TtsServer.getUrl({args});
                  console.log('start_googlettscloudAction.registerRunListener url: ' + url);
                  return this.Triggers.cloudurlTrigger.Card.trigger(args.device, {url:url} );

              } catch (error) { console.log('Error: ' + error); }
              return false;
          }).bind(this));

    }
    

    
    //await this.speak({text: 'test'});
  }
  
  
  // async setDefaultCloudLanguageCode() {
  //   var lg = (await Homey.ManagerSettings.get('DefaultCloudLanguageCode')) || Homey.__('language');
  //   console.log('setDefaultCloudLanguageCode lg: ' + lg);
  //   TtsServer.DefaultCloudLanguageCode = lg;
  // }

  async setDefaultCloudVoice() {
    var voice = await Homey.ManagerSettings.get('DefaultCloudVoice');
    if(voice) voice = JSON.parse(voice);
    var voices = await TtsServer.getVoices();
    var r;
    if(voices && voice) r = _.find(voices, v=>v.name==voice.name);
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