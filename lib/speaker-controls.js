'use strict';

const fetch = require('node-fetch');

const topologyType = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1';
const xml = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const array = value => [].concat(value ?? []);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isSonosInput = uri => /^(?:x-sonos-htastream|x-rincon-stream):/i.test(uri);
const isSonosRadio = uri => /^(?:x-rincon-mp3radio|x-sonosapi-stream|x-sonosapi-radio):/i.test(uri);
const decodeXml = value => value.replace(/&(lt|gt|quot|apos|amp);/g, (_, key) =>
  ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[key]);

class Unsupported extends Error {}
class RestorationFailed extends Error {}

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
  if (String(code) === '401' || (action === 'Seek' && String(code) === '710')) throw new Unsupported(`${action} is not supported.`);
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
    members: array(group.ZoneGroupMember).flatMap(member => [
      { uuid: member['@_UUID'], hidden: member['@_Invisible'] === '1', channelMap: member['@_ChannelMapSet'] },
      ...array(member.Satellite).map(satellite => ({ uuid: satellite['@_UUID'], hidden: true, channelMap: satellite['@_ChannelMapSet'] }))
    ])
  }));
}

function uuid(speaker) { return speaker.id.replace(/^dlna:uuid:/, '').toUpperCase(); }

async function verifyOriginalSonosGroup(speaker, original) {
  const coordinator = uuid(speaker);
  const expected = new Set(original.members.map(member => member.uuid?.toUpperCase()));
  let matches = 0;
  let actual = new Set();
  for (let attempt = 0; attempt < 41; attempt++) {
    const groups = await topology(speaker);
    const active = groups.find(group => group.coordinator?.toUpperCase() === coordinator);
    actual = new Set(active?.members.map(member => member.uuid?.toUpperCase()));
    matches = actual.size === expected.size && [...expected].every(id => actual.has(id)) ? matches + 1 : 0;
    if (matches === 2) return;
    if (!matches && attempt < 40) await sleep(500);
  }
  const missing = [...expected].filter(id => !actual.has(id)).length;
  const extra = [...actual].filter(id => !expected.has(id)).length;
  throw new Error(`The original Sonos group could not be verified; playback was not resumed (${missing} missing, ${extra} extra).`);
}

function bondedMembers(originals, id) {
  const member = originals.flatMap(group => group.members).find(item => item.uuid?.toUpperCase() === id);
  if (!member?.channelMap) return [];
  return member.channelMap.split(';').map(entry => entry.split(':')[0].toUpperCase()).filter(Boolean);
}

async function waitForSonosJoin(group) {
  const coordinator = uuid(group.coordinator.speaker);
  const expected = new Set([coordinator, ...group.joined.map(session => uuid(session.speaker))]);
  for (const id of [...expected]) {
    for (const bonded of bondedMembers(group.originals, id)) expected.add(bonded);
  }
  const deadline = Date.now() + 8000;
  while (true) {
    for (const speaker of [group.coordinator.speaker, group.observer].filter(Boolean)) {
      const groups = await topology(speaker);
      const active = groups.find(item => item.coordinator?.toUpperCase() === coordinator);
      const members = new Set(active?.members.map(member => member.uuid?.toUpperCase()));
      if (![...expected].every(id => members.has(id))) continue;
      if (group.observer) {
        const state = await group.coordinator.current();
        if (/^x-rincon:/i.test(state.uri)) continue;
      }
      return;
    }
    if (Date.now() >= deadline) throw new Error('Sonos did not finish grouping all speakers.');
    await sleep(250);
  }
}

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
    let media, transport;
    for (let attempt = 0; ; attempt++) {
      media = await soap(this.speaker, 'GetMediaInfo');
      transport = await soap(this.speaker, 'GetTransportInfo');
      if (this.speaker.protocol !== 'sonos' || transport.CurrentTransportState !== 'TRANSITIONING') break;
      if (attempt === 20) throw new Error('Sonos playback is still changing; no new snapshot was taken.');
      await sleep(500);
    }
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
    const limit = this.speaker.maxVolume ?? 100;
    const maxSteps = limit < 100 ? Math.floor((max - min) * limit / (100 * step)) : Infinity;
    const steps = Math.round((max - min) * this.options.volume / (100 * step));
    this.appliedVolume = Math.min(max, min + Math.min(steps, maxSteps) * step);
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

  async verifyResumed(uri) {
    if (this.speaker.protocol !== 'sonos') return;
    for (let attempt = 0; ; attempt++) {
      const state = await this.current();
      if (state.uri !== uri) throw new Error('The Sonos source changed while playback was resuming.');
      if (state.state === 'PLAYING') return;
      if (attempt === 20) throw new Error('Sonos did not confirm that the original source resumed.');
      await sleep(500);
    }
  }

  async ended(media, elapsed) {
    if (!this.actions?.has('GetMediaInfo') || !this.actions.has('GetTransportInfo')) return elapsed >= media.duration;
    const state = await optional(() => this.current());
    if (!state) { this.actions.delete('GetTransportInfo'); return elapsed >= media.duration; }
    if (state.uri && state.uri !== media.url) { this.interrupted = true; this.external = true; return true; }
    if (state.state === 'ERROR_OCCURRED') throw new Error('The speaker could not play the announcement.');
    if (state.state === 'PLAYING') this.observedPlaying = true;
    if (state.state === 'PAUSED_PLAYBACK') {
      // Some DLNA renderers pause at EOF instead of reporting STOPPED.
      if (this.speaker.protocol !== 'dlna' || !this.observedPlaying || elapsed < media.duration - 1000) {
        this.interrupted = true;
      }
      return true;
    }
    if (['STOPPED', 'NO_MEDIA_PRESENT'].includes(state.state)) {
      if (this.observedPlaying || elapsed >= media.duration + (media.duration ? 3000 : 0)) return true;
    }
    return false;
  }

  async restoreMedia(resume, regrouping = false) {
    if (!this.original || !this.started || (this.interrupted && !regrouping)) return;
    const current = await this.current();
    if (!regrouping && current.uri && !this.ownedUrls?.has(current.uri)) return;
    const saved = this.original;
    await soap(this.speaker, 'SetAVTransportURI', { CurrentURI: saved.uri, CurrentURIMetaData: saved.metadata });
    if (saved.uri && !isSonosInput(saved.uri) && !isSonosRadio(saved.uri) &&
      this.actions.has('Seek') && saved.position) {
      let trackSupported = true;
      if (/^x-rincon-queue:/i.test(saved.uri) && Number(saved.position.Track) > 0) {
        trackSupported = await optional(() => soap(this.speaker, 'Seek', { Unit: 'TRACK_NR', Target: saved.position.Track })) !== null;
      }
      const time = saved.position.RelTime || '';
      if (trackSupported && /^\d+:\d{2}:\d{2}(?:\.\d+)?$/.test(time) && /[1-9]/.test(time)) {
        await optional(() => soap(this.speaker, 'Seek', { Unit: 'REL_TIME', Target: saved.position.RelTime }));
      }
    }
    if (resume && saved.uri && saved.state === 'PLAYING') {
      await soap(this.speaker, 'Play', { Speed: 1 });
      await this.verifyResumed(saved.uri);
    }
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

  async ended(media, elapsed) {
    if (this.disconnected) throw new Error('Google Cast disconnected during the announcement.');
    const status = await castCall(this.player, 'getStatus');
    if (status?.media?.contentId && status.media.contentId !== media.url) { this.interrupted = true; return true; }
    if (status?.idleReason === 'ERROR') throw new Error('Google Cast could not play the announcement.');
    if (status?.playerState === 'PAUSED') { this.interrupted = true; return true; }
    if (status?.playerState === 'PLAYING') this.observedPlaying = true;
    if (!status || status.playerState === 'IDLE') {
      return this.observedPlaying || elapsed >= media.duration + (media.duration ? 3000 : 0);
    }
    return false;
  }

  async restoreMedia(resume) {
    if (!resume || !this.original || !this.started || this.interrupted || this.disconnected) return;
    const current = await castCall(this.player, 'getStatus');
    if (current?.media?.contentId && !this.ownedUrls?.has(current.media.contentId)) return;
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
    session.original && session.actions.has('BecomeCoordinatorOfStandaloneGroup'))
    .sort((a, b) => Number(Boolean(b.speaker.stereo)) - Number(Boolean(a.speaker.stereo)));
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
    // A follower missing from this observer's topology must not be played
    // independently: setting its URI would detach it outside the restore plan.
    for (const session of household) {
      const owner = originals.find(group => group.members.some(member => member.uuid?.toUpperCase() === uuid(session.speaker)));
      const following = /^x-rincon:(.+)$/i.exec(session.original.uri)?.[1]?.toUpperCase();
      if (!owner || (following && following !== owner.coordinator?.toUpperCase())) {
        session.failed = true;
        session.controlError = 'Sonos reported conflicting group membership.';
      }
    }
    if (household.some(session => session.failed)) {
      for (const session of household) {
        session.failed = true;
        session.controlError ||= 'Sonos group membership could not be verified.';
      }
      continue;
    }
    // Never dismantle a group containing another visible room outside this announcement.
    if (originals.some(group => group.members.some(member => !member.hidden && !ids.has(member.uuid?.toUpperCase())))) {
      for (const session of household) {
        session.failed = true;
        session.controlError = 'A Sonos group includes a room that is not available for this announcement.';
      }
      continue;
    }
    if (household.length < 2) continue;
    const coordinators = household.filter(session => originals.some(group => group.coordinator?.toUpperCase() === uuid(session.speaker)));
    // Joining a bonded stereo primary to another coordinator can strand its secondary.
    const coordinator = coordinators.find(session => session.speaker.stereo) || coordinators[0];
    if (!coordinator) continue;
    const group = { coordinator, sessions: household, originals, joined: [] };
    grouped.push(group);
    let joining;
    try {
      const needsJoin = household.some(session => !originals.some(original =>
        original.coordinator?.toUpperCase() === uuid(coordinator.speaker) &&
        original.members.some(member => member.uuid?.toUpperCase() === uuid(session.speaker))));
      if (needsJoin && ['PLAYING', 'TRANSITIONING'].includes(coordinator.original.state)) {
        group.pauseAttempted = true;
        await soap(coordinator.speaker, 'Pause');
        const deadline = Date.now() + 3000;
        for (;;) {
          const state = await coordinator.current();
          if (state.uri !== coordinator.original.uri) throw new Error('The Sonos source changed before grouping.');
          if (['PAUSED_PLAYBACK', 'STOPPED'].includes(state.state)) break;
          if (Date.now() >= deadline) throw new Error('Sonos did not pause playback before grouping.');
          await sleep(250);
        }
      }
      for (const session of household) {
        session.group = group;
        if (session === coordinator) continue;
        const alreadyGrouped = originals.some(original => original.coordinator?.toUpperCase() === uuid(coordinator.speaker) &&
          original.members.some(member => member.uuid?.toUpperCase() === uuid(session.speaker)));
        if (alreadyGrouped) continue;
        joining = session;
        // A timeout does not establish that the receiver ignored the join.
        group.joined.push(session);
        await soap(session.speaker, 'SetAVTransportURI', {
          CurrentURI: `x-rincon:${uuid(coordinator.speaker)}`, CurrentURIMetaData: ''
        });
        await waitForSonosJoin(group);
      }
      group.complete = true;
    } catch (error) {
      const failures = [];
      await restoreGroups([group], true, failures);
      const rolledBack = (!group.joined.length && !group.pauseAttempted) || group.restored;
      for (const session of household) {
        session.group = undefined;
        if (!joining || session === joining || !rolledBack) {
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
    const initialErrorCount = errors.length;
    try {
      if (!group.joined.length && !group.coordinator.started) {
        if (group.pauseAttempted) {
          const state = await group.coordinator.current();
          if (state.uri === group.coordinator.original.uri && state.state === 'PAUSED_PLAYBACK') {
            const original = group.originals.find(item => item.coordinator?.toUpperCase() === uuid(group.coordinator.speaker));
            await verifyOriginalSonosGroup(group.coordinator.speaker, original);
            await soap(group.coordinator.speaker, 'Play', { Speed: 1 });
            await group.coordinator.verifyResumed(state.uri);
          }
          group.restored = true;
        }
        continue;
      }
      const current = await topology(group.coordinator.speaker);
      const active = current.find(item => item.coordinator?.toUpperCase() === uuid(group.coordinator.speaker));
      const expected = group.complete ? new Set(group.sessions.map(session => uuid(session.speaker))) :
        new Set([...group.originals.find(item => item.coordinator?.toUpperCase() === uuid(group.coordinator.speaker))
          .members.filter(member => !member.hidden).map(member => member.uuid?.toUpperCase()),
        ...group.joined.map(session => uuid(session.speaker))]);
      const actual = new Set(active?.members.filter(member => !member.hidden).map(member => member.uuid?.toUpperCase()));
      if (!actual.has(uuid(group.coordinator.speaker)) || [...actual].some(id => !expected.has(id))) continue;
      // Sonos can detach a room on its own. Accept its original coordinator,
      // but never send restore commands into a group with new members.
      const alreadyHome = new Set();
      const temporaryUri = `x-rincon:${uuid(group.coordinator.speaker)}`.toUpperCase();
      const followers = new Set();
      for (const session of group.joined) {
        const id = uuid(session.speaker);
        const contains = item => item.members.some(member => member.uuid?.toUpperCase() === id);
        if (actual.has(id)) continue;
        const state = await session.current();
        if (state.uri.toUpperCase() === temporaryUri) {
          followers.add(id);
          continue;
        }
        const original = group.originals.find(contains);
        const now = (await topology(session.speaker)).find(contains);
        if (original && now?.coordinator?.toUpperCase() === original.coordinator?.toUpperCase() &&
          now.members.every(member => original.members.some(saved => saved.uuid?.toUpperCase() === member.uuid?.toUpperCase()))) {
          alreadyHome.add(session);
        }
      }
      if (actual.size + alreadyHome.size + followers.size !== expected.size) {
        errors.push(`${group.coordinator.speaker.name}: could not reconcile Sonos group membership.`);
        continue;
      }
      let inputAlreadyRestored = false;
      let sourceUnknown = false;
      if (group.coordinator.launched) {
        try {
          const state = await group.coordinator.current();
          inputAlreadyRestored = isSonosInput(state.uri) && state.uri === group.coordinator.original?.uri;
          if (!inputAlreadyRestored && (group.coordinator.external ||
            (state.uri && !group.coordinator.ownedUrls?.has(state.uri)))) continue;
        } catch (error) {
          sourceUnknown = true;
          errors.push(`${group.coordinator.speaker.name}: could not verify the current source: ${error.message}`);
          if (group.coordinator.external) continue;
        }
      }
      const detached = new Set();
      const stagedInputs = new Set();
      for (const session of group.joined) {
        if (alreadyHome.has(session)) continue;
        try {
          await soap(session.speaker, 'BecomeCoordinatorOfStandaloneGroup');
          // A soundbar can clear its transport before the standalone topology settles.
          // Set the input to let topology settle, but defer Play until the original group is verified.
          const original = group.originals.find(item => item.coordinator?.toUpperCase() === uuid(session.speaker));
          if (isSonosInput(session.original?.uri) && original?.members.filter(member => !member.hidden).length === 1) {
            const state = await session.current();
            if (!state.uri || state.uri === session.original.uri || group.coordinator.ownedUrls?.has(state.uri)) {
              if (state.uri !== session.original.uri) await soap(session.speaker, 'SetAVTransportURI', {
                CurrentURI: session.original.uri, CurrentURIMetaData: session.original.metadata
              });
              stagedInputs.add(session);
            }
          }
          await waitForSonosJoin({ coordinator: session, joined: [], originals: group.originals,
            observer: group.coordinator.speaker });
          detached.add(session);
        } catch (error) {
          errors.push(`${session.speaker.name}: could not leave the temporary Sonos group: ${error.message}`);
        }
      }
      for (const original of group.originals) {
        const coordinator = group.sessions.find(session => uuid(session.speaker) === original.coordinator?.toUpperCase());
        if (!coordinator) continue;
        if (group.joined.includes(coordinator) && !detached.has(coordinator) && !alreadyHome.has(coordinator)) continue;
        try {
          const rejoined = [];
          for (const member of original.members.filter(member => !member.hidden)) {
            const session = group.sessions.find(item => uuid(item.speaker) === member.uuid?.toUpperCase());
            if (!session || session === coordinator || !detached.has(session)) continue;
            await soap(session.speaker, 'SetAVTransportURI', {
              CurrentURI: `x-rincon:${uuid(coordinator.speaker)}`, CurrentURIMetaData: ''
            });
            rejoined.push(session);
            await waitForSonosJoin({ coordinator, joined: rejoined, originals: group.originals });
          }
          if (stagedInputs.has(coordinator) || coordinator.started || detached.has(coordinator) || alreadyHome.has(coordinator) ||
            (coordinator === group.coordinator && group.pauseAttempted)) {
            await verifyOriginalSonosGroup(coordinator.speaker, original);
          }
          const shouldResume = (resume || !group.coordinator.launched) &&
            !original.members.some(member => group.sessions.some(session =>
              uuid(session.speaker) === member.uuid?.toUpperCase() && session.volumeRestoreFailed));
          if (stagedInputs.has(coordinator)) {
            const state = await coordinator.current();
            if (shouldResume && coordinator.original.state === 'PLAYING' && state.uri === coordinator.original.uri) {
              if (['PAUSED_PLAYBACK', 'STOPPED'].includes(state.state)) await soap(coordinator.speaker, 'Play', { Speed: 1 });
              await coordinator.verifyResumed(state.uri);
            }
          // Rejoining after a seek can reset the track position.
          } else if ((coordinator.started || detached.has(coordinator) || alreadyHome.has(coordinator) ||
            (coordinator === group.coordinator && group.pauseAttempted)) &&
            !(coordinator === group.coordinator && (sourceUnknown || inputAlreadyRestored))) {
            if (alreadyHome.has(coordinator)) {
              const state = await coordinator.current();
              if (state.uri === coordinator.original?.uri && state.state === coordinator.original.state) continue;
              if (state.uri && state.uri !== coordinator.original?.uri && !group.coordinator.ownedUrls?.has(state.uri)) continue;
            }
            coordinator.started = true;
            coordinator.media = group.coordinator.media;
            await coordinator.restoreMedia(shouldResume && (!group.coordinator.interrupted || inputAlreadyRestored), true);
          }
        } catch (error) { errors.push(`${coordinator.speaker.name}: restoring Sonos playback: ${error.message}`); }
      }
      group.restored = detached.size + alreadyHome.size === group.joined.length && errors.length === initialErrorCount;
    } catch (error) { errors.push(`Restoring Sonos groups: ${error.message}`); }
  }
}

async function safeSonosTargets(speakers, { excludedSonos = [], restrictSonosToTargets }) {
  const excludedIds = new Set(excludedSonos.map(uuid));
  const selectedIds = new Set(speakers.filter(speaker => speaker.protocol === 'sonos').map(uuid));
  const safeRooms = new Map();
  const targets = [];
  for (const speaker of speakers) {
    if (speaker.protocol !== 'sonos') {
      targets.push(speaker);
      continue;
    }
    const id = uuid(speaker);
    if (!safeRooms.has(id)) {
      if (!speaker.topology) throw new Error(`Could not verify Sonos group membership for ${speaker.name}.`);
      for (const group of await topology(speaker)) {
        const safe = !group.members.some(member => {
          const memberId = member.uuid?.toUpperCase();
          return excludedIds.has(memberId) || (restrictSonosToTargets && !member.hidden && !selectedIds.has(memberId));
        });
        for (const member of group.members) safeRooms.set(member.uuid?.toUpperCase(), safe);
      }
      if (!safeRooms.has(id)) throw new Error(`Sonos group membership is missing for ${speaker.name}.`);
    }
    if (safeRooms.get(id)) targets.push(speaker);
  }
  return targets;
}

function speakerVolume(speaker, base) {
  if (base === undefined) return undefined;
  return Math.max(0, Math.min(speaker.maxVolume ?? 100, base + (speaker.volumeOffset ?? 0)));
}

async function run(speakers, media, options, start, play, takeNext) {
  if (options.excludedSonos?.length || options.restrictSonosToTargets) {
    // Playing on an included group coordinator can also play on an excluded room.
    speakers = await safeSonosTargets(speakers, options);
    if (!speakers.length) throw new Error(options.restrictSonosToTargets
      ? 'No selected speakers can play without including other Sonos rooms.'
      : 'No speakers are available outside the excluded Sonos groups.');
  }
  if (!options.group && !options.resume && options.volume === undefined) {
    const errors = [];
    for (let i = 0; i < speakers.length; i += 4) {
      await Promise.all(speakers.slice(i, i + 4).map(async speaker => {
        try { await play(speaker, media); }
        catch (error) { errors.push(`${speaker.name}: ${error.message}`); }
      }));
    }
    start(errors.length ? new Error(`Announcement failed on ${errors.length} speaker(s): ${errors.join('; ')}`) : null);
    if (Number.isFinite(media.duration) && media.duration + (options.delay || 0) > 0) {
      await sleep(media.duration + (options.delay || 0));
    }
    return;
  }
  const sessions = speakers.map(speaker => speaker.protocol === 'cast' ? new Cast(speaker) : new Dlna(speaker));
  const errors = [];
  let groups = [], started = false;
  try {
    for (let i = 0; i < sessions.length; i += 4) {
      await Promise.all(sessions.slice(i, i + 4).map(async session => {
        try { await session.prepare({ ...options, volume: speakerVolume(session.speaker, options.volume) }); }
        catch (error) { session.failed = true; errors.push(`${session.speaker.name}: ${error.message}`); }
      }));
    }
    if (options.group) groups = await groupSonos(sessions.filter(session => !session.failed));
    for (const session of sessions) if (session.controlError) errors.push(`${session.speaker.name}: ${session.controlError}`);
    let first = true;
    do {
      for (let i = 0; i < sessions.length; i += 4) {
        await Promise.all(sessions.slice(i, i + 4).map(async session => {
          if (session.failed) return;
          try {
            if (first) await session.setVolume();
            if (session.group && session !== session.group.coordinator) return;
            session.media = media;
            session.ownedUrls ||= new Set();
            session.ownedUrls.add(media.url);
            session.started = true;
            session.observedPlaying = false;
            if (session instanceof Cast) await session.play(media);
            else await play(session.speaker, media);
            session.began = Date.now();
            session.launched = true;
          } catch (error) { session.failed = true; errors.push(`${session.speaker.name}: ${error.message}`); }
        }));
      }
      started = true;
      start(errors.length ? new Error(`Announcement failed on ${errors.length} speaker(s): ${errors.join('; ')}`) : null);
      const playing = sessions.filter(session => session.started && !session.failed);
      await Promise.all(playing.map(async session => {
        try {
          const deadline = media.duration + 30000;
          while (Date.now() - session.began < deadline) {
            await sleep(1000);
            const elapsed = Date.now() - session.began;
            if (await session.ended(media, elapsed)) {
              if (elapsed < media.duration - 1000) session.interrupted = true;
              if (!session.interrupted && options.delay) await sleep(options.delay);
              return;
            }
          }
          throw new Error('The speaker did not finish the announcement in time.');
        } catch (error) { errors.push(`${session.speaker.name}: ${error.message}`); }
      }));
      if (errors.length || sessions.some(session => session.interrupted)) break;
      const next = await takeNext(speakers, options, groups);
      if (!next) break;
      media = next.media;
      options = next.options;
      start = next.notify;
      first = false;
    } while (true);
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
    if (cleanupErrors.length) throw new RestorationFailed(cleanupErrors.join('; '));
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
    this.queue = [];
    this.running = false;
  }

  start(speakers, media, options) {
    if (!speakers.length) return Promise.reject(new Error('No speakers are currently available.'));
    if ((options.group || options.resume || options.volume !== undefined) &&
      (!Number.isFinite(media.duration) || media.duration < 0)) return Promise.reject(new Error('Invalid announcement duration.'));
    let notify;
    const ready = new Promise((resolve, reject) => { notify = error => error ? reject(error) : resolve(); });
    this.queue.push({ speakers, media, options, notify });
    if (!this.running) {
      this.running = true;
      this.tail = Promise.resolve().then(async () => {
        try {
          while (this.queue.length) {
            const job = this.queue.shift();
            try {
              await run(job.speakers, job.media, job.options, job.notify, this.play, this.takeNext.bind(this));
            } catch (error) {
              job.notify(error);
              if (error instanceof RestorationFailed) {
                for (const queued of this.queue.splice(0)) {
                  queued.notify(new Error('Announcement skipped because previous speaker playback could not be restored.'));
                }
              }
              this.report(error);
            }
          }
        } finally { this.running = false; }
      });
    }
    return ready;
  }

  async takeNext(speakers, options, groups) {
    const next = this.queue[0];
    const excluded = options.excludedSonos ?? [];
    const nextExcluded = next?.options.excludedSonos ?? [];
    if (!next || next.speakers.length !== speakers.length ||
      next.options.group !== options.group || next.options.resume !== options.resume ||
      next.options.volume !== options.volume ||
      Boolean(next.options.restrictSonosToTargets) !== Boolean(options.restrictSonosToTargets) ||
      excluded.length !== nextExcluded.length || !excluded.every(speaker => nextExcluded.some(other => other.id === speaker.id)) ||
      !speakers.every(speaker => next.speakers.some(other => other.id === speaker.id &&
        speakerVolume(other, next.options.volume) === speakerVolume(speaker, options.volume) &&
        (options.volume === undefined || (other.maxVolume ?? 100) === (speaker.maxVolume ?? 100))))) return;
    if (nextExcluded.length || next.options.restrictSonosToTargets) {
      try {
        if ((await safeSonosTargets(next.speakers, next.options)).length !== speakers.length) return;
      } catch (error) {
        // This check belongs to the queued announcement, not the one already playing.
        this.queue.shift();
        next.notify(error);
        return;
      }
    }
    for (const group of groups) {
      const current = await topology(group.coordinator.speaker);
      const active = current.find(item => item.coordinator?.toUpperCase() === uuid(group.coordinator.speaker));
      const actual = new Set(active?.members.filter(member => !member.hidden).map(member => member.uuid?.toUpperCase()));
      const expected = new Set(group.sessions.map(session => uuid(session.speaker)));
      if (actual.size !== expected.size || [...expected].some(id => !actual.has(id))) return;
    }
    return this.queue.shift();
  }
}

module.exports = { SpeakerControls, soap, topology };
