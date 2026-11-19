'use strict';

const fetch = require('node-fetch');

const topologyType = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1';
const xml = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const array = value => [].concat(value ?? []);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decodeXml = value => value.replace(/&(lt|gt|quot|apos|amp);/g, (_, key) =>
  ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[key]);

class Unsupported extends Error {}

function parse(value, attributes = false) {
  const { XMLParser } = require('fast-xml-parser');
  return new XMLParser({ removeNSPrefix: true, ignoreAttributes: !attributes,
    processEntities: false, parseTagValue: false }).parse(value);
}

async function soap(service, action, args = {}, instance = true) {
  const response = await fetch(service.endpoint, {
    method: 'POST', redirect: 'error', timeout: 5000, size: 512 * 1024,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.service}#${action}"` },
    body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="${service.service}">` +
      (instance ? '<InstanceID>0</InstanceID>' : '') +
      Object.entries(args).map(([key, value]) => `<${key}>${xml(value)}</${key}>`).join('') +
      `</u:${action}></s:Body></s:Envelope>`
  });
  const body = parse(await response.text())?.Envelope?.Body;
  const fault = body?.Fault;
  const code = fault?.detail?.UPnPError?.errorCode;
  if (String(code) === '401') throw new Unsupported(`${action} is not supported.`);
  if (!response.ok || fault) throw new Error(`${action} failed (HTTP ${response.status}${code ? `, UPnP ${code}` : ''}).`);
  const result = body?.[`${action}Response`];
  if (result === undefined) throw new Error(`The speaker did not return ${action}.`);
  return result || {};
}

async function optional(action) {
  try { return await action(); }
  catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

async function actions(service) {
  if (!service.scpd) return new Set();
  const response = await fetch(service.scpd, { redirect: 'error', timeout: 3000, size: 256 * 1024 });
  if (!response.ok) throw new Error(`Speaker service description returned HTTP ${response.status}.`);
  const definition = parse(await response.text())?.scpd;
  const supported = new Set(array(definition?.actionList?.action).map(action => action.name));
  const range = array(definition?.serviceStateTable?.stateVariable).find(state => state.name === 'Volume')?.allowedValueRange;
  if (range) {
    const min = Number(range.minimum), max = Number(range.maximum), step = Number(range.step || 1);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min && step > 0) supported.volumeRange = { min, max, step };
  }
  return supported;
}

async function topology(speaker) {
  const response = await soap({ endpoint: speaker.topology, service: topologyType }, 'GetZoneGroupState', {}, false);
  if (typeof response.ZoneGroupState !== 'string') throw new Error('Sonos did not return zone topology.');
  const groups = parse(decodeXml(response.ZoneGroupState), true)?.ZoneGroupState?.ZoneGroups;
  if (groups == null) throw new Error('Sonos returned invalid zone topology.');
  return array(groups.ZoneGroup).map(group => ({
    coordinator: group['@_Coordinator'],
    members: array(group.ZoneGroupMember).map(member => ({
      uuid: member['@_UUID'], hidden: member['@_Invisible'] === '1', channelMap: member['@_ChannelMapSet']
    }))
  }));
}

function uuid(speaker) { return speaker.id.replace(/^dlna:uuid:/, '').toUpperCase(); }

class Dlna {
  constructor(speaker) { this.speaker = speaker; }

  async prepare(options) {
    this.options = options;
    this.actions = await actions(this.speaker);
    if (options.resume || options.group) {
      if (['GetMediaInfo', 'GetTransportInfo', 'SetAVTransportURI', 'Play'].every(action => this.actions.has(action))) {
        this.original = await optional(() => this.snapshot());
      }
    }
    if (options.volume !== undefined && this.speaker.rendering) {
      const rendering = this.speaker.rendering;
      const supported = await actions(rendering);
      this.volumeRange = supported.volumeRange || { min: 0, max: 100, step: 1 };
      if (supported.has('GetVolume') && supported.has('SetVolume')) {
        const volume = await optional(() => soap(rendering, 'GetVolume', { Channel: 'Master' }));
        const value = Number(volume?.CurrentVolume);
        if (volume && Number.isFinite(value)) this.volume = value;
      }
    }
  }

  async snapshot() {
    const media = await soap(this.speaker, 'GetMediaInfo');
    const transport = await soap(this.speaker, 'GetTransportInfo');
    const position = this.actions.has('GetPositionInfo')
      ? await optional(() => soap(this.speaker, 'GetPositionInfo')) : null;
    if (typeof media.CurrentURI !== 'string' || typeof transport.CurrentTransportState !== 'string') {
      throw new Error('The speaker returned invalid playback state.');
    }
    return { uri: decodeXml(media.CurrentURI), metadata: decodeXml(media.CurrentURIMetaData || ''),
      state: transport.CurrentTransportState, position };
  }

  async setVolume() {
    if (this.volume === undefined) return;
    const { min, max, step } = this.volumeRange;
    this.appliedVolume = Math.min(max, min + Math.round((max - min) * this.options.volume / 100 / step) * step);
    const result = await optional(() => soap(this.speaker.rendering, 'SetVolume', {
      Channel: 'Master', DesiredVolume: this.appliedVolume
    }));
    this.changedVolume = result !== null;
  }

  async current() {
    const media = await soap(this.speaker, 'GetMediaInfo');
    const transport = await soap(this.speaker, 'GetTransportInfo');
    return { uri: decodeXml(media.CurrentURI || ''), state: transport.CurrentTransportState };
  }

  async ended(media) {
    if (!this.actions?.has('GetMediaInfo') || !this.actions.has('GetTransportInfo')) return false;
    const state = await optional(() => this.current());
    if (!state) { this.actions.delete('GetTransportInfo'); return false; }
    if (state.uri && state.uri !== media.url) { this.interrupted = true; this.external = true; return true; }
    if (state.state === 'ERROR_OCCURRED') throw new Error('The speaker could not play the announcement.');
    if (['STOPPED', 'PAUSED_PLAYBACK', 'NO_MEDIA_PRESENT'].includes(state.state)) return true;
    return false;
  }

  async restoreMedia(resume, regrouping = false) {
    if (!this.original || !this.started || (this.interrupted && !regrouping)) return;
    const current = await this.current();
    if (!regrouping && current.uri && current.uri !== this.media.url) return;
    const saved = this.original;
    await soap(this.speaker, 'SetAVTransportURI', { CurrentURI: saved.uri, CurrentURIMetaData: saved.metadata });
    if (saved.uri && this.actions.has('Seek') && saved.position) {
      if (/^x-rincon-queue:/i.test(saved.uri) && Number(saved.position.Track) > 0) {
        await soap(this.speaker, 'Seek', { Unit: 'TRACK_NR', Target: saved.position.Track });
      }
      if (/^\d+:\d{2}:\d{2}(?:\.\d+)?$/.test(saved.position.RelTime || '')) {
        await optional(() => soap(this.speaker, 'Seek', { Unit: 'REL_TIME', Target: saved.position.RelTime }));
      }
    }
    if (resume && saved.uri && saved.state === 'PLAYING') await soap(this.speaker, 'Play', { Speed: 1 });
  }

  async restoreVolume() {
    if (!this.changedVolume) return;
    const current = await soap(this.speaker.rendering, 'GetVolume', { Channel: 'Master' });
    // Do not overwrite a volume adjustment made by the user during the announcement.
    if (Number(current.CurrentVolume) === this.appliedVolume) {
      await soap(this.speaker.rendering, 'SetVolume', { Channel: 'Master', DesiredVolume: this.volume });
    }
  }

  async close() {}
}

function castCall(target, method, ...args) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      error ? reject(new Error(`Google Cast ${method} failed.`)) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), 8000);
    try { target[method](...args, finish); }
    catch (error) { finish(error); }
  });
}

class Cast {
  constructor(speaker) { this.speaker = speaker; }

  async prepare(options) {
    const { Client, DefaultMediaReceiver } = require('castv2-client');
    this.Receiver = DefaultMediaReceiver;
    this.options = options;
    this.client = new Client();
    this.client.on('error', () => { this.disconnected = true; });
    this.client.on('close', () => { this.disconnected = true; });
    await castCall(this.client, 'connect', { host: this.speaker.host, port: this.speaker.port });
    const status = await castCall(this.client, 'getStatus');
    if (options.volume !== undefined && Number.isFinite(status.volume?.level)) this.volume = status.volume.level;
    const previous = status.applications?.find(app => app.appId === DefaultMediaReceiver.APP_ID);
    if (options.resume && previous) {
      this.player = await castCall(this.client, 'join', previous, DefaultMediaReceiver);
      const media = await castCall(this.player, 'getStatus');
      if (media?.media?.contentId) this.original = media;
    }
  }

  async setVolume() {
    if (this.volume === undefined) return;
    await castCall(this.client, 'setVolume', { level: this.options.volume / 100 });
    this.changedVolume = true;
  }

  async play(media) {
    this.player ||= await castCall(this.client, 'launch', this.Receiver);
    await castCall(this.player, 'load', { contentId: media.url, contentType: media.type, streamType: 'BUFFERED' }, { autoplay: true });
  }

  async ended(media) {
    if (this.disconnected) throw new Error('Google Cast disconnected during the announcement.');
    const status = await castCall(this.player, 'getStatus');
    if (status?.media?.contentId && status.media.contentId !== media.url) { this.interrupted = true; return true; }
    if (status?.idleReason === 'ERROR') throw new Error('Google Cast could not play the announcement.');
    return !status || status.playerState === 'IDLE';
  }

  async restoreMedia(resume) {
    if (!resume || !this.original || !this.started || this.interrupted || this.disconnected) return;
    const current = await castCall(this.player, 'getStatus');
    if (current?.media?.contentId && current.media.contentId !== this.media.url) return;
    await castCall(this.player, 'load', this.original.media, {
      autoplay: this.original.playerState === 'PLAYING', currentTime: this.original.currentTime || 0
    });
  }

  async restoreVolume() {
    if (!this.changedVolume || this.disconnected) return;
    const current = await castCall(this.client, 'getVolume');
    if (Math.abs(current.level - this.options.volume / 100) < 0.001) {
      await castCall(this.client, 'setVolume', { level: this.volume });
    }
  }

  async close() { this.client?.close(); }
}

async function groupSonos(sessions) {
  const pending = sessions.filter(session => session.speaker.protocol === 'sonos' && session.speaker.topology &&
    session.original && session.actions.has('BecomeCoordinatorOfStandaloneGroup'));
  const grouped = [];
  while (pending.length) {
    const first = pending.shift();
    let groups;
    try { groups = await topology(first.speaker); }
    catch (error) {
      if (!(error instanceof Unsupported)) { first.failed = true; first.controlError = error.message; }
      continue;
    }
    const known = new Set(groups.flatMap(group => group.members.map(member => member.uuid?.toUpperCase())));
    const household = [first, ...pending.filter(session => known.has(uuid(session.speaker)))];
    for (const session of household.slice(1)) pending.splice(pending.indexOf(session), 1);
    const ids = new Set(household.map(session => uuid(session.speaker)));
    const originals = groups.filter(group => group.members.some(member => ids.has(member.uuid?.toUpperCase())));
    // Never dismantle a group containing another visible room outside this announcement.
    if (household.length < 2 || originals.some(group =>
      group.members.some(member => !member.hidden && !ids.has(member.uuid?.toUpperCase())))) continue;
    const coordinator = household.find(session => originals.some(group => group.coordinator?.toUpperCase() === uuid(session.speaker)));
    if (!coordinator) continue;
    const group = { coordinator, sessions: household, originals, joined: [] };
    grouped.push(group);
    let joining;
    try {
      for (const session of household) {
        session.group = group;
        if (session === coordinator) continue;
        joining = session;
        await soap(session.speaker, 'SetAVTransportURI', {
          CurrentURI: `x-rincon:${uuid(coordinator.speaker)}`, CurrentURIMetaData: ''
        });
        group.joined.push(session);
      }
      group.complete = true;
    } catch (error) {
      const failures = [];
      await restoreGroups([group], true, failures);
      const rolledBack = !group.joined.length || group.restored;
      for (const session of household) {
        session.group = undefined;
        if (session === joining || !rolledBack) {
          session.failed = true;
          session.controlError = [error.message, ...failures, !rolledBack && 'Could not roll back the temporary group.'].filter(Boolean).join('; ');
        }
      }
      grouped.pop();
    }
  }
  return grouped;
}

async function restoreGroups(groups, resume, errors) {
  for (const group of groups) {
    try {
      if (!group.joined.length) continue;
      const current = await topology(group.coordinator.speaker);
      const active = current.find(item => item.coordinator?.toUpperCase() === uuid(group.coordinator.speaker));
      const expected = group.complete ? new Set(group.sessions.map(session => uuid(session.speaker))) :
        new Set([...group.originals.find(item => item.coordinator?.toUpperCase() === uuid(group.coordinator.speaker))
          .members.filter(member => !member.hidden).map(member => member.uuid?.toUpperCase()),
        ...group.joined.map(session => uuid(session.speaker))]);
      const actual = new Set(active?.members.filter(member => !member.hidden).map(member => member.uuid?.toUpperCase()));
      if (group.coordinator.external || actual.size !== expected.size || [...expected].some(id => !actual.has(id))) continue;
      if (group.coordinator.launched) {
        const state = await group.coordinator.current();
        if (state.uri && state.uri !== group.coordinator.media.url) continue;
      }
      for (const session of group.joined) {
        await soap(session.speaker, 'BecomeCoordinatorOfStandaloneGroup');
      }
      for (const original of group.originals) {
        const coordinator = group.sessions.find(session => uuid(session.speaker) === original.coordinator?.toUpperCase());
        if (!coordinator) continue;
        // Regrouping changed these transports even when they did not load the announcement themselves.
        if (coordinator.started || group.joined.includes(coordinator)) {
          coordinator.started = true;
          coordinator.media = group.coordinator.media;
          await coordinator.restoreMedia((resume || !group.coordinator.launched) && !group.coordinator.interrupted &&
            !group.sessions.some(session => session.volumeRestoreFailed), true);
        }
        for (const member of original.members.filter(member => !member.hidden)) {
          const session = group.sessions.find(item => uuid(item.speaker) === member.uuid?.toUpperCase());
          if (!session || session === coordinator) continue;
          await soap(session.speaker, 'SetAVTransportURI', {
            CurrentURI: `x-rincon:${uuid(coordinator.speaker)}`, CurrentURIMetaData: ''
          });
        }
      }
      group.restored = true;
    } catch (error) { errors.push(`Restoring Sonos groups: ${error.message}`); }
  }
}

async function run(speakers, media, options, start, play) {
  if (!options.group && !options.resume && options.volume === undefined) {
    const errors = [];
    for (let i = 0; i < speakers.length; i += 4) {
      await Promise.all(speakers.slice(i, i + 4).map(async speaker => {
        try { await play(speaker, media); }
        catch (error) { errors.push(`${speaker.name}: ${error.message}`); }
      }));
    }
    start(errors.length ? new Error(`Announcement failed on ${errors.length} speaker(s): ${errors.join('; ')}`) : null);
    return;
  }
  const sessions = speakers.map(speaker => speaker.protocol === 'cast' ? new Cast(speaker) : new Dlna(speaker));
  const errors = [];
  let groups = [], started = false;
  try {
    for (const session of sessions) {
      try { await session.prepare(options); }
      catch (error) { session.failed = true; errors.push(`${session.speaker.name}: ${error.message}`); }
    }
    if (options.group) groups = await groupSonos(sessions.filter(session => !session.failed));
    for (const session of sessions) if (session.controlError) errors.push(`${session.speaker.name}: ${session.controlError}`);
    for (let i = 0; i < sessions.length; i += 4) {
      await Promise.all(sessions.slice(i, i + 4).map(async session => {
        if (session.failed) return;
        try {
          await session.setVolume();
          if (session.group && session !== session.group.coordinator) return;
          session.media = media;
          session.started = true;
          session.began = Date.now();
          if (session instanceof Cast) await session.play(media);
          else await play(session.speaker, media);
          session.launched = true;
        } catch (error) { session.failed = true; errors.push(`${session.speaker.name}: ${error.message}`); }
      }));
    }
    started = true;
    start(errors.length ? new Error(`Announcement failed on ${errors.length} speaker(s): ${errors.join('; ')}`) : null);
    const playing = sessions.filter(session => session.started && !session.failed);
    await Promise.all(playing.map(async session => {
      try {
        const duration = media.duration + (options.delay || 0);
        while (Date.now() - session.began < duration + 5000) {
          await sleep(1000);
          if (await session.ended(media)) {
            if (Date.now() - session.began < media.duration - 1000) session.interrupted = true;
            return;
          }
          if (Date.now() - session.began >= duration) return;
        }
      } catch (error) { errors.push(`${session.speaker.name}: ${error.message}`); }
    }));
  } catch (error) {
    errors.push(error.message);
  } finally {
    const cleanupErrors = [];
    for (const session of sessions) {
      try { await optional(() => session.restoreVolume()); }
      catch (error) {
        session.volumeRestoreFailed = true;
        cleanupErrors.push(`${session.speaker.name}: ${error.message}`);
      }
    }
    // A group created before a later join failed must also be rolled back.
    if (!groups.length) groups = [...new Set(sessions.map(session => session.group).filter(Boolean))];
    await restoreGroups(groups, options.resume || !started, cleanupErrors);
    for (const session of sessions) {
      for (const action of [
        () => !session.group && options.resume ? session.restoreMedia(!session.volumeRestoreFailed) : undefined,
        () => session.close()
      ]) {
        try { await optional(action); }
        catch (error) { cleanupErrors.push(`${session.speaker.name}: ${error.message}`); }
      }
    }
    if (!started) start(new Error(`Could not prepare the announcement: ${[...errors, ...cleanupErrors].join('; ')}`));
    if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '));
    if (errors.length && started) {
      // Start errors were already returned to the Flow; monitoring errors happen after that return.
      const monitoring = errors.filter(message => !sessions.some(session => session.failed && message.startsWith(`${session.speaker.name}:`)));
      if (monitoring.length) throw new Error(monitoring.join('; '));
    }
  }
}

class SpeakerControls {
  constructor(play, report) {
    this.play = play;
    this.report = report;
    this.tail = Promise.resolve();
  }

  start(speakers, media, options) {
    if (!speakers.length) return Promise.reject(new Error('No speakers are currently available.'));
    if ((options.group || options.resume || options.volume !== undefined) &&
      (!Number.isFinite(media.duration) || media.duration < 0)) return Promise.reject(new Error('Invalid announcement duration.'));
    let notify;
    const ready = new Promise((resolve, reject) => { notify = error => error ? reject(error) : resolve(); });
    this.tail = this.tail.then(() => run(speakers, media, options, notify, this.play)).catch(error => {
      notify(error);
      this.report(error);
    });
    return ready;
  }
}

module.exports = { SpeakerControls, soap, topology };
