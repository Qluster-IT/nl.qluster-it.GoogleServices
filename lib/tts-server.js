const _ = require('lodash');
var http = require('http');
const musicMeta = require('music-metadata');
    
const { v4: uuidv4 } = require('uuid');


var Homey = null;

class TtsServer  {
  static client;
  static DefaultCloudVoice;
  static Urls = [];
  static UrlIndex = 0;
  
  static async getUrl ({args={}, name, ssmlGender}) {
    this.ip = (await Homey.ManagerCloud.getLocalAddress()).split(':')[0];
    var settings =  args.device.getSettings();
    console.log('this.DefaultCloudVoice.languageCodes');
    console.log(this.DefaultCloudVoice.languageCodes);
    //var languageCode = settings && settings.voice && settings.voice!='default' ? settings.languagecode : this.DefaultCloudVoice && this.DefaultCloudVoice.languageCode && this.DefaultCloudVoice.languageCode.length > 0 ? [0] : 'en-GB';
    var languageCode = this.DefaultCloudVoice && this.DefaultCloudVoice.languageCodes && Array.isArray(this.DefaultCloudVoice.languageCodes) && this.DefaultCloudVoice.languageCodes.length>0 ? this.DefaultCloudVoice.languageCodes[0] : 'en-GB';
    name = name || this.DefaultCloudVoice.name;
    ssmlGender = this.DefaultCloudVoice.ssmlGender || 'MALE';

    var pitch = args.pitch || settings.pitch || 0;
    var speakingRate = args.speakingRate || settings.speakingRate || 1;

    var url = {
      id: uuidv4(),
      text : args.text, 
      voice: {name, languageCode, ssmlGender}, 
      audioConfig : {audioEncoding:'MP3', pitch: pitch , speakingRate:speakingRate || 1} };

      var foundUrl;
      if((foundUrl = _.find(this.Urls, u=> 
          u.text==url.text 
          && u.voice.name == url.voice.name && u.voice.languageCode == url.voice.languageCode && u.voice.ssmlGender == url.voice.ssmlGender
          && u.audioConfig.audioEncoding == url.audioConfig.audioEncoding && u.audioConfig.pitch == url.audioConfig.pitch && u.audioConfig.speakingRate == url.audioConfig.speakingRate
        )) ) return foundUrl;
      
      url.url = 'http://' +this.ip + ':47333/tts/' + url.id + '.mp3';
      if(this.Urls.length>=this.UrlIndex) this.Urls.push(url);
      else this.Urls[this.UrlIndex] = url;
      this.UrlIndex++;
      if(this.UrlIndex>=100) this.UrlIndex = 0;

      url.binary = await TtsServer.getResponse({text : url.text, voice:url.voice, audioConfig:url.audioConfig });
      await this.setDuration(url);

    return url;
  }
  static async setDuration(url) {    
    var info = await musicMeta.parseBuffer(Buffer.from(url.binary, 'binary'), 'audio/mpeg', { duration: true });
    //.then((info) => {
      //console.log('setDuration response ' + Math.ceil(info.format.duration * 1000));
      url.duration = Math.ceil(info.format.duration * 1000);
    //});
  }
  static async getResponse({text, voice={name=null, languageCode=null, ssmlGender=null} = {}, audioConfig = {audioEncoding='MP3', pitch=null, speakingRate=null} = {} } = {}) {

    if(!voice) voice = DefaultCloudVoice;
    console.log('getResponse');
    console.log(voice);
    // Construct the request
    const request = {
      input: {},//text: text},
      voice: voice,//{name:name, languageCode: language, ssmlGender: gender},
      audioConfig: audioConfig //{audioEncoding: 'MP3', pitch:0, speakingRate : 1.33},
    };
    if(text.startsWith('<speak>')) request.input.ssml = text;
    else request.input.text = text;
    try {
      
      const [response] = await this.client.synthesizeSpeech(request);
      try {
        
        var b = Buffer.from(response.audioContent);
        return b;
      } catch (error2) {
        console.log('error2: ' + error2);;
      }
    } catch (error1) {
      console.log('error: ' + error1);;
    }
  }
  static async getVoices() {
    
    if(!this.client) return [];
    const [result] = await this.client.listVoices({});
    const voices = result.voices;
    //console.log(_.orderBy(_.filter(voices, v=>v.name.indexOf('-Wavenet')==-1), [o=>o.name] ));
    return _.orderBy(_.filter(voices, v=>v.name.indexOf('-Wavenet')==-1), [o=>o.name] );
  }

  
  static close() {
    if(this.server) this.server.close(((err) =>{
      if(!err); this.server = null;
    }).bind(this));
  }

  static init({client, homey}) {
    this.client=client;
    Homey = homey;
    
  
    this.server = http.createServer((function (req, res) {
      console.log('requesting: ' + req.url);
      console.log('req.headers: ' + req.headers);
      
      if(!req.headers || !req.headers.host || req.headers.host  != this.ip + ':47333') retur();


      if (req.url.slice(0, 5) !== '/tts/') {
        return retur();
      }

      // var text, name, language;
      //var id, url;
      var requests = req.url.substr(5).split('/');
      var id = requests[0].split('.')[0];
      console.log('id');
      console.log(id);
      var url = _.find(this.Urls, u=>u.id==id);
      
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

      if(url) {
        if(url && url.binary && !url.binary.then)
        if(url.binary) returnBinary(res,url.binary);
        else if(url.binary && url.binary) url.binary.then(x=> {getReturn(); }) ;
        else getReturn();
      } else return retur();


      function getReturn() {
        TtsServer.getResponse({text : url.text, voice:url.voice, audioConfig:url.audioConfig }).then(b=>{ 
          url.binary = b;
          this.setDuration(url);
          returnBinary(res,b);
        });
      }
      function returnBinary(res, b) {
        console.log('write response buffer');
        res.writeHead(200, {'content-type' : 'audio/mpeg'})
        res.write(b, 'binary');
        res.end(null, 'binary');
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
    }).bind(this)).listen(47333)//, '127.0.0.1')
  }
}

module.exports = TtsServer;