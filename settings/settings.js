'use strict';

async function onHomeyReady(Homey) {
    const fields = {
        CloudJSON: document.getElementById('cloudJSON'),
        CloudProject: document.getElementById('cloudProject'),
        CloudApiKey: document.getElementById('cloudApiKey'),
        MapsApiKey: document.getElementById('mapsApiKey'),
        MapsRouteImagesEnabled: document.getElementById('mapsRouteImages'),
        DefaultCloudVoice: document.getElementById('defaultCloudVoice')
    };
    const button = document.getElementById('save');
    const status = document.getElementById('settingsStatus');
    const saved = {};
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
    status.textContent = 'Loading settings...';
    for (const field of Object.values(fields)) field.disabled = true;
    try {
        await Promise.all(Object.keys(fields).map(async key => {
            const value = await call('get', key);
            if (key === 'MapsRouteImagesEnabled') saved[key] = fields[key].checked = value !== false;
            else if (key === 'DefaultCloudVoice') saved[key] = value || null;
            else saved[key] = fields[key].value = value || '';
        }));
    } catch {
        status.textContent = 'Could not load settings. Reopen this page to try again.';
        return;
    }
    renderVoices([], saved.DefaultCloudVoice);
    for (const field of Object.values(fields)) field.disabled = false;
    button.disabled = false;
    status.textContent = '';
    if (saved.CloudJSON) void refreshVoices();

    button.addEventListener('click', async () => {
        const next = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
        next.MapsRouteImagesEnabled = fields.MapsRouteImagesEnabled.checked;
        next.DefaultCloudVoice = next.DefaultCloudVoice || null;
        if (next.MapsApiKey !== saved.MapsApiKey) next.MapsApiKey = next.MapsApiKey.trim();
        const keys = Object.keys(fields).filter(key => key !== 'MapsRouteImagesEnabled');
        if (next.MapsRouteImagesEnabled) keys.push('MapsRouteImagesEnabled');
        else keys.unshift('MapsRouteImagesEnabled');
        button.disabled = true;
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
            if (reloadVoices && saved.CloudJSON && fields.DefaultCloudVoice.value === (saved.DefaultCloudVoice || '')) void refreshVoices();
        }
    });
}
