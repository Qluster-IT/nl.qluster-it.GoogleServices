'use strict';

const Homey = require('homey');
const { v4: uuidv4 } = require('uuid');
const { parseRoute, computeRoute, autocompletePlaces, fetchMap } = require('../../lib/maps');

class MapsDriver extends Homey.Driver {
  onInit() {
    this.homey.flow.getActionCard('maps_refresh_route')
      .registerRunListener(async ({ device }) => { await device.refreshRoute(); });
    const calculate = this.homey.flow.getActionCard('maps_calculate_route');
    calculate.registerRunListener(async ({ from, to, mode }) => {
      const { tokens } = await this.calculateRoute(parseRoute(from, to, mode));
      return tokens;
    });
    for (const name of ['from', 'to']) {
      calculate.getArgument(name).registerAutocompleteListener(query => this.searchAddresses(query));
    }
    this.homey.flow.getActionCard('maps_calculate_traveltime')
      .registerRunListener(async () => { throw new Error('Replace this old card with Calculate a one-off Google Maps route.'); });
    this.homey.flow.getConditionCard('maps_route_available')
      .registerRunListener(async ({ device }) => Number.isFinite(device.getCapabilityValue('maps_minutes')));
    this.homey.flow.getConditionCard('maps_travel_time_above')
      .registerRunListener(async ({ device, minutes }) => {
        if (!Number.isFinite(minutes) || minutes < 0) throw new Error(this.homey.__('maps.invalid_minutes'));
        const current = device.getCapabilityValue('maps_minutes');
        if (!Number.isFinite(current)) throw new Error(this.homey.__('maps.route_unavailable'));
        return current > minutes;
      });
  }

  getMapsKey() {
    const key = this.homey.settings.get('MapsApiKey');
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Enter a Maps API key in Google Services app settings.');
    }
    return key.trim();
  }

  calculateRoute(input, includeMap) {
    return computeRoute(this.getMapsKey(), input, includeMap);
  }

  routeImagesEnabled() {
    return this.homey.settings.get('MapsRouteImagesEnabled') !== false;
  }

  async fetchRouteImage(map) {
    if (!this.routeImagesEnabled()) throw new Error('Route images are disabled in Google Services app settings.');
    return fetchMap(this.getMapsKey(), map);
  }

  async searchAddresses(query) {
    if (typeof query !== 'string') throw new Error('Enter an address or latitude, longitude.');
    if (!query.trim()) return [];
    const { origin } = parseRoute(query, query, 'DRIVE');
    const typed = {
      name: query.trim(),
      id: origin.text,
      description: this.homey.__('maps.address.typed_help')
    };
    if (origin.text.length < 3 || !origin.waypoint.address) return [typed];
    try {
      const suggestions = await autocompletePlaces(this.getMapsKey(), origin.text, this.homey.i18n.getLanguage());
      return [...suggestions.map(suggestion => ({
        name: suggestion.label, id: suggestion.value, description: 'Google Maps', google: true
      })), typed];
    } catch (error) {
      if (!(error instanceof Error) || !/^(Places API \(New\) |Enter a Maps API key in )/.test(error.message)) throw error;
      this.error('Maps address suggestions:', error.message);
      return [{ ...typed, description: this.homey.__('maps.address.search_unavailable', { error: error.message }) }];
    }
  }

  onPair(session) {
    let configured;
    session.setHandler('search_address', query => this.searchAddresses(query));
    session.setHandler('save_route', async data => {
      const input = parseRoute(data?.origin, data?.destination, data?.travel_mode);
      if (typeof data.route_image !== 'boolean') throw new Error('Choose whether to show the route image.');
      configured = {
        origin: input.origin.text, destination: input.destination.text,
        travel_mode: input.mode, route_image: data.route_image
      };
    });
    session.setHandler('list_devices', async () => {
      if (!configured) throw new Error('Configure the route before adding the device.');
      const devices = await this.onPairListDevices();
      return devices.map(device => ({ ...device, settings: { ...configured } }));
    });
  }

  async onPairListDevices() {
    const firstId = 'mapsdevice';
    const existing = this.getDevices().some(device => device.getData().id === firstId);
    return [{ name: 'Maps device', data: { id: existing ? uuidv4() : firstId } }];
  }
}

module.exports = MapsDriver;
