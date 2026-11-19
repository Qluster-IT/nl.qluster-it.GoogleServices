'use strict';

const { isIPv4 } = require('net');
const fetch = require('node-fetch');

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
const pickerLabels = { stereo: 'Stereo', left: 'Left', right: 'Right' };

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
      const { id, fn } = service.txt || {};
      if (!host || typeof id !== 'string' || !id || !Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return;
      const name = typeof fn === 'string' && fn.trim() ? fn : service.name;
      if (typeof name !== 'string' || !name.trim()) return;
      speakers.set(id, { id: `cast:${id}`, name, host, port: service.port, protocol: 'cast' });
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

async function describeRenderer(device) {
  const response = await fetch(device.location, { redirect: 'error', timeout: 2000, size: 128 * 1024 });
  if (!response.ok) throw new Error(`DLNA description returned HTTP ${response.status}.`);
  const { XMLParser } = require('fast-xml-parser');
  const { root } = new XMLParser({ removeNSPrefix: true, processEntities: false, parseTagValue: false,
    isArray: (tag, path) => tag === 'service' || path.endsWith('.deviceList.device') }).parse(await response.text());
  const item = root?.device;
  const sonos = item?.deviceType === zonePlayer && /^Sonos\b/i.test(item.manufacturer);
  const transport = findTransport(item, candidate => sonos || candidate === item ||
    (typeof candidate.UDN === 'string' && `dlna:${candidate.UDN.toLowerCase()}` === device.id));
  const service = transport?.service;
  const name = sonos ? item.roomName || item.friendlyName : transport?.device.friendlyName;
  if (!service?.controlURL || typeof name !== 'string' || !name.trim()) {
    throw new Error('No named DLNA AVTransport renderer found.');
  }
  const base = root.URLBase ? deviceUrl(root.URLBase, device.host, device.location) : device.location;
  const rootId = typeof item.UDN === 'string' && /^uuid:[a-z0-9_-]+$/i.test(item.UDN)
    ? `dlna:${item.UDN.toLowerCase()}` : device.id;
  const speaker = { ...device, id: sonos ? rootId : device.id, name, endpoint: deviceUrl(service.controlURL, device.host, base),
    service: service.serviceType, protocol: sonos ? 'sonos' : 'dlna', aliases: [device.id] };
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

async function readStereoPair(speaker) {
  const action = 'GetZoneGroupState';
  const response = await fetch(speaker.topology, {
    method: 'POST', redirect: 'error', timeout: 1500, size: 256 * 1024,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${zoneTopology}#${action}"` },
    body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="${zoneTopology}"/></s:Body></s:Envelope>`
  });
  if (!response.ok) {
    response.body?.destroy();
    throw new Error(`Sonos topology returned HTTP ${response.status}.`);
  }
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, processEntities: false, parseTagValue: false });
  const state = parser.parse(await response.text())?.Envelope?.Body?.GetZoneGroupStateResponse?.ZoneGroupState;
  if (typeof state !== 'string') throw new Error('Sonos did not return zone topology.');
  // SOAP returns the topology as escaped XML, not as child elements.
  const topology = state.replace(/&(lt|gt|quot|apos|amp);/g, (_, key) => ({
    lt: '<', gt: '>', quot: '"', apos: "'", amp: '&'
  })[key]);
  const groups = parser.parse(topology)?.ZoneGroupState?.ZoneGroups;
  if (groups == null) throw new Error('Sonos returned invalid zone topology.');
  for (const group of asArray(groups.ZoneGroup)) {
    const members = asArray(group.ZoneGroupMember);
    const primary = members.find(member =>
      typeof member['@_UUID'] === 'string' && speakerId(member['@_UUID']) === speaker.id);
    const channelMap = primary?.['@_ChannelMapSet'];
    if (!primary || ![undefined, '0'].includes(primary['@_Invisible']) || typeof channelMap !== 'string') continue;
    const entries = channelMap.split(';').filter(Boolean);
    if (entries.length !== 2) continue;
    const pair = {};
    for (const entry of entries) {
      const channel = /^(RINCON_[a-z0-9_]+):(LF|RF)(?:,\2)*$/i.exec(entry);
      if (channel) pair[channel[2].toUpperCase() === 'LF' ? 'left' : 'right'] = speakerId(channel[1]);
    }
    const secondary = pair.left === speaker.id ? pair.right : pair.right === speaker.id ? pair.left : undefined;
    if (secondary && secondary !== speaker.id && members.some(member => member['@_Invisible'] === '1' &&
      typeof member['@_UUID'] === 'string' && speakerId(member['@_UUID']) === secondary)) return { ...pair, secondary };
  }
}

async function discoverDlna(log) {
  const renderers = await discoverRenderers();
  const speakers = [];
  for (let i = 0; i < renderers.length; i += 8) {
    const batch = await Promise.allSettled(renderers.slice(i, i + 8).map(describeRenderer));
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
  const pairs = [];
  for (let i = 0; i < sonos.length; i += 8) {
    const batch = await Promise.all(sonos.slice(i, i + 8).map(async speaker => {
      if (speaker.invalidTopology) log('Ignoring a Sonos topology endpoint with an unsupported address.');
      if (!speaker.topology) return;
      try {
        const pair = await readStereoPair(speaker);
        if (pair) return { speaker, pair };
      } catch (error) {
        log('Could not read Sonos stereo topology:', error.message);
      }
    }));
    pairs.push(...batch.filter(Boolean));
  }
  for (const { speaker, pair } of pairs) {
    // Keep individual entries if competing topology reports claim the same device.
    if (pairs.some(other => other.speaker !== speaker &&
      (other.pair.secondary === pair.secondary || other.pair.secondary === speaker.id || other.speaker.id === pair.secondary))) continue;
    const secondary = unique.get(pair.secondary);
    if (secondary && secondary.protocol !== 'sonos') continue;
    speaker.stereo = { left: unique.get(pair.left)?.model, right: unique.get(pair.right)?.model };
    speaker.aliases.push(pair.secondary, ...(secondary?.aliases || []));
    unique.delete(pair.secondary);
  }
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
  const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>Google Services announcement</dc:title><upnp:class>object.item.audioItem</upnp:class><res protocolInfo="http-get:*:${escapeXml(media.type)}:*">${escapeXml(media.url)}</res></item></DIDL-Lite>`;
  for (const [action, args] of [
    ['SetAVTransportURI', `<CurrentURI>${escapeXml(media.url)}</CurrentURI><CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>`],
    ['Play', '<Speed>1</Speed>']
  ]) {
    const response = await fetch(speaker.endpoint, {
      method: 'POST', redirect: 'error', timeout: 5000,
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${speaker.service}#${action}"` },
      body: `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${speaker.service}"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`
    });
    response.body?.destroy();
    if (!response.ok) throw new Error(`${speaker.protocol === 'sonos' ? 'Sonos' : 'DLNA'} speaker rejected ${action} (HTTP ${response.status}).`);
  }
}

class SpeakerPlayback {
  constructor(log, translate = key => pickerLabels[key]) {
    this.log = log;
    this.translate = translate;
  }

  async refresh() {
    if (!this.pending) {
      this.pending = Promise.allSettled([discoverCast(), discoverDlna(this.log)]).then(results => {
        const speakers = [];
        for (const result of results) {
          if (result.status === 'fulfilled') speakers.push(...result.value);
          else this.log('Speaker discovery failed:', result.reason.message);
        }
        if (results.every(result => result.status === 'rejected')) throw new Error('Unable to discover speakers on the local network.');
        this.speakers = speakers;
        this.discoveredAt = Date.now();
        return speakers;
      }).finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  async autocomplete(query) {
    const speakers = Date.now() - this.discoveredAt < cacheMs ? this.speakers : await this.refresh();
    const filter = (query || '').trim().toLowerCase();
    const labels = { cast: 'Google Cast', dlna: 'UPnP / DLNA', sonos: 'Sonos' };
    return speakers.map(({ id, name, protocol, stereo }) => {
      if (!stereo) return { id, name, description: labels[protocol] };
      const details = ['left', 'right'].filter(side => stereo[side])
        .map(side => `${this.translate(side)}: ${stereo[side]}`);
      return { id, name: `${name} (${this.translate('stereo')})`, description: ['Sonos', ...details].join(' · ') };
    })
      .filter(speaker => `${speaker.name} ${speaker.description}`.toLowerCase().includes(filter))
      .sort((a, b) => a.name.localeCompare(b.name) || a.description.localeCompare(b.description));
  }

  async select(value) {
    if (typeof value?.id !== 'string') throw new Error('Select a speaker from the list.');
    const matches = item => item.id === value.id || item.aliases?.includes(value.id);
    let speaker = Date.now() - this.discoveredAt < cacheMs && this.speakers.find(matches);
    if (!speaker) speaker = (await this.refresh()).find(matches);
    if (!speaker) throw new Error('The selected speaker is not available on the local network.');
    return speaker;
  }

  play(speaker, media) {
    return speaker.protocol === 'cast' ? playCast(speaker, media) : playDlna(speaker, media);
  }
}

module.exports = SpeakerPlayback;
