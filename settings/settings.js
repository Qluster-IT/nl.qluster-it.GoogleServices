'use strict';

async function onHomeyReady(Homey) {
    const fields = {
        CloudJSON: document.getElementById('cloudJSON'),
        CloudProject: document.getElementById('cloudProject'),
        CloudApiKey: document.getElementById('cloudApiKey'),
        MapsApiKey: document.getElementById('mapsApiKey'),
        MapsRouteImagesEnabled: document.getElementById('mapsRouteImages'),
        MapsRouteTrafficEnabled: document.getElementById('mapsRouteTraffic'),
        DefaultCloudVoice: document.getElementById('defaultCloudVoice')
    };
    const button = document.getElementById('save');
    const status = document.getElementById('settingsStatus');
    const saved = {};
    const toggles = ['MapsRouteImagesEnabled', 'MapsRouteTrafficEnabled'];
    const call = (method, ...args) => new Promise((resolve, reject) => {
        Homey[method](...args, (err, value) => err ? reject(err) : resolve(value));
    });

    function renderVoices(voices, selected) {
        const select = fields.DefaultCloudVoice;
        select.textContent = '';
        select.add(new Option('No default voice', ''));
        let selectedName;
        if (selected) {
            try { selectedName = JSON.parse(selected).name; }
            catch { selectedName = null; }
            select.add(new Option(selectedName || 'Saved voice', selected));
        }
        for (const voice of voices) {
            if (voice.name === selectedName) continue;
            select.add(new Option(`${voice.name} (${voice.ssmlGender})`, JSON.stringify(voice)));
        }
        select.value = selected || '';
    }

    async function refreshVoices() {
        const select = fields.DefaultCloudVoice;
        select.disabled = true;
        try {
            const voices = await call('api', 'GET', '/getVoices', null);
            renderVoices(Array.isArray(voices) ? voices : [], saved.DefaultCloudVoice);
            document.getElementById('voiceStatus').textContent = '';
        } catch {
            document.getElementById('voiceStatus').textContent = 'Could not load Cloud voices. Check your Cloud credentials.';
        } finally {
            select.disabled = false;
        }
    }

    Homey.ready();
    if (document.getElementById('settingsTabs')) initSpeakerGroups(Homey, call);
    const sonosMode = document.getElementById('sonosAnnouncementMode');
    if (sonosMode) {
        const modeStatus = document.getElementById('sonosModeStatus');
        const key = 'sonosAnnouncementMode';
        call('get', key).then(value => {
            let current = value === 'selected' ? 'selected' : 'sync';
            sonosMode.value = current;
            sonosMode.disabled = false;
            sonosMode.addEventListener('change', async () => {
                const next = sonosMode.value;
                sonosMode.disabled = true;
                modeStatus.textContent = '';
                try {
                    await call('set', key, next);
                    current = next;
                    modeStatus.textContent = Homey.__('settings.sonos_saved');
                } catch {
                    sonosMode.value = current;
                    modeStatus.textContent = Homey.__('settings.sonos_save_error');
                } finally {
                    sonosMode.disabled = false;
                }
            });
        }, () => { modeStatus.textContent = Homey.__('settings.sonos_load_error'); });
    }
    status.textContent = 'Loading settings...';
    for (const field of Object.values(fields)) field.disabled = true;
    try {
        await Promise.all(Object.keys(fields).map(async key => {
            const value = await call('get', key);
            if (toggles.includes(key)) saved[key] = fields[key].checked = value !== false;
            else if (key === 'DefaultCloudVoice') saved[key] = value || null;
            else saved[key] = fields[key].value = value || '';
        }));
    } catch {
        status.textContent = 'Could not load settings. Reopen this page to try again.';
        return;
    }
    renderVoices([], saved.DefaultCloudVoice);
    for (const field of Object.values(fields)) field.disabled = false;
    const probes = Array.from(document.querySelectorAll('[data-service-check]'));
    const probeStatuses = ['ok', 'missing', 'busy', 'billing', 'disabled', 'credentials', 'quota', 'access', 'unreachable', 'failed'];
    const pending = new Set();
    const refreshProbeButtons = () => {
        probes.forEach(probe => { probe.disabled = button.disabled || pending.has(probe); });
    };
    for (const probe of probes) {
        const service = probe.dataset.serviceCheck;
        const result = document.getElementById(`check-${service}`);
        probe.addEventListener('click', async () => {
            pending.add(probe);
            refreshProbeButtons();
            result.textContent = Homey.__('settings.check_running');
            try {
                const { status: code } = await call('api', 'POST', '/check-google-service', { service });
                result.textContent = Homey.__(`settings.check_result_${probeStatuses.includes(code) ? code : 'failed'}`);
            } catch {
                result.textContent = Homey.__('settings.check_result_failed');
            } finally {
                pending.delete(probe);
                refreshProbeButtons();
            }
        });
    }
    button.disabled = false;
    refreshProbeButtons();
    status.textContent = '';
    if (saved.CloudJSON) void refreshVoices();

    button.addEventListener('click', async () => {
        const next = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
        for (const key of toggles) next[key] = fields[key].checked;
        next.DefaultCloudVoice = next.DefaultCloudVoice || null;
        if (next.MapsApiKey !== saved.MapsApiKey) next.MapsApiKey = next.MapsApiKey.trim();
        const keys = [
            ...toggles.filter(key => !next[key]),
            ...Object.keys(fields).filter(key => !toggles.includes(key)),
            ...toggles.filter(key => next[key])
        ];
        button.disabled = true;
        refreshProbeButtons();
        status.textContent = 'Saving settings...';
        let currentKey;
        let reloadVoices = false;
        try {
            for (const key of keys) {
                if (saved[key] === next[key]) continue;
                currentKey = key;
                await call('set', key, next[key]);
                saved[key] = next[key];
                if (key === 'CloudJSON') reloadVoices = true;
            }
            status.textContent = 'Settings saved.';
        } catch {
            const label = fields[currentKey].labels[0].textContent.trim();
            status.textContent = `Could not save ${label}. Earlier changes may already be saved; try again.`;
        } finally {
            button.disabled = false;
            refreshProbeButtons();
            if (reloadVoices && saved.CloudJSON && fields.DefaultCloudVoice.value === (saved.DefaultCloudVoice || '')) void refreshVoices();
        }
    });
}
