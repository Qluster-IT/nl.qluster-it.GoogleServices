const _ = require('lodash');
var http = require('http');
var https = require('https');
const util = require('util');
const fs = require('fs');
const { Stream } = require('stream');

class TtsServer  {
  static client;
  static DefaultCloudVoice;

  static async getResponse({text, device, name}) {

    // Construct the request
    const request = {
      input: {text: text},
      // Select the language and SSML voice gender (optional)
      voice: {name:name, languageCode: language, ssmlGender: gender},
      // select the type of audio encoding
      audioConfig: {audioEncoding: 'MP3'},
    };

    const [response] = await this.client.synthesizeSpeech(request);
    var b = Buffer.from(response.audioContent);
    return b;
    

    //writeFile('/userdata/test.mp3', response.audioContent, 'binary');
    //await writeFile('/userdata/test.mp3', response.audioContent, 'binary');
    console.log('Audio content written to file: test.mp3');  
  }
  static async getVoices() {
    
    const [result] = await this.client.listVoices({});
    const voices = result.voices;
    return _.filter(voices, v=>v.name.indexOf('-Wavenet')==-1);
  }

  
  static close() {
    if(this.server) this.server.close(((err) =>{
      if(!err); this.server = null;
    }).bind(this));
  }

  static init({client}) {
    this.client=client;
    
  
    this.server = http.createServer((function (req, res) {
      console.log('requesting');
      if (req.url.slice(0, 5) !== '/tts/') {
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({
          status: 'ok'
        }))
        return;
      }

      var text, name, language;
      var requests = req.url.substr(5).split('/');
      for (let i = 0; i < requests.length; i++) {
        const element = requests[i];

        if(i==requests.length-1) {
          text = unescape(requests[i]);
        } else ;
          var _c = requests[i].split(':');
          switch (_c[0]) {
            case 'name':
              name =   _c[1];            
              break;
            case 'language':
              language =   _c[1];            
              break;
          }
      }
      if (!name && !language) name = this.DefaultCloudVoice;

      console.log('text');
      console.log(text);
      console.log(name);

      this.getResponse({text : text, name:name, language : language }).then(b=>{ 
        console.log('write response buffer');
        res.writeHead(200, {'content-type' : 'audio/mpeg'})
        res.write(b, 'binary');
        res.end(null, 'binary');
      });
    
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