'use strict';

const { isIPv4 } = require('net');
const fetch = require('node-fetch');
const { isSavedGroup } = require('./speaker-groups');
const readSoapBody = require('./speaker-soap');

const renderer = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const zonePlayer = 'urn:schemas-upnp-org:device:ZonePlayer:1';
const avTransport = /^urn:schemas-upnp-org:service:AVTransport:\d+$/;
const zoneTopology = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1';
const searchMs = 2200;
const cacheMs = 30000;
const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[char]);
const asArray = value => [].concat(value ?? []);
const speakerId = uuid => `dlna:uuid:${uuid.toLowerCase()}`;
const sonosId = /^dlna:uuid:rincon_[0-9a-f]{12}\d{5}$/;
const sonosAddressesKey = 'AnnouncementSonosAddresses';
const speakerCatalogKey = 'AnnouncementSpeakerCatalog';
const speakerLabels = { cast: 'Google Cast', dlna: 'UPnP / DLNA', sonos: 'Sonos' };
const isSpeakerConnectionError = error => ['system', 'request-timeout', 'body-timeout'].includes(error?.type) ||
  /^(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|SONOS_CONNECTION)$/.test(error?.code ?? '');
const speakerGroups = new Set(['all', 'all_no_tvs', 'all_no_tv_speakers']);
const pickerLabels = {
  stereo: 'Stereo', left: 'Left', right: 'Right', all: 'All speakers',
  all_help: 'All currently discoverable speakers',
  all_no_tvs: 'All speakers (no TVs)', all_no_tvs_help: 'Skip recognized TVs and video Cast receivers',
  all_no_tv_speakers: 'All speakers (no TVs or TV speakers)',
  all_no_tv_speakers_help: 'Also skip recognized soundbars and home theater speakers',
  saved_group: 'Saved speaker group'
};

function isTvSpeaker(value) {
  return /\b(?:sound[\s-]*bar|home[\s-]+theat(?:er|re))\b/i.test(value);
}

function isTv(value) {
  return /\b(?:television|smart[\s-]*tv|android[\s-]+tv|google[\s-]+tv|hdtv|dtv|bravia|qled|samsung tv)\b|^\s*(?:\[TV\]|TV\b)|\bTV\s*$/i.test(value);
}

function castKind(model, capabilities, name) {
  if (isTvSpeaker(model)) return 'tvSpeaker';
  // Cast's mDNS capability mask uses bit 0 for video output.
  if ((Number(capabilities) & 1) || isTv(model)) return 'tv';
  if ((capabilities == null || !/^\d+$/.test(capabilities)) &&
    /^(?:chromecast(?: (?:hd|ultra))?|eureka dongle|(?:google )?nest hub(?: max)?)$/i.test(String(model).trim())) return 'tv';
  if (isTvSpeaker(name)) return 'tvSpeaker';
  if (isTv(name)) return 'tv';
}

function rendererKind(item, transport, sonos) {
  if (sonos) {
    return /^(?:Sonos\s+)?(?:Arc(?: Ultra| SL)?|Beam(?: \(Gen [12]\))?|Ray|Playbar|Playbase|Amp)$/i.test(String(item.modelName).trim())
      ? 'tvSpeaker' : undefined;
  }
  const devices = [...new Set([item, transport])];
  const product = devices.flatMap(device => [device.modelName, device.modelDescription]);
  if (product.some(isTvSpeaker)) return 'tvSpeaker';
  if (product.some(isTv) || devices.some(device =>
    /:device:(?:tvdevice|television|maintvserver):\d+$/i.test(device.deviceType))) return 'tv';
  const names = devices.map(device => device.friendlyName);
  if (names.some(isTvSpeaker)) return 'tvSpeaker';
  if (names.some(isTv)) return 'tv';
}

function isLan(ip) {
  return isIPv4(ip) && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip);
}

function deviceUrl(value, host, base) {
  const url = new URL(value, base);
  if (url.protocol !== 'http:' || url.hostname !== host || url.username || url.password) {
    throw new Error('The DLNA speaker advertised an unsupported address.');
  }
  return url.href;
}

async function discoverCast() {
  const { Bonjour } = require('bonjour-service');
  return new Promise((resolve, reject) => {
    const speakers = new Map();
    let timer;
    let browser;
    let done = false;
    const bonjour = new Bonjour({}, error => finish(error));
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      browser?.stop();
      bonjour.destroy();
      if (error) reject(error);
      else resolve([...speakers.values()]);
    }
    browser = bonjour.find({ type: 'googlecast' }, service => {
      const host = service.addresses?.find(isLan);
      const { id, fn, md, ca } = service.txt || {};
      if (!host || typeof id !== 'string' || !id || !Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return;
      const name = typeof fn === 'string' && fn.trim() ? fn : service.name;
      if (typeof name !== 'string' || !name.trim()) return;
      speakers.set(id, { id: `cast:${id}`, name, host, port: service.port, protocol: 'cast', kind: castKind(md, ca, name) });
    });
    timer = setTimeout(finish, searchMs);
  });
}

function discoverRenderers() {
  return new Promise((resolve, reject) => {
    const socket = require('dgram').createSocket('udp4');
    const devices = new Map();
    let done = false;
    const timer = setTimeout(finish, searchMs);
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve([...devices.values()]);
    }
    socket.on('error', finish);
    socket.on('message', (message, remote) => {
      if (!isLan(remote.address) || message.length > 8192 || devices.size >= 24) return;
      const text = message.toString();
      if (!/^HTTP\/1\.[01] 200\b/.test(text)) return;
      const id = /^USN:\s*(uuid:[^:\r\n]+)::/im.exec(text)?.[1];
      const location = /^LOCATION:\s*(https?:\/\/[^\s]+)/im.exec(text)?.[1];
      if (!id || !location || devices.has(id.toLowerCase())) return;
      try {
        const key = id.toLowerCase();
        devices.set(key, { id: `dlna:${key}`, host: remote.address, location: deviceUrl(location, remote.address) });
      } catch {
        // Ignore advertisements that point away from the responding device.
      }
    });
    for (const target of [renderer, zonePlayer, 'urn:schemas-upnp-org:service:AVTransport:1']) {
      const query = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ${target}\r\n\r\n`;
      socket.send(query, 1900, '239.255.255.250', error => { if (error && error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') finish(error); });
    }
  });
}

function findTransport(device, matchesDevice) {
  if (device && matchesDevice(device)) {
    const service = device.serviceList?.service?.find(item =>
      typeof item?.serviceType === 'string' && avTransport.test(item.serviceType) && typeof item.controlURL === 'string');
    if (service) return { device, service };
  }
  for (const child of device?.deviceList?.device || []) {
    const transport = findTransport(child, matchesDevice);
    if (transport) return transport;
  }
}

async function describeRenderer(device, timeout = 2000, verifyIdentity = false) {
  const response = await fetch(device.location, { redirect: 'error', timeout, size: 128 * 1024 });
  if (!response.ok) throw new Error(`DLNA description returned HTTP ${response.status}.`);
  const { XMLParser } = require('fast-xml-parser');
  const { root } = new XMLParser({ removeNSPrefix: true, processEntities: false, parseTagValue: false,
    isArray: (tag, path) => tag === 'service' || path.endsWith('.deviceList.device') }).parse(await response.text());
  const item = root?.device;
  const sonos = item?.deviceType === zonePlayer && /^Sonos\b/i.test(item.manufacturer);
  const transport = findTransport(item, candidate => sonos || candidate === item ||
    (typeof candidate.UDN === 'string' && `dlna:${candidate.UDN.toLowerCase()}` === device.id));
  const udn = transport?.device.UDN;
  if (verifyIdentity && (typeof udn !== 'string' || `dlna:${udn.toLowerCase()}` !== device.id)) {
    throw new Error('DLNA renderer identity not verified.');
  }
  const service = transport?.service;
  const name = sonos ? item.roomName || item.friendlyName : transport?.device.friendlyName;
  if (!service?.controlURL || typeof name !== 'string' || !name.trim()) {
    throw new Error('No named DLNA AVTransport renderer found.');
  }
  const base = root.URLBase ? deviceUrl(root.URLBase, device.host, device.location) : device.location;
  const rootId = typeof item.UDN === 'string' && /^uuid:[a-z0-9_-]+$/i.test(item.UDN)
    ? `dlna:${item.UDN.toLowerCase()}` : device.id;
  const speaker = { ...device, id: sonos ? rootId : device.id, name, endpoint: deviceUrl(service.controlURL, device.host, base),
    service: service.serviceType, protocol: sonos ? 'sonos' : 'dlna', aliases: [device.id],
    kind: rendererKind(item, transport.device, sonos) };
  if (!sonos && /^Microsoft(?: Corporation)?$/i.test(transport.device.manufacturer || item.manufacturer) &&
      (transport.device.modelName || item.modelName) === 'Windows Digital Media Renderer') speaker.windowsRenderer = true;
  try {
    if (service.SCPDURL) speaker.scpd = deviceUrl(service.SCPDURL, device.host, base);
  } catch {
    // Invalid optional descriptions must not hide an otherwise playable renderer.
  }
  const rendering = transport.device.serviceList?.service?.find(item =>
    /^urn:schemas-upnp-org:service:RenderingControl:\d+$/.test(item.serviceType) && item.controlURL);
  if (rendering) {
    try {
      const scpd = rendering.SCPDURL && deviceUrl(rendering.SCPDURL, device.host, base);
      speaker.rendering = { endpoint: deviceUrl(rendering.controlURL, device.host, base), service: rendering.serviceType, scpd };
    } catch {
      // An invalid optional volume service does not prevent normal playback.
    }
  }
  if (sonos) {
    if (typeof item.modelName === 'string') speaker.model = item.modelName.trim();
    const topology = item.serviceList?.service?.find(item => item.serviceType === zoneTopology);
    if (topology?.controlURL) {
      try {
        speaker.topology = deviceUrl(topology.controlURL, device.host, base);
      } catch {
        // An invalid optional topology endpoint must not hide a playable speaker.
        speaker.invalidTopology = true;
      }
    }
  }
  return speaker;
}

async function readSonosMembers(speaker, timeout = 1500) {
  const action = 'GetZoneGroupState';
  const response = await fetch(speaker.topology, {
    method: 'POST', redirect: 'error', timeout, size: 256 * 1024,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${zoneTopology}#${action}"` },
    body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="${zoneTopology}"/></s:Body></s:Envelope>`
  });
  if (!response.ok) {
    response.body?.destroy();
    throw new Error(`Sonos topology returned HTTP ${response.status}.`);
  }
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, processEntities: false, parseTagValue: false });
  const state = readSoapBody(await response.text())?.GetZoneGroupStateResponse?.ZoneGroupState;
  if (typeof state !== 'string') throw new Error('Sonos did not return zone topology.');
  // SOAP returns the topology as escaped XML, not as child elements.
  const topology = state.replace(/&(lt|gt|quot|apos|amp);/g, (_, key) => ({
    lt: '<', gt: '>', quot: '"', apos: "'", amp: '&'
  })[key]);
  const groups = parser.parse(topology)?.ZoneGroupState?.ZoneGroups;
  if (groups == null) throw new Error('Sonos returned invalid zone topology.');
  return asArray(groups.ZoneGroup).flatMap(group =>
    asArray(group.ZoneGroupMember).flatMap(member => [
      member, ...asArray(member.Satellite).map(satellite => ({ ...satellite, '@_Invisible': '1' }))
    ]));
}

function readStereoPair(speaker, members) {
  const primary = members.find(member =>
    typeof member['@_UUID'] === 'string' && speakerId(member['@_UUID']) === speaker.id);
  if (primary?.['@_Invisible'] === '1') return { hidden: true };
  const channelMap = primary?.['@_ChannelMapSet'];
  if (!primary || ![undefined, '0'].includes(primary['@_Invisible']) || typeof channelMap !== 'string') return;
  const entries = channelMap.split(';').filter(Boolean);
  if (entries.length !== 2) return;
  const pair = {};
  for (const entry of entries) {
    const channel = /^(RINCON_[a-z0-9_]+):(LF|RF)(?:,\2)*$/i.exec(entry);
    if (channel) pair[channel[2].toUpperCase() === 'LF' ? 'left' : 'right'] = speakerId(channel[1]);
  }
  const secondary = pair.left === speaker.id ? pair.right : pair.right === speaker.id ? pair.left : undefined;
  if (secondary && secondary !== speaker.id && members.some(member => member['@_Invisible'] === '1' &&
    typeof member['@_UUID'] === 'string' && speakerId(member['@_UUID']) === secondary)) return { ...pair, secondary };
}

async function discoverDlna(log, observe) {
  const renderers = await discoverRenderers();
  const speakers = [];
  for (let i = 0; i < renderers.length; i += 8) {
    const batch = await Promise.allSettled(renderers.slice(i, i + 8).map(device => describeRenderer(device)));
    for (const result of batch) {
      if (result.status === 'fulfilled') speakers.push(result.value);
      else log('Could not read a DLNA renderer description:', result.reason.message);
    }
  }
  const unique = new Map();
  for (const speaker of speakers) {
    const existing = unique.get(speaker.id);
    if (existing) existing.aliases.push(...speaker.aliases);
    else unique.set(speaker.id, speaker);
  }
  const sonos = [...unique.values()].filter(speaker => speaker.protocol === 'sonos');
  const topologies = new Map();
  for (let i = 0; i < sonos.length; i += 8) {
    const batch = await Promise.all(sonos.slice(i, i + 8).map(async speaker => {
      if (speaker.invalidTopology) log('Ignoring a Sonos topology endpoint with an unsupported address.');
      if (!speaker.topology) return;
      try {
        return [speaker.id, await readSonosMembers(speaker)];
      } catch (error) {
        log('Could not read Sonos stereo topology:', error.message);
      }
    }));
    for (const result of batch.filter(Boolean)) topologies.set(...result);
  }
  // A reachable room can miss SSDP replies but still be listed by its Sonos household.
  const missing = new Map();
  for (const members of topologies.values()) {
    for (const member of members) {
      const uuid = member['@_UUID'];
      const location = member['@_Location'];
      if (member['@_Invisible'] === '1' || member['@_IsZoneBridge'] === '1' ||
        typeof uuid !== 'string' || !/^RINCON_[a-z0-9_]+$/i.test(uuid) || typeof location !== 'string') continue;
      const id = speakerId(uuid);
      if (unique.has(id) || missing.has(id) || missing.size >= 24) continue;
      const match = /^http:\/\/([\d.]+):1400\/xml\/device_description\.xml$/.exec(location);
      if (match && isLan(match[1])) missing.set(id, { members, device: { id, host: match[1], location } });
    }
  }
  const candidates = [...missing.values()];
  for (let i = 0; i < candidates.length; i += 8) {
    await Promise.all(candidates.slice(i, i + 8).map(async ({ members, device }) => {
      try {
        const speaker = await describeRenderer(device);
        if (speaker.protocol !== 'sonos' || speaker.id !== device.id) {
          throw new Error('The Sonos room description does not match the household topology.');
        }
        unique.set(speaker.id, speaker);
        topologies.set(speaker.id, members);
      } catch (error) {
        log('Could not read a Sonos household room description:', error.message);
      }
    }));
  }
  const pairs = [...topologies].flatMap(([id, members]) => {
    const speaker = unique.get(id);
    const pair = readStereoPair(speaker, members);
    return pair ? [{ speaker, pair }] : [];
  });
  for (const { speaker, pair } of pairs) {
    if (pair.hidden) continue;
    // Keep individual entries if competing topology reports claim the same device.
    if (pairs.some(other => !other.pair.hidden && other.speaker !== speaker &&
      (other.pair.secondary === pair.secondary || other.pair.secondary === speaker.id || other.speaker.id === pair.secondary))) continue;
    const secondary = unique.get(pair.secondary);
    if (secondary && secondary.protocol !== 'sonos') continue;
    speaker.stereo = { left: unique.get(pair.left)?.model, right: unique.get(pair.right)?.model };
    speaker.aliases.push(pair.secondary, ...(secondary?.aliases || []));
    unique.delete(pair.secondary);
  }
  for (const { speaker, pair } of pairs) {
    if (pair.hidden) unique.delete(speaker.id);
  }
  const visible = [];
  const hidden = new Set();
  for (const members of topologies.values()) {
    for (const member of members) {
      if (typeof member['@_UUID'] === 'string' &&
          (member['@_Invisible'] === '1' || member['@_IsZoneBridge'] === '1')) hidden.add(speakerId(member['@_UUID']));
    }
  }
  for (const speaker of unique.values()) {
    if (topologies.get(speaker.id)?.some(member => typeof member['@_UUID'] === 'string' &&
        speakerId(member['@_UUID']) === speaker.id) && !hidden.has(speaker.id)) visible.push(speaker);
  }
  observe(visible, hidden);
  return [...unique.values()];
}

function playCast(speaker, media) {
  const { Client, DefaultMediaReceiver } = require('castv2-client');
  return new Promise((resolve, reject) => {
    const client = new Client();
    let done = false;
    const timer = setTimeout(() => finish(new Error('Google Cast did not respond.')), 8000);
    function finish(error, disconnected = false) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!disconnected) client.close();
      if (error) reject(new Error('Could not start the announcement on the Google Cast speaker.'));
      else resolve();
    }
    client.on('error', finish);
    client.on('close', () => finish(new Error('Google Cast disconnected.'), true));
    client.connect({ host: speaker.host, port: speaker.port }, () => {
      if (done) return;
      client.launch(DefaultMediaReceiver, (error, player) => {
        if (error || done) return finish(error);
        player.load({ contentId: media.url, contentType: media.type, streamType: 'BUFFERED' },
          { autoplay: true }, error => finish(error));
      });
    });
  });
}

async function playDlna(speaker, media) {
  const mediaClass = /^video\//i.test(media.type) ? 'object.item.videoItem'
    : /^image\//i.test(media.type) ? 'object.item.imageItem.photo' : 'object.item.audioItem.musicTrack';
  const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>Google Services announcement</dc:title><upnp:class>${mediaClass}</upnp:class><res protocolInfo="http-get:*:${escapeXml(media.type)}:*">${escapeXml(media.url)}</res></item></DIDL-Lite>`;
  for (const [action, args] of [
    ['SetAVTransportURI', `<CurrentURI>${escapeXml(media.url)}</CurrentURI><CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>`],
    ['Play', '<Speed>1</Speed>']
  ]) {
    const response = await fetch(speaker.endpoint, {
      method: 'POST', redirect: 'error', timeout: 5000, size: 512 * 1024,
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${speaker.service}#${action}"` },
      body: `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${speaker.service}"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`
    }).catch(error => {
      // Only a failed TCP connect proves this write never reached the room.
      if (action === 'SetAVTransportURI' && error.syscall === 'connect' && isSpeakerConnectionError(error)) {
        error.beforePlayback = true;
      }
      throw error;
    });
    const body = readSoapBody(await response.text());
    const code = body?.Fault?.detail?.UPnPError?.errorCode;
    if (!response.ok || body?.Fault) {
      throw new Error(`${speaker.protocol === 'sonos' ? 'Sonos' : 'DLNA'} speaker rejected ${action} (HTTP ${response.status}${/^\d+$/.test(code) ? `, UPnP ${code}` : ''}).`);
    }
    if (body?.[`${action}Response`] === undefined) throw new Error(`The speaker did not return ${action}.`);
  }
}

class SpeakerPlayback {
  static isSpeakerGroup(id) { return speakerGroups.has(id) || isSavedGroup(id); }

  constructor(log, translate = key => pickerLabels[key], report = error => log('Restoring speaker state failed:', error.message), groups = () => [], settings) {
    this.log = log;
    this.translate = translate;
    this.report = report;
    this.groups = groups;
    this.settings = settings;
    this.sonosEndpoints = new Map();
    this.sonosChecks = new Map();
    this.sonosRevision = 0;
  }

  updateSonosEndpoint(id, room, revision, failedHost) {
    const previous = this.sonosEndpoints.get(id);
    if (previous?.revision > revision) {
      if (!room || !previous.failedHost || previous.failedHost === room.host) return;
      revision = previous.revision;
    }
    this.sonosEndpoints.delete(id);
    this.sonosEndpoints.set(id, { room, revision, failedHost });
    if (this.sonosEndpoints.size > 100) this.sonosEndpoints.delete(this.sonosEndpoints.keys().next().value);
  }

  refreshInBackground(force = false) {
    if (this.pending || Date.now() - (this.lastScanStarted ?? -Infinity) < (force ? searchMs : cacheMs) ||
        (!force && this.recentSpeakers())) return;
    void this.refresh().catch(error => this.log('Background speaker discovery failed:', error.message));
  }

  invalidateSonosEndpoint(room, error) {
    if (room.protocol !== 'sonos' || !isSpeakerConnectionError(error)) return;
    const current = this.sonosEndpoints.get(room.id)?.room;
    if (current === room) this.updateSonosEndpoint(room.id, null, ++this.sonosRevision, room.host);
    this.refreshInBackground(true);
  }

  async rediscoverSonosEndpoint(room, error) {
    if (!isSpeakerConnectionError(error)) return;
    this.invalidateSonosEndpoint(room, error);
    const updated = () => this.sonosEndpoints.get(room.id)?.room;
    const current = updated();
    if (current && current !== room) return current;
    try { await this.refresh(); }
    catch (error) { this.log('Sonos announcement rediscovery failed:', error.message); }
    const found = updated();
    if (found && found !== room) return found;
    this.log('Could not rediscover the Sonos room before playback:', room.name);
  }

  knownSonosAddresses() {
    const records = this.sonosAddresses ?? this.settings?.get?.(sonosAddressesKey);
    return Array.isArray(records) ? records.slice(0, 100).filter(record =>
      typeof record?.id === 'string' && sonosId.test(record.id) && isLan(record.host)) : [];
  }

  async rememberSonosAddresses(speakers) {
    const known = this.knownSonosAddresses();
    const current = speakers.filter(speaker => speaker.protocol === 'sonos' && sonosId.test(speaker.id) && isLan(speaker.host))
      .map(({ id, host, aliases }) => ({ id, host, aliases: [...new Set((aliases ?? []).filter(alias => alias !== id && sonosId.test(alias)))].sort() }));
    if (!current.length) return;
    const ids = new Set(current.flatMap(speaker => [speaker.id, ...speaker.aliases]));
    const next = [...current, ...known.filter(speaker => !ids.has(speaker.id))].slice(0, 100)
      .sort((a, b) => a.id.localeCompare(b.id));
    this.sonosAddresses = next;
    if (JSON.stringify(next) !== JSON.stringify(known)) {
      try { await this.settings?.set?.(sonosAddressesKey, next); }
      catch (error) { this.log('Could not save Sonos announcement addresses:', error.message); }
    }
  }

  async verifyKnownSonos(ids) {
    if (!ids.length || !ids.every(id => sonosId.test(id))) return;
    const known = this.knownSonosAddresses();
    const records = ids.map(id => known.find(speaker => speaker.id === id) ??
      known.find(speaker => Array.isArray(speaker.aliases) && speaker.aliases.includes(id)));
    if (records.some(record => !record)) return;
    const targets = [];
    const unique = [...new Set(records)];
    for (let i = 0; i < unique.length; i += 8) {
      const verified = await Promise.all(unique.slice(i, i + 8).map(record => this.verifySonosAddress(record)));
      if (verified.some(room => !room)) return;
      targets.push(...verified);
    }
    if (ids.every(id => targets.some(room => room.id === id || room.aliases.includes(id)))) return targets;
  }

  verifySonosAddress({ id, host }) {
    const key = `${id}@${host}`;
    if (this.sonosChecks.has(key)) return this.sonosChecks.get(key);
    const revision = ++this.sonosRevision;
    const check = (async () => {
      try {
        const room = await describeRenderer({ id, host, location: `http://${host}:1400/xml/device_description.xml` }, 800);
        if (room.protocol !== 'sonos' || room.id !== id || !room.topology) throw new Error('Room identity not verified.');
        const members = await readSonosMembers(room, 800);
        const own = members.find(member => typeof member['@_UUID'] === 'string' && speakerId(member['@_UUID']) === id);
        const pair = readStereoPair(room, members);
        if (!own || pair?.hidden || own['@_IsZoneBridge'] === '1') throw new Error('Room is not a visible Sonos target.');
        room.aliases = pair?.secondary ? [pair.secondary] : [];
        this.updateSonosEndpoint(id, room, revision);
        return room;
      } catch (error) {
        if (this.sonosEndpoints.get(id)?.room?.host === host) this.updateSonosEndpoint(id, null, revision, host);
        this.log('Checking the saved Sonos address failed; rediscovering speakers:', error.message);
      }
    })().finally(() => this.sonosChecks.delete(key));
    this.sonosChecks.set(key, check);
    return check;
  }

  async refresh() {
    if (!this.pending) {
      this.lastScanStarted = Date.now();
      const revision = ++this.sonosRevision;
      this.pending = Promise.allSettled([discoverCast(), discoverDlna(this.log, (visible, hidden) => {
        for (const id of hidden) if (sonosId.test(id)) this.updateSonosEndpoint(id, null, revision);
        for (const room of visible) this.updateSonosEndpoint(room.id, room, revision);
      })]).then(async results => {
        const speakers = [];
        for (const result of results) {
          if (result.status === 'fulfilled') speakers.push(...result.value);
          else this.log('Speaker discovery failed:', result.reason.message);
        }
        if (results.every(result => result.status === 'rejected')) throw new Error('Unable to discover speakers on the local network.');
        await this.rememberSpeakerCatalog(speakers, results.map(result => result.status === 'fulfilled'));
        await this.rememberSonosAddresses(speakers);
        this.speakers = speakers;
        this.discoveredAt = Date.now();
        return speakers;
      }).finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  catalog() {
    const stored = this.speakerCatalog ?? this.settings?.get?.(speakerCatalogKey);
    return Array.isArray(stored) ? stored : null;
  }

  async rememberSpeakerCatalog(speakers, [castOk, dlnaOk]) {
    const previous = this.catalog();
    const entries = speakers.map(({ id, name, protocol, stereo }) => ({ id, name, protocol, ...(stereo ? { stereo } : {}) }));
    // A failed discovery protocol is not evidence that all of its devices disappeared.
    const next = [...entries, ...(previous ?? []).filter(({ protocol }) => protocol === 'cast' ? !castOk : !dlnaOk)]
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 100);
    this.speakerCatalog = next;
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      try { await this.settings?.set?.(speakerCatalogKey, next); }
      catch (error) { this.log('Could not save the speaker list:', error.message); }
    }
  }

  recentSpeakers() {
    return Date.now() - this.discoveredAt < cacheMs ? this.speakers : undefined;
  }

  currentSpeakers() {
    return this.pending || this.recentSpeakers() || this.refresh();
  }

  speakersAfter(previous) {
    const recent = this.recentSpeakers();
    return this.pending || (recent && recent !== previous ? recent : this.refresh());
  }

  async listSpeakers(mode = 'cached', waitOnCold = true) {
    let speakers;
    if (mode === 'cached') {
      const cached = this.catalog();
      const update = Promise.resolve(this.currentSpeakers());
      if (cached === null && waitOnCold) speakers = await update;
      else {
        speakers = cached ?? [];
        void update.catch(error => this.log('Could not refresh the speaker list:', error.message));
      }
    } else {
      const live = await (mode === 'force' ? this.refresh() : this.currentSpeakers());
      speakers = mode === 'live' ? live : this.catalog() ?? live;
    }
    return speakers.map(({ id, name, protocol, stereo }) => {
      if (!stereo) return { id, name, description: speakerLabels[protocol] };
      const details = ['left', 'right'].filter(side => stereo[side])
        .map(side => `${this.translate(side)}: ${stereo[side]}`);
      return { id, name: `${name} (${this.translate('stereo')})`, description: ['Sonos', ...details].join(' · ') };
    }).sort((a, b) => a.name.localeCompare(b.name) || a.description.localeCompare(b.description));
  }

  async autocomplete(query, mode = 'cached', waitOnCold = true) {
    const filter = (query || '').trim().toLowerCase();
    const matches = choice => `${choice.name} ${choice.description}`.toLowerCase().includes(filter);
    const groups = [...speakerGroups].map(id => ({
      id, name: this.translate(id), description: this.translate(`${id}_help`)
    }));
    const saved = this.groups().map(({ id, name }) => ({ id, name, description: this.translate('saved_group') }))
      .sort((a, b) => a.name.localeCompare(b.name));
    let choices;
    try { choices = await this.listSpeakers(mode, waitOnCold); }
    catch (error) {
      if (!saved.some(matches)) throw error;
      this.log('Individual speaker discovery failed while listing saved groups:', error.message);
      choices = [];
    }
    return [...groups, ...saved, ...choices].filter(matches);
  }

  async select(value, preferKnownSonos = false) {
    if (typeof value?.id !== 'string') throw new Error('Select a speaker from the list.');
    if (isSavedGroup(value.id)) {
      const group = this.groups().find(item => item.id === value.id);
      if (!group) throw new Error('The selected speaker group no longer exists. Choose another speaker or group.');
      const members = new Map(group.members.map(member => [member.id, member]));
      const before = this.recentSpeakers();
      const known = preferKnownSonos && await this.verifyKnownSonos([...members.keys()]);
      const recent = !this.pending && this.recentSpeakers();
      let speakers = known || recent;
      if (!known && (!recent || !await this.verifyCachedGroup(recent, members))) {
        speakers = await this.speakersAfter(recent || before);
      }
      const targets = speakers.flatMap(speaker => {
        const member = members.get(speaker.id) ?? speaker.aliases?.map(id => members.get(id)).find(Boolean);
        if (!member) return [];
        const { volumeOffset, maxVolume } = member;
        return [volumeOffset !== undefined || maxVolume !== undefined ? { ...speaker, volumeOffset, maxVolume } : speaker];
      });
      if (!targets.length) throw new Error(`No speakers in "${group.name}" are currently available.`);
      return { id: group.id, targets, restrictSonosToTargets: true };
    }
    if (SpeakerPlayback.isSpeakerGroup(value.id)) {
      const speakers = await this.refresh();
      if (!speakers.length) throw new Error('No speakers are currently available on the local network.');
      const excluded = value.id === 'all' ? [] : speakers.filter(speaker =>
        speaker.kind === 'tv' || (value.id === 'all_no_tv_speakers' && speaker.kind === 'tvSpeaker'));
      const targets = speakers.filter(speaker => !excluded.includes(speaker));
      if (!targets.length) throw new Error('No speakers match the selected TV exclusions.');
      return { id: value.id, targets, excludedSonos: excluded.filter(speaker => speaker.protocol === 'sonos') };
    }
    const matches = item => item.id === value.id || item.aliases?.includes(value.id);
    if (sonosId.test(value.id)) {
      const before = this.recentSpeakers();
      const saved = this.sonosEndpoints.get(value.id);
      if (saved?.room) {
        this.refreshInBackground();
        return saved.room;
      }
      const targets = saved ? undefined : await this.verifyKnownSonos([value.id]);
      const confirmed = targets?.find(matches);
      const current = confirmed && this.sonosEndpoints.get(confirmed.id)?.room;
      if (current && matches(current)) {
        this.refreshInBackground();
        return current;
      }
      const speaker = (await this.speakersAfter(before)).find(item =>
        matches(item) && this.sonosEndpoints.get(item.id)?.room !== null);
      if (!speaker) throw new Error('The selected speaker is not available on the local network.');
      return speaker;
    }
    const recent = this.recentSpeakers();
    let speaker = !this.pending && recent?.find(matches);
    if (!speaker || !await this.addressResponds(speaker, [value.id])) speaker = (await this.speakersAfter(recent)).find(matches);
    if (!speaker) throw new Error('The selected speaker is not available on the local network.');
    return speaker;
  }

  async addressResponds(speaker, ids) {
    if (speaker.protocol === 'sonos' && sonosId.test(speaker.id)) {
      const rooms = await this.verifyKnownSonos(ids);
      return rooms?.some(room => room.id === speaker.id && room.host === speaker.host) ?? false;
    }
    if (speaker.protocol !== 'cast' && speaker.protocol !== 'dlna') return true;
    if (speaker.protocol === 'dlna') {
      try {
        const room = await describeRenderer(speaker, 800, true);
        return room.protocol === 'dlna' && room.endpoint === speaker.endpoint;
      } catch {
        return false;
      }
    }
    return new Promise(resolve => {
      const socket = require('net').createConnection({ host: speaker.host, port: speaker.port });
      const finish = ready => {
        socket.destroy();
        resolve(ready);
      };
      socket.setTimeout(800);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  async verifyCachedGroup(speakers, members) {
    const targets = new Map();
    for (const id of members.keys()) {
      const speaker = speakers.find(room => room.id === id || room.aliases?.includes(id));
      if (!speaker) return false;
      if (!targets.has(speaker)) targets.set(speaker, []);
      targets.get(speaker).push(id);
    }
    const unique = [...targets];
    for (let i = 0; i < unique.length; i += 8) {
      if (!(await Promise.all(unique.slice(i, i + 8).map(([speaker, ids]) => this.addressResponds(speaker, ids)))).every(Boolean)) return false;
    }
    return true;
  }

  async play(speaker, media, options) {
    const { SpeakerControls } = require('./speaker-controls');
    this.controls ||= new SpeakerControls((target, audio) => this.playSingle(target, audio), this.report,
      error => this.log('Sonos AudioClip announcement failed:', error.message));
    const multiple = SpeakerPlayback.isSpeakerGroup(speaker.id);
    return this.controls.start(multiple ? speaker.targets : [speaker], media,
      { ...options, group: multiple && options?.group, excludedSonos: multiple ? speaker.excludedSonos : undefined,
        restrictSonosToTargets: multiple && speaker.restrictSonosToTargets,
        onConnectionFailure: !multiple && speaker.protocol === 'sonos'
          ? (target, error) => this.invalidateSonosEndpoint(target, error) : undefined,
        rediscoverBeforePlayback: !multiple && speaker.protocol === 'sonos'
          ? (target, error) => this.rediscoverSonosEndpoint(target, error) : undefined });
  }

  async playSingle(speaker, media) {
    return speaker.protocol === 'cast' ? playCast(speaker, media) : playDlna(speaker, media);
  }
}

module.exports = SpeakerPlayback;
