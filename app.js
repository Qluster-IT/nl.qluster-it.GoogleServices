'use strict';
const _ = require('lodash');
const Homey = require('homey');
const googleTTS = require('google-tts-api');
const fs = require('fs');
const path = require('path');
const util = require('util');
const textToSpeech = require('@google-cloud/text-to-speech');
    
const {Defer} = require('./lib/proto');

var TtsServer = require('./lib/tts-server')

//const fetch = require('node-fetch');

//const path = require('path');

//const GoogleFunctions = require('./lib/googleFunction');


class GoogleServicesApp extends Homey.App {
  Triggers ={
    urlTrigger:{List:[], Card:null},
    cloudurlTrigger:{List:[], Card:null},
    finished_trigger:{List:[], Card:null}
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
    this.Triggers.urlTrigger.Card = url_trigger;
    url_trigger
    .register()
    .registerRunListener( async ( args, state ) => {  console.log('url_trigger.registerRunListener'); console.log(args); return true; });
    
    const cloudurl_trigger = new Homey.FlowCardTriggerDevice('cloudurl_trigger'); // this.homey.flow.getDeviceTriggerCard('url_trigger');
    this.Triggers.cloudurlTrigger.Card = cloudurl_trigger;
    cloudurl_trigger
    .register()
    .registerRunListener( async ( args, state ) => { console.log('cloudurl_trigger.registerRunListener'); console.log(args);  return true; });
    

    var starts = [
      {id:'start_googletts', slow:false},
      {id:'start_googletts_slow', slow:true}
    ];
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];        
      const start_googlettsAction = new Homey.FlowCardAction(start.id);//this.homey.flow.getActionCard('start_googletts');
      start_googlettsAction.register().registerRunListener(( ( args, state ) => { //async
              try {
                var defer = new Defer();
                  if(!args.device || !args.text) return false;
                  if(args.text.length>200) return  new Error("Max 200 characters");
                  var settings =  args.device.getSettings();
                  var languagecode = settings && settings.languagecode ? settings.languagecode : 'en-GB';
                  var url = googleTTS.getAudioUrl(args.text, { lang:languagecode, slow: start.slow });
                  return this.Triggers.urlTrigger.Card.trigger(args.device, {url:url} );
              } catch (error) { console.log('Error: ' + error); defer.resolve('An error occured'); }
              return defer.promise;
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
      start_googlettscloudAction.register().registerRunListener(( ( args, state ) => { //async
              try {
                var defer = new Defer();
                  if(!args.device || !args.text) return false;
                  console.log('start_googlettscloudAction.registerRunListener args: ');
                  TtsServer.getUrl({args}).then(url=> {
                    console.log('start_googlettscloudAction.registerRunListener url: ' + url.url);
                    args.device.setCapabilityValue('device_url', url.url);
                    args.device.setCapabilityValue('device_duration', url.duration);                    
                    var triggered = !!this.Triggers.cloudurlTrigger.Card.trigger(args.device, {url:url.url, text:args.text, duration :url.duration } );
                    if(triggered) this.SetFinishedTimer(args.device, {url:url.url, text:args.text, duration :url.duration });
                    else this.ClearFinishedTimer(args.device);
                    defer.resolve(triggered);
                  }).catch(err=>{defer.reject('Did you configure the JSON in the settingspage?');});
              } catch (error) { 
                console.log('Error: ' + error);
                defer.reject('Did you configure the JSON in the settingspage?');
              }
              return defer.promise;
          }).bind(this));
    }
    var conditionClouds = [
      {id:'condition_googlecloudtts'},
      {id:'condition_googlecloudtts_speed'},
      {id:'condition_googlecloudtts_speed_pitch'},
      {id:'condition_say_googlecloudtts', triggerAndWait: true},
      {id:'condition_say_googlecloudtts_speed', triggerAndWait: true},
      {id:'condition_say_googlecloudtts_speed_pitch', triggerAndWait: true}
    ];
    for (let i = 0; i < conditionClouds.length; i++) {
      const condition = conditionClouds[i];      
      const condition_googlettscloudAction = new Homey.FlowCardCondition(condition.id);//this.homey.flow.getConditionCard('start_googletts');
      condition_googlettscloudAction.register().registerRunListener(( ( args, state ) => { //async
              try {
                var defer = new Defer();
                  if(!args.device || !args.text) return Promise.resolve(false);
                  console.log('condition_googlettscloudAction.registerRunListener args: ');
                  TtsServer.getUrl({args}).then(url=> {
                    console.log('condition_googlettscloudAction.registerRunListener url: ' + url.url);
                    var promises = [];
                    
                    var p1 = args.device.setCapabilityValue('device_url', url.url);
                    var p2 = args.device.setCapabilityValue('device_duration', url.duration);
                    promises.push(p1);
                    promises.push(p2);
                    

                    if(condition.triggerAndWait) {
                      var triggered = !!this.Triggers.cloudurlTrigger.Card.trigger(args.device, {url:url.url, text:args.text, duration :url.duration } );
                      if(triggered) promises.push(this.SetFinishedTimer(args.device, {url:url.url, text:args.text, duration :url.duration }));
                      else this.ClearFinishedTimer(args.device);
                    }
                   
                    var all = Promise.all(promises);                   
                    all.then(()=> {
                      defer.resolve(true);
                    }).catch((err)=> {
                      defer.reject();
                    });
                  }).catch(err=>{defer.reject('Did you configure the JSON in the settingspage?');});
              } catch (error) { 
                console.log('Error: ' + error);
                defer.reject('Did you configure the JSON in the settingspage?');
              }
              return defer.promise;
          }).bind(this));
    }

    var starts = [
      {id:'finished_trigger'}
    ];
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i];        
        const trigger =  new Homey.FlowCardTriggerDevice(start.id);//this.homey.flow.getDeviceTriggerCard(start.id);
        this.Triggers[start.id].Card = trigger;
        trigger.register().registerRunListener(( args, state ) => {  
            console.log( start.id + '.registerRunListener (args, state)');         
            console.log(args);
            console.log(state);
            return Promise.resolve( args.id && args.id.id && state.id && state.id.id && args.id.id === state.id.id );        
        });
    }
  }
  
  SetFinishedTimer(device, tokens) {
    var defer = new Defer();
    this.ClearFinishedTimer(device);
    var delay = device.getSetting('delay');
    device.finishedTimer = setTimeout((()=> {        
        defer.resolve(!!this.Triggers.finished_trigger.Card.trigger(device, tokens));
    }).bind(this), tokens.duration + (delay || 1000));
    return defer.promise;
  }
  ClearFinishedTimer(device) {    
    if(device.finishedTimer) clearTimeout(device.finishedTimer);
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
    this.credentials = json ? JSON.parse(json) : null;
    if(this.credentials)this.client = new textToSpeech.TextToSpeechClient({credentials:this.credentials});
    else this.client = null;
    TtsServer.client = this.client;
    
  }

}

module.exports = GoogleServicesApp;