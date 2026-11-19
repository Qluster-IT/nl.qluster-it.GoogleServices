'use strict';

function initSpeakerGroups(Homey, call) {
    const el = id => document.getElementById(id);
    const translate = (key, tokens = {}) => Homey.__(`settings.${key}`)
        .replace(/__(\w+)__/g, (match, token) => tokens[token] ?? match);
    const api = (method, url, body = null) => call('api', method, url, body);
    const tabs = [el('generalTab'), el('groupsTab')];
    const selector = el('speakerGroupSelect');
    const name = el('speakerGroupName');
    const members = el('speakerGroupMembers');
    const status = el('speakerGroupStatus');
    const discoveryStatus = el('groupDiscoveryStatus');
    let groups = null;
    let speakers = [];
    let draft = null;
    let busy = false;
    let discovering = false;

    function showTab(index, focus = false) {
        tabs.forEach((tab, i) => {
            tab.setAttribute('aria-selected', String(i === index));
            tab.tabIndex = i === index ? 0 : -1;
            el(tab.getAttribute('aria-controls')).hidden = i !== index;
            el(i === 0 ? 'generalActions' : 'groupsActions').hidden = i !== index;
        });
        if (focus) tabs[index].focus();
        if (index === 1 && groups === null && !busy) void loadGroups();
    }

    for (const element of document.querySelectorAll('[data-i18n^="settings."]')) {
        element.textContent = Homey.__(element.dataset.i18n);
    }
    el('settingsTabs').setAttribute('aria-label', translate('navigation'));
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => showTab(i));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            showTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - i, true);
        });
    });

    function updateButtons() {
        selector.disabled = busy || !groups?.length;
        el('speakerGroupAdd').disabled = busy || groups === null;
        el('speakerGroupDelete').disabled = busy || !draft?.id;
        el('speakerGroupSave').disabled = busy || !draft?.name.trim() || !draft.members.size || !isDirty();
        el('speakerGroupRefresh').disabled = busy || discovering;
        el('groupMemberFields').disabled = busy;
        name.disabled = busy;
    }

    function isDirty() {
        if (!draft) return false;
        const saved = groups.find(group => group.id === draft.id);
        return !saved || draft.name !== saved.name || draft.members.size !== saved.members.length ||
            saved.members.some(member => {
                const current = draft.members.get(member.id);
                return !current || (current.volumeOffset ?? 0) !== (member.volumeOffset ?? 0) ||
                    (current.maxVolume ?? 100) !== (member.maxVolume ?? 100);
            });
    }

    function renderMembers() {
        members.textContent = '';
        if (!draft) return;
        const saved = groups.find(group => group.id === draft.id);
        const options = new Map((saved?.members ?? []).map(member => [member.id, { ...member, unavailable: true }]));
        for (const speaker of speakers) options.set(speaker.id, speaker);
        for (const [id, speaker] of draft.members) if (!options.has(id)) options.set(id, { ...speaker, unavailable: true });
        for (const speaker of options.values()) {
            const row = document.createElement('div');
            row.className = 'group-speaker-row';
            const fields = document.createElement('div');
            fields.className = 'group-volume-fields';
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'hy-nostyle';
            checkbox.checked = draft.members.has(speaker.id);
            fields.hidden = !checkbox.checked;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) draft.members.set(speaker.id, { id: speaker.id, name: speaker.name });
                else draft.members.delete(speaker.id);
                fields.hidden = !checkbox.checked;
                if (checkbox.checked) {
                    for (const reset of resetSliders) reset();
                }
                updateButtons();
            });
            label.append(checkbox, speaker.unavailable ? translate('group_member_unavailable', { name: speaker.name }) : speaker.name);
            const resetSliders = [
                ['volumeOffset', 'group_volume_offset', -100, 0],
                ['maxVolume', 'group_max_volume', 0, 100]
            ].map(([key, title, min, fallback]) => {
                const field = document.createElement('label');
                field.className = 'group-volume-slider';
                const heading = document.createElement('span');
                heading.className = 'group-volume-heading';
                const readout = document.createElement('span');
                readout.className = 'group-volume-value';
                readout.setAttribute('aria-hidden', 'true');
                heading.append(translate(title), readout);
                const input = document.createElement('input');
                input.type = 'range';
                input.className = 'hy-nostyle';
                input.min = String(min);
                input.max = '100';
                input.step = '1';
                input.value = String(draft.members.get(speaker.id)?.[key] ?? fallback);
                const updateReadout = () => {
                    const value = input.valueAsNumber;
                    readout.textContent = key === 'maxVolume' ? `${value}%` : `${value > 0 ? '+' : ''}${value}`;
                };
                updateReadout();
                input.addEventListener('input', () => {
                    const member = draft.members.get(speaker.id);
                    if (!member) return;
                    member[key] = input.valueAsNumber;
                    updateReadout();
                    updateButtons();
                });
                field.append(heading, input);
                fields.append(field);
                return () => {
                    input.value = String(fallback);
                    updateReadout();
                };
            });
            row.append(label, fields);
            members.append(row);
        }
    }

    function selectGroup(group, makeNew = false) {
        draft = group ? { id: group.id, name: group.name, members: new Map(group.members.map(member => [member.id, { ...member }])) }
            : makeNew ? { name: '', members: new Map() } : null;
        selector.value = draft?.id ?? '';
        el('speakerGroupEditor').hidden = !draft;
        name.value = draft?.name ?? '';
        renderMembers();
        updateButtons();
        if (makeNew) name.focus();
    }

    function renderGroups() {
        selector.textContent = '';
        selector.add(new Option(translate(groups.length ? 'group_choose' : 'groups_empty'), ''));
        for (const group of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
            selector.add(new Option(group.name, group.id));
        }
    }

    async function refreshSpeakers() {
        discovering = true;
        updateButtons();
        discoveryStatus.textContent = translate('group_scanning');
        try {
            speakers = await api('GET', '/announcement-speakers');
            discoveryStatus.textContent = speakers.length ? '' : translate('group_no_speakers');
            renderMembers();
        } catch (error) {
            discoveryStatus.textContent = `${translate('group_scan_failed')} ${error.message || error}`;
        } finally {
            discovering = false;
            updateButtons();
        }
    }

    const confirm = message => call('confirm', message, 'warning');

    async function loadGroups() {
        busy = true;
        updateButtons();
        status.textContent = translate('groups_loading');
        try {
            const response = await api('GET', '/api-ready');
            if (!response?.ready) throw new Error(translate('groups_starting'));
            groups = await api('GET', '/speaker-groups');
            renderGroups();
            status.textContent = '';
        } catch (error) {
            status.textContent = `${translate('groups_load_failed')} ${error.message || error}`;
        } finally {
            busy = false;
            updateButtons();
        }
    }

    async function switchEditor(next, add = false) {
        selector.value = draft?.id ?? '';
        try {
            if (isDirty() && !await confirm(translate('group_discard'))) return;
            status.textContent = '';
            selectGroup(next, add);
            if (draft && !discovering) void refreshSpeakers();
        } catch (error) {
            status.textContent = error.message || String(error);
        }
    }

    selector.addEventListener('change', () => void switchEditor(groups.find(group => group.id === selector.value)));
    el('speakerGroupAdd').addEventListener('click', () => void switchEditor(null, true));
    el('speakerGroupRefresh').addEventListener('click', () => void refreshSpeakers());
    name.addEventListener('input', () => {
        draft.name = name.value;
        updateButtons();
    });

    async function saveOrDelete(remove) {
        busy = true;
        updateButtons();
        status.textContent = '';
        try {
            if (remove) {
                const saved = groups.find(group => group.id === draft.id);
                if (!await confirm(translate('group_delete_confirm', { name: saved.name }))) return;
                groups = await api('DELETE', `/speaker-groups/${encodeURIComponent(saved.id)}`);
                renderGroups();
                selectGroup(null);
            } else {
                const selected = [...draft.members.values()].map(({ id, volumeOffset, maxVolume }) => ({ id, volumeOffset, maxVolume }));
                const saved = await api('POST', '/speaker-groups', { id: draft.id, name: draft.name, members: selected });
                groups = [...groups.filter(group => group.id !== saved.id), saved];
                renderGroups();
                selectGroup(saved);
            }
            status.textContent = translate(remove ? 'group_deleted' : 'group_saved');
        } catch (error) {
            status.textContent = `${translate(remove ? 'group_delete_failed' : 'group_save_failed')} ${error.message || error}`;
        } finally {
            busy = false;
            updateButtons();
        }
    }

    el('speakerGroupSave').addEventListener('click', () => void saveOrDelete(false));
    el('speakerGroupDelete').addEventListener('click', () => void saveOrDelete(true));
}
