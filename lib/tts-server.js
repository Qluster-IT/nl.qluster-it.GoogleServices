const http = require('http');
// Loaded on first use; only Cloud TTS "say and wait" needs the audio duration.
let musicMeta;
    
const { v4: uuidv4 } = require('uuid');
const { BL } = require('betterlogiclibrary');
const { jsonEqual } = require('./proto');



class TtsServer  {
  static client;
  static DefaultCloudVoice;
  static Urls = [];
  static clientCalls = new Map();
  static retiredClients = new Set();
  static voicesCache = null;
  static voicesCacheMs = 10 * 60 * 1000;

  static async callClient(method, request) {
    const client = this.client;
    this.clientCalls.set(client, (this.clientCalls.get(client) || 0) + 1);
    try {
      return await client[method](request);
    } finally {
      const calls = this.clientCalls.get(client) - 1;
      if (calls) this.clientCalls.set(client, calls);
      else {
        this.clientCalls.delete(client);
        if (this.retiredClients.delete(client)) this.closeClient(client);
      }
    }
  }

  static setClient(client) {
    const previous = this.client;
    this.client = client;
    if (previous !== client) this.clearVoicesCache();
    if (!previous || previous === client) return;
    if (this.clientCalls.has(previous)) this.retiredClients.add(previous);
    else this.closeClient(previous);
  }

  static closeClient(client) {
    Promise.resolve().then(() => client.close()).catch(error => this.homey?.error('Closing replaced TTS client failed', error));
  }
  
  static applicationVoice() {
    const voice = this.DefaultCloudVoice;
    return { name: voice?.name, languageCode: voice?.languageCodes?.[0] || 'en-GB',
      ssmlGender: voice?.ssmlGender || 'MALE' };
  }

  static async getUrl ({args, name, voice}) {
    try {      
      // console.log('getUrl.voice');
      // console.log(voice);
      this.ip = (await args.device.homey.cloud.getLocalAddress()).split(':')[0];
      var settings =  args.device.getSettings();
nguagecode : this.DefaultCloudVoice && this.DefaultCloudVoice.languageCode && this.DefaultCloudVoice.languageCode.length > 0 ? [0] : 'en-GB';
      const selected = voice?.id
        ? { name: voice.id, languageCode: voice.languagecode, ssmlGender: voice.gender }
        : args.device.getStoreValue?.('cloud_voice');
      const fallback = this.applicationVoice();
      const languagecode = selected?.languageCode || fallback.languageCode;
      name = name || selected?.name || fallback.name;
      const ssmlGender = selected?.ssmlGender || fallback.ssmlGender;
  
      var pitch = args.pitch || settings.pitch || 0;
      var speakingRate = args.speakingRate || settings.speakingRate || 1;
      
      args.text = await BL.decode(args.text, languagecode); 

      var url = {
        id: uuidv4(),
        text : args.text, 
        voice: {name, languageCode: languagecode, ssmlGender}, 
        audioConfig : {audioEncoding:settings.audioEncoding||'MP3', pitch: pitch , speakingRate:speakingRate || 1} 
      };
      if(settings && settings.deviceprofile && settings.deviceprofile!=='undefined') url.audioConfig.effectsProfileId = [settings.deviceprofile];
      if(args.volumeGainDb && args.volumeGainDb!=0) url.audioConfig.volumeGainDb = args.volumeGainDb;
      else if(settings && settings.volumeGainDb && settings.volumeGainDb!==0) url.audioConfig.volumeGainDb = settings.volumeGainDb;
      if(settings && (settings.defaultspeak || settings.prefixpause || settings.suffixpause))  {
        let speakStart = '<speak>';
        let speakEnd = '</speak>';
        let speakStartIndex = url.text.indexOf(speakStart);
        if(speakStartIndex==-1) url.text = speakStart + url.text + speakEnd;
        speakStartIndex = url.text.indexOf(speakStart);
        let speakEndIndex = url.text.lastIndexOf(speakEnd);
        if(settings.prefixpause>0) {
          url.text = url.text.substr(0, speakStartIndex + speakStart.length) + '<break time="'+ settings.prefixpause.toString()  +'ms"/>' +  url.text.substr(speakStartIndex + speakStart.length);
          // speakStart + url.text + speakEnd;
        }
        if(settings.suffixpause>0) {
          url.text = url.text.substr(0, speakEndIndex + speakEnd.length) + '<break time="'+ settings.suffixpause.toString()  +'ms"/>' +  url.text.substr(speakEndIndex + speakEnd.length);
          // speakStart + url.text + speakEnd;
        }
      }
      //console.log('url');
      //console.log(url);
  
      var foundUrl;
      if((foundUrl = this.Urls.find(u=>
          u.text==url.text 
          && u.voice.name == url.voice.name && u.voice.languageCode == url.voice.languageCode && u.voice.ssmlGender == url.voice.ssmlGender
          && u.audioConfig.audioEncoding == url.audioConfig.audioEncoding && u.audioConfig.pitch == url.audioConfig.pitch && u.audioConfig.speakingRate == url.audioConfig.speakingRate && jsonEqual(u.audioConfig.effectsProfileId, url.audioConfig.effectsProfileId) && u.audioConfig.volumeGainDb == url.audioConfig.volumeGainDb
        )) ) {
          this.Urls.splice(this.Urls.indexOf(foundUrl), 1);
          this.Urls.unshift(foundUrl);
          //console.log('this.Urls');
          //console.log(this.Urls);
          return foundUrl;
        }
      
      url.url = 'http://' +this.ip + ':47333/tts/' + url.id + (url.audioConfig.audioEncoding=='MP3' ? '.mp3' : '.wav');
      //console.log('this.Urls');
      //console.log(this.Urls);
      
      url.binary = await TtsServer.getResponse({text : url.text, voice:url.voice, audioConfig:url.audioConfig });
      await this.setDuration(url);
      this.Urls.unshift(url);
      if (this.Urls.length > 100) this.Urls.length = 100;
  
      return url;
    } catch (error) {
      this.homey.error('TTS generation failed', error);
      throw error;
    }
    
  }
  static async hostMp3(homey, binary) {
    if (!this.server?.listening) throw new Error('The local speech server is not available.');
    this.ip = (await homey.cloud.getLocalAddress()).split(':')[0];
    const id = uuidv4();
    this.Urls.unshift({ id, binary, audioConfig: { audioEncoding: 'MP3' } });
    if (this.Urls.length > 100) this.Urls.length = 100;
    return `http://${this.ip}:47333/tts/${id}.mp3`;
  }

  static async setDuration(url) {    
    if (!musicMeta) musicMeta = require('music-metadata');
    var info = await musicMeta.parseBuffer(Buffer.isBuffer(url.binary) ? url.binary : Buffer.from(url.binary, 'binary'), (url.audioConfig.audioEncoding=='MP3'?  'audio/mpeg' : 'audio/wav'), { duration: true });

    //.then((info) => {
      //console.log('setDuration response ' + Math.ceil(info.format.duration * 1000));
      url.duration = Math.ceil(info.format.duration * 1000);
    //});
  }
  static async getResponse({text, voice={name:null, languageCode:null, ssmlGender:null}, audioConfig = {audioEncoding:'MP3', pitch:null, speakingRate:null}, plainText = false} = {}) {

    if (!this.client) throw new Error('Configure Google Cloud Text-to-Speech in the app settings first.');
    if(!voice) voice = this.DefaultCloudVoice;
    //console.log('getResponse');
    //console.log(voice);
    // Construct the request
    const request = {
      input: {},//text: text},
      voice: voice,//{name:name, languageCode: language, ssmlGender: gender},
      audioConfig: audioConfig //{audioEncoding: 'MP3', pitch:0, speakingRate : 1.33},
    };
    if(!plainText && (text.startsWith('<speak') || text.startsWith('<Say'))) request.input.ssml = text;
    else request.input.text = text;
    try {
      
      const [response] = await this.callClient('synthesizeSpeech', request);
      return Buffer.isBuffer(response.audioContent) ? response.audioContent : Buffer.from(response.audioContent);
    } catch (error1) {
      try {
        await this.homey.notifications.createNotification({excerpt : "Google Cloud responded: " + error1 });
      } catch (notificationError) {
        this.homey.error('TTS error notification failed', notificationError);
      }
      throw error1;
    }
  }
  static async getVoices() {
    const client = this.client;
    if(!client) return [];
    let cache = this.voicesCache;
    if (!cache || cache.client !== client) {
      this.clearVoicesCache();
      // The voice autocomplete asks on every keystroke; keep the list briefly instead of calling Google each time.
      cache = this.voicesCache = { client, voices: this.loadVoices() };
      const forget = () => { if (this.voicesCache === cache) this.clearVoicesCache(); };
      cache.voices.catch(forget);
      cache.timer = this.homey.setTimeout(forget, this.voicesCacheMs);
    }
    return (await cache.voices).slice();
  }

  static clearVoicesCache() {
    const cache = this.voicesCache;
    if (!cache) return;
    this.voicesCache = null;
    this.homey.clearTimeout(cache.timer);
  }

  static async loadVoices() {
    const [result] = await this.callClient('listVoices', {});
    const voices = result.voices;
    //console.log(_.orderBy(_.filter(voices, v=>v.name.indexOf('-Wavenet')==-1), [o=>o.name] ));
    //return _.orderBy(_.filter(voices, v=>v.name.indexOf('-Wavenet')==-1), [o=>o.name] );
    return Array.isArray(voices) ? voices.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : [];
  }

  
  static close() {
    this.clearVoicesCache();
    if(this.server) this.server.close(((err) =>{
      if(!err); this.server = null;
    }).bind(this));
  }

  static init({client, homey}) {
    this.setClient(client);
    this.homey = homey;
    
  
    this.server = http.createServer((function (req, res) {
      //console.log('requesting: ' + req.url);
      //console.log('req.headers: ' + req.headers);
      
      if(!req.headers || !req.headers.host || req.headers.host  != this.ip + ':47333') return retur();


      if (req.url.slice(0, 5) !== '/tts/') {
        return retur();
      }

      // var text, name, language;
      //var id, url;
      var requests = req.url.substr(5).split('/');
      var id = requests[0].split('.')[0];
      //console.log('id');
      //console.log(id);
      var url = this.Urls.find(u=>u.id==id);
      
      // for (let i = 0; i < requests.length; i++) {
      //   const element = requests[i];

      //   // if(i==requests.length-1) {
      //   //   text = unescape(requests[i]);
      //   // } else ;
      //   var _c = requests[i].split(':');
      //   switch (_c[0]) {
      //     case 'id':
      //       id =   _c[1];
      //       url = _.find(this.Urls, u=>u.id==id);
      //       break;
      //     // case 'name':
      //     //   name =   _c[1];            
      //     //   break;
      //     // case 'language':
      //     //   language =   _c[1];            
      //     //   break;
      //   }
      // }
      //if (!name && !language) name = this.DefaultCloudVoice;

      // console.log('text');
      // console.log(text);
      // console.log(name);

      // Urls only holds entries whose audio has been generated.
      if (url && url.binary) return returnBinary(res, url.binary);
      return retur();


      function returnBinary(res, b) {
        //console.log('write response buffer');
        res.writeHead(200, {
          'content-type': url.audioConfig.audioEncoding === 'MP3' ? 'audio/mpeg' : 'audio/wav',
          'content-length': Buffer.byteLength(b, 'binary')
        });
        res.end(b, 'binary');
      }



      
      function retur() {
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({
          status: 'ok'
        }));
      }


    
      //originResponse.pipe(res)

      // var id = req.url.slice(11, 25)
      // var url = 'https://www.youtube.com/watch?v=' + id

      // https.request({
      //   hostname: 'www.youtubetransfer.com',
      //   path: '/getinfo/?url=' + encodeURIComponent(url)
      // }, function (r) {
      //   var cookies = r.headers['set-cookie']
      //   if (!cookies) {
      //     res.writeHead(500, {
      //       'Content-Type': 'application/json'
      //     })
      //     res.end(JSON.stringify({
      //       error: 'Error fetching cookies'
      //     }))
      //     return
      //   }
      //   cookies = cookies.map(function (cookie) {
      //     return cookie.split(';')[0]
      //   })

      //   var options = {
      //     agent: false,
      //     hostname: 'www.youtubetransfer.com',
      //     path: '/download/?url=' + (Buffer.from(url).toString('base64')),
      //     headers: {
      //       cookie: cookies.join('; ')
      //     }
      //   }

      //   https.request(options, function (originResponse) {
      //     res.writeHead(originResponse.statusCode, originResponse.headers)
      //     originResponse.pipe(res)
      //   })
      //     .on('error', function (err) {
      //       console.error(err)
      //     })
      //     .end()
      // })
      //   .on('error', function (err) {
      //     console.error(err)
      //   })
      //   .end()
    }).bind(this));
    // Without an error listener a busy port surfaces as an uncaught exception without context.
    this.server.on('error', error => this.homey.error('TTS server could not use port 47333', error));
    this.server.listen(47333);
  }
}

module.exports = TtsServer;