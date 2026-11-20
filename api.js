const TtsServer = require("./lib/tts-server");
const { listGroups, writeGroup, deleteGroup, getMemberId } = require('./lib/speaker-groups');
const { getPlayback } = require('./lib/speaker-announcements');
const { checkGoogleService } = require('./lib/google-service-checks');

function requireReady(homey) {
  if (!homey.app.apiReady) throw new Error('Google Services is still starting.');
}

module.exports = {
  async checkGoogleService({ homey, body }) {
    requireReady(homey);
    return checkGoogleService(homey, body?.service);
  },
  async getVoices({ homey, query }) {
    const result = await TtsServer.getVoices();
    return result;
  },
  async getApiReady({ homey }) {
    return { ready: homey.app.apiReady === true };
  },
  async getSpeakerGroups({ homey }) {
    requireReady(homey);
    return listGroups(homey.settings);
  },
  async getAnnouncementSpeakers({ homey, query }) {
    requireReady(homey);
    const mode = query?.refresh === 'force' ? 'force' : query?.refresh === 'wait' ? 'wait' : 'cached';
    return getPlayback(homey).listSpeakers(mode, false);
  },
  async saveSpeakerGroup({ homey, body }) {
    requireReady(homey);
    const previous = listGroups(homey.settings).find(group => group.id === body?.id);
    const oldIds = new Set(previous?.members.map(member => member.id));
    const needsDiscovery = Array.isArray(body?.members) && body.members.some(member => !oldIds.has(getMemberId(member)));
    const speakers = needsDiscovery ? await getPlayback(homey).listSpeakers() : [];
    return writeGroup(homey.settings, body, speakers);
  },
  async removeSpeakerGroup({ homey, params }) {
    requireReady(homey);
    return deleteGroup(homey.settings, params.id);
  }
    // {
    //   method: 'GET',
    //   path: '/getVoices',
    //   public: true,
    //   fn: function( args, callback ){
    //     TtsServer.getVoices().then(voices=> {
    //         callback( null, voices );
    //     });
    //   }
    // }  
}