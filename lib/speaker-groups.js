'use strict';

const { randomUUID } = require('node:crypto');
const key = 'AnnouncementSpeakerGroups';
const groupId = /^group:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const memberId = /^(?:cast:|dlna:uuid:)[^\s]{1,200}$/;
const getMemberId = member => typeof member === 'string' ? member : member?.id;

function listGroups(settings) {
  const groups = settings?.get?.(key);
  if (groups == null) return [];
  if (!Array.isArray(groups)) throw new Error('Saved speaker groups are invalid.');
  return groups;
}

function saveGroup(settings, input, speakers) {
  const groups = listGroups(settings);
  const existing = groups.find(group => group.id === input?.id);
  if (input?.id != null && !existing) throw new Error('This speaker group no longer exists.');
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) throw new Error('Enter a group name of 1–80 characters.');
  if (groups.some(group => group.id !== existing?.id && group.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('A speaker group already uses that name.');
  }
  if (!existing && groups.length >= 50) throw new Error('You can save up to 50 speaker groups.');
  if (!Array.isArray(input.members) || !input.members.length || input.members.length > 50 ||
      input.members.some(member => typeof getMemberId(member) !== 'string' || !memberId.test(getMemberId(member)))) {
    throw new Error('Select between 1 and 50 individual speakers.');
  }
  const known = new Map([...(existing?.members ?? []), ...speakers].map(member => [member.id, member.name]));
  const members = new Map();
  for (const inputMember of input.members) {
    const id = getMemberId(inputMember);
    if (!known.has(id)) throw new Error('A selected speaker is no longer available. Refresh the speaker list.');
    const { volumeOffset = 0, maxVolume = 100 } = inputMember;
    if (!Number.isInteger(volumeOffset) || volumeOffset < -100 || volumeOffset > 100 ||
        !Number.isInteger(maxVolume) || maxVolume < 0 || maxVolume > 100) {
      throw new Error('Volume adjustment must be from -100 to 100 and maximum volume from 0 to 100.');
    }
    if (!members.has(id)) members.set(id, { id, name: known.get(id),
      ...(volumeOffset !== 0 ? { volumeOffset } : {}), ...(maxVolume !== 100 ? { maxVolume } : {}) });
  }
  const group = { id: existing?.id ?? `group:${randomUUID()}`, name, members: [...members.values()] };
  return { group, groups: existing ? groups.map(item => item === existing ? group : item) : [...groups, group] };
}

async function writeGroup(settings, input, speakers) {
  const { group, groups } = saveGroup(settings, input, speakers);
  await settings.set(key, groups);
  return group;
}

async function deleteGroup(settings, id) {
  const groups = listGroups(settings);
  const next = groups.filter(group => group.id !== id);
  if (next.length === groups.length) throw new Error('This speaker group no longer exists.');
  await settings.set(key, next);
  return next;
}

module.exports = { listGroups, writeGroup, deleteGroup, getMemberId, isSavedGroup: id => typeof id === 'string' && groupId.test(id) };
