'use strict';

(async () => {
  Homey.setTitle(Homey.__('maps.repair.title'));
  const form = document.getElementById('editRouteForm');
  const fields = document.getElementById('routeAddresses');
  const errorLabel = document.getElementById('routeError');
  const travelMode = document.getElementById('travelMode');
  const routeImage = document.getElementById('routeImage');
  const routeTraffic = document.getElementById('routeTraffic');

  const addresses = ['origin', 'destination'].map(id => {
    const input = document.getElementById(id);
    const useHomey = document.getElementById(`${id}Homey`);
    const results = document.getElementById(`${id}Suggestions`);
    const status = document.getElementById(`${id}Status`);
    const attribution = document.getElementById(`${id}Attribution`);
    let selected;
    let timer;
    let revision = 0;
    const clear = () => {
      clearTimeout(timer);
      revision++;
      results.replaceChildren();
      attribution.hidden = true;
      status.textContent = '';
    };

    input.addEventListener('input', () => {
      clear();
      selected = null;
      const query = input.value.trim();
      if (query.length < 3 || /^place_id:|^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(query)) return;
      const current = revision;
      timer = setTimeout(async () => {
        status.textContent = Homey.__('maps.pair.searching');
        try {
          const suggestions = await Homey.emit('search_address', query);
          if (current !== revision) return;
          attribution.hidden = !suggestions.some(suggestion => suggestion.google);
          const fallback = suggestions.find(suggestion => !suggestion.google);
          status.textContent = attribution.hidden ? fallback?.description || Homey.__('maps.pair.no_results') : '';
          for (const suggestion of suggestions.filter(suggestion => suggestion.google)) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'homey-button-secondary';
            button.textContent = suggestion.name;
            button.addEventListener('click', () => {
              clear();
              selected = suggestion;
              input.value = suggestion.name;
              input.focus();
            });
            item.append(button);
            results.append(item);
          }
        } catch (error) {
          if (current === revision) status.textContent = `${Homey.__('maps.pair.search_error')} ${error.message}`;
        }
      }, 500);
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') clear();
      if (event.key === 'ArrowDown' && results.firstElementChild) {
        event.preventDefault();
        results.firstElementChild.firstElementChild.focus();
      }
    });

    const toggle = () => {
      input.disabled = useHomey.checked;
      clear();
    };
    useHomey.addEventListener('change', toggle);
    return {
      id, clear,
      fill: saved => {
        const address = saved[id];
        selected = address && typeof address === 'object' ? address : null;
        input.value = selected ? selected.name : address || '';
        useHomey.checked = saved[`${id}_homey`];
        toggle();
      },
      usesHomey: () => useHomey.checked,
      value: () => selected && input.value === selected.name ? { name: selected.name, id: selected.id } : input.value.trim()
    };
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (fields.disabled) return;
    fields.disabled = true;
    addresses.forEach(address => address.clear());
    errorLabel.textContent = '';
    try {
      await Homey.emit('save_route_settings', {
        origin: addresses[0].value(), destination: addresses[1].value(),
        origin_homey: addresses[0].usesHomey(), destination_homey: addresses[1].usesHomey(),
        travel_mode: travelMode.value, route_image: routeImage.checked, route_traffic: routeTraffic.checked
      });
      await Homey.done();
    } catch (error) {
      errorLabel.textContent = error.message;
      fields.disabled = false;
    }
  });

  try {
    const saved = await Homey.emit('get_route_settings');
    addresses.forEach(address => address.fill(saved));
    travelMode.value = saved.travel_mode;
    routeImage.checked = saved.route_image;
    routeTraffic.checked = saved.route_traffic;
    if (saved.address_lookup_failed) errorLabel.textContent = Homey.__('maps.repair.address_lookup_failed');
    fields.disabled = false;
  } catch (error) {
    errorLabel.textContent = error.message;
  }
})();
