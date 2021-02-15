'use strict';

const Homey = require('homey');
const googleTTS = require('google-tts-api');
//const fetch = require('node-fetch');

//const path = require('path');

//const GoogleFunctions = require('./lib/googleFunction');


class GoogleTTStoURLApp extends Homey.App {
  Triggers ={
    urlTrigger:{List:[], Card:null},
  };
  
  async onInit() {
    this.log('MyApp has been initialized');
    this.setOAuth2Init();
    
    const url_trigger = new Homey.FlowCardTriggerDevice('url_trigger'); // this.homey.flow.getDeviceTriggerCard('url_trigger');
    this.Triggers.urlTrigger.Card = url_trigger;
    url_trigger
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
                  return this.Triggers.urlTrigger.Card.trigger(args.device, {url:url} );
              } catch (error) { console.log('Error: ' + error); }
              return false;
          }).bind(this));

    }
  }
}

module.exports = GoogleTTStoURLApp;