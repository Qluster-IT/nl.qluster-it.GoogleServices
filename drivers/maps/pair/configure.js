'use strict';

(() => {
  Homey.setTitle(Homey.__('maps.pair.title'));
  let submitting = false;
  const addresses = ['origin', 'destination'].map(id => {
    const input = document.getElementById(id);
    const results = document.getElementById(`${id}Suggestions`);
    const status = document.getElementById(`${id}Status`);
    const attribution = document.getElementById(`${id}Attribution`);
    let selected;
    let timer;
    let revision = 0;
    function clear() {
      clearTimeout(timer);
      revision++;
      results.replaceChildren();
      attribution.hidden = true;
      status.textContent = '';
    }
    function render(suggestions) {
      results.replaceChildren();
      attribution.hidden = !suggestions.some(suggestion => suggestion.google);
      for (const suggestion of suggestions) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'homey-button-secondary';
        button.textContent = suggestion.name;
        if (suggestion.description && !suggestion.google) {
          const description = document.createElement('small');
          description.style.display = 'block';
          description.textContent = suggestion.description;
          button.append(description);
        }
        button.addEventListener('click', () => {
          clear();
          selected = suggestion;
          input.value = suggestion.google ? suggestion.name : suggestion.id;
          input.focus();
        });
        item.append(button);
        results.append(item);
      }
    }
    input.addEventListener('input', () => {
      clear();
      selected = null;
      const query = input.value.trim();
      if (submitting || !query) return;
      render([{
        name: query,
        id: query, description: Homey.__('maps.address.typed_help')
      }]);
      if (query.length < 3 || /^place_id:|^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(query)) return;
      const current = revision;
      timer = setTimeout(async () => {
        status.textContent = Homey.__('maps.pair.searching');
        try {
          const suggestions = await Homey.emit('search_address', query);
          if (current !== revision || submitting) return;
          status.textContent = suggestions.some(suggestion => suggestion.google) ? '' : Homey.__('maps.pair.no_results');
          render(suggestions);
        } catch (error) {
          if (current === revision && !submitting) {
            status.textContent = `${Homey.__('maps.pair.search_error')} ${error.message}`;
          }
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
    return { value: () => selected ? selected.id : input.value.trim(), clear };
  });

  document.getElementById('routeForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    for (const address of addresses) address.clear();
    const button = document.getElementById('continue');
    const errorLabel = document.getElementById('routeError');
    button.disabled = true;
    errorLabel.textContent = '';
    try {
      await Homey.emit('save_route', {
        origin: addresses[0].value(), destination: addresses[1].value(),
        travel_mode: document.getElementById('travelMode').value,
        route_image: document.getElementById('routeImage').checked
      });
      await Homey.showView('list_devices');
    } catch (error) {
      errorLabel.textContent = error.message;
      submitting = false;
      button.disabled = false;
    }
  });
})();
