var http = require('http');
var https = require('https');
const util = require('util');
const fs = require('fs');
const { Stream } = require('stream');

class TtsServer  {
  static client;

  static async getResponse({text, device}) {

    // Construct the request
    const request = {
      input: {text: text},
      // Select the language and SSML voice gender (optional)
      voice: {languageCode: 'nl-NL', ssmlGender: 'MALE'},
      // select the type of audio encoding
      audioConfig: {audioEncoding: 'MP3'},
    };

    // Performs the text-to-speech request
    const [response] = await this.client.synthesizeSpeech(request);
    console.log('response');
    //console.log(await this.client.synthesizeSpeech(request));
    // Write the binary audio content to a local file
    //const writeFile = util.promisify(fs.writeFile);
    var b = Buffer.from(response.audioContent);
    return b;
    

    //writeFile('/userdata/test.mp3', response.audioContent, 'binary');
    //await writeFile('/userdata/test.mp3', response.audioContent, 'binary');
    console.log('Audio content written to file: test.mp3');  
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

      var requests = req.url.substr(5).split('/');
      var text = unescape(requests[requests.length-1]);
      
      console.log('text');
      console.log(text);

      this.getResponse({text : text }).then(b=>{ 
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