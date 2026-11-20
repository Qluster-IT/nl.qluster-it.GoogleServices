'use strict';

const { isIPv4 } = require('net');
const WebSocket = require('ws');

const namespace = 'audioClip:1';
const commandTimeout = 6000;

function playClip(speaker, media, volume, onActive, connect = (url, protocol, options) => new WebSocket(url, protocol, options)) {
  const playerId = speaker.id.replace(/^dlna:uuid:/i, '').toUpperCase();
  const host = speaker.host;
  if (!/^RINCON_[0-9A-F]{12}\d{5}$/.test(playerId) || !isIPv4(host) ||
      !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) {
    return Promise.reject(new Error('Cannot identify the selected local Sonos room.'));
  }
  return new Promise((resolve, reject) => {
    // The local API presents a device certificate that isn't trusted by Node's public CAs.
    // Restrict this exception to the discovered LAN address, with no redirects or personal credentials.
    const socket = connect(`wss://${host}:1443/websocket/api`, 'v1.api.smartspeaker.audio', {
      rejectUnauthorized: false, handshakeTimeout: commandTimeout, maxPayload: 256 * 1024,
      headers: { 'X-Sonos-Api-Key': '123e4567-e89b-12d3-a456-426655440000' }
    });
    let timer, settled = false, active = false, clipId;
    const earlyEvents = new Map();
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) reject(error);
      else resolve();
    };
    const timeout = (duration, message) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error(message)), duration);
    };
    const send = (command, cmdId, data) => {
      socket.send(JSON.stringify([{ namespace, command, cmdId, playerId }, data]), error => {
        if (error) finish(new Error('Could not send the Sonos AudioClip command.'));
      });
    };
    const handleStatus = status => {
      if (!active && (status === 'ACTIVE' || status === 'DONE')) {
        active = true;
        onActive();
      }
      if (status === 'DONE') finish();
      else if (['ERROR', 'DISMISSED', 'INTERRUPTED'].includes(status)) {
        finish(new Error(`Sonos did not complete the announcement (${status.toLowerCase()}).`));
      }
    };
    timeout(commandTimeout, 'Sonos AudioClip connection timed out.');
    socket.on('error', () => finish(new Error('Could not connect to Sonos AudioClip on the local network (port 1443).')));
    socket.on('close', () => finish(new Error('The Sonos AudioClip connection closed before completion.')));
    socket.on('open', () => {
      timeout(commandTimeout, 'Sonos did not confirm AudioClip status subscription.');
      send('subscribe', '1', {});
    });
    socket.on('message', raw => {
      if (settled) return;
      let data;
      try { data = JSON.parse(raw.toString()); }
      catch { return; }
      if (!Array.isArray(data)) return;
      const [header, body] = data;
      if (!header || (header.playerId && header.playerId !== playerId)) return;
      if (header.type === 'audioClipStatus' || header.name === 'audioClipStatus') {
        if (!Array.isArray(body?.audioClips)) return;
        for (const clip of body.audioClips) {
          if (clip && clip.id === clipId && clipId !== undefined) handleStatus(clip.status);
          else if (!clipId && earlyEvents.size < 64 && typeof clip?.id === 'string') earlyEvents.set(clip.id, clip.status);
        }
      } else if (header.response === 'subscribe' && header.cmdId === '1') {
        if (header.success !== true) return finish(new Error('This Sonos room does not accept AudioClip status subscriptions.'));
        timeout(commandTimeout, 'Sonos did not confirm the AudioClip request.');
        send('loadAudioClip', '2', {
          name: 'Google Services', appId: 'nl.qluster-it.GoogleServices', streamUrl: media.url,
          ...(volume === undefined ? {} : { volume: Math.round(volume) })
        });
      } else if (header.response === 'loadAudioClip' && header.cmdId === '2') {
        if (header.success !== true) return finish(new Error('This Sonos room rejected the AudioClip announcement.'));
        if (typeof body?.id !== 'string') return finish(new Error('Sonos did not return an AudioClip identifier.'));
        clipId = body.id;
        timeout(media.duration + 30000, 'Sonos did not confirm the end of the AudioClip announcement.');
        handleStatus(earlyEvents.get(clipId) ?? body.status);
        earlyEvents.clear();
      } else if (header.type === 'globalError' || header.success === false) {
        finish(new Error('This Sonos room does not support the requested AudioClip operation.'));
      }
    });
  });
}

module.exports = playClip;
