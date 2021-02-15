const TtsServer = require("./lib/tts-server");

module.exports = [

    {
      method: 'GET',
      path: '/getVoices',
      public: true,
      fn: function( args, callback ){
        TtsServer.getVoices().then(voices=> {
            callback( null, voices );
        });
      }
    }
    // ,
  
    // {
    //   method: 'POST',
    //   path: '/',
    //   fn: function( args, callback ){
    //     const result = Homey.app.addSomething( args.body );
    //     if( result instanceof Error ) return callback( result );
    //     return callback( null, result );
    //   }
    // },
  
    // {
    //   method: 'PUT',
    //   path: '/:id',
    //   fn: function( args, callback ){
    //     const result = Homey.app.updateSomething( args.params.id, args.body );
    //     if( result instanceof Error ) return callback( result );
    //     return callback( null, result );
    //   }
    // },
  
    // {
    //   method: 'DELETE',
    //   path: '/:id',
    //   fn: function( args, callback ){
    //     const result = Homey.app.deleteSomething( args.params.id );
    //     if( result instanceof Error ) return callback( result );
    //     return callback( null, result );
    //   }
    // }
  
  ]