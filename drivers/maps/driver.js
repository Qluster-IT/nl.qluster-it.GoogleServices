'use strict';

const Homey = require('homey');
const { v4: uuidv4 } = require('uuid');
const { parseRoute, parseRouteSettings, routePlacesKey, computeRoute, autocompletePlaces,
  lookupPlaceAddress, fetchMap } = require('../../lib/maps');

class MapsDriver extends Homey.Driver {
  onInit() {
    this.homey.flow.getActionCard('maps_refresh_route')
      .registerRunListener(async ({ device }) => { await device.refreshRoute(); });
    const calculate = this.homey.flow.getActionCard('maps_calculate_route');
    calculate.registerRunListener(async ({ from, to, mode }) => {
      const { tokens } = await this.calculateRoute(parseRoute(from, to, mode));
      return tokens;
    });
    const tripTakesLonger = this.homey.flow.getConditionCard('maps_trip_takes_longer');
    tripTakesLonger.registerRunListener(async ({ from, to, mode, minutes }) => {
      if (!Number.isFinite(minutes) || minutes < 0) throw new Error(this.homey.__('maps.invalid_minutes'));
      const { durationSeconds } = await this.calculateRoute(parseRoute(from, to, mode));
      return durationSeconds / 60 > minutes;
    });
    for (const card of [calculate, tripTakesLonger]) {
      for (const name of ['from', 'to']) {
        card.getArgument(name).registerAutocompleteListener(query => this.searchAddresses(query));
      }
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

  calculateRoute(input, includeMap, showTraffic) {
    const includeTraffic = showTraffic && this.homey.settings.get('MapsRouteTrafficEnabled') !== false;
    return computeRoute(this.getMapsKey(), input, includeMap, includeTraffic);
  }

  routeImagesEnabled() {
    return this.homey.settings.get('MapsRouteImagesEnabled') !== false;
  }

  async fetchRouteImage(map) {
    if (!this.routeImagesEnabled()) throw new Error('Route images are disabled in Google Services app settings.');
    return fetchMap(this.getMapsKey(), map, () => this.log('Route is too detailed for traffic colors; showing the blue route.'));
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
      configured = parseRouteSettings(data);
    });
    session.setHandler('list_devices', async () => {
      if (!configured) throw new Error('Configure the route before adding the device.');
      const devices = await this.onPairListDevices();
      const { settings, places } = configured;
      return devices.map(device => ({ ...device, settings: { ...settings }, store: { [routePlacesKey]: places } }));
    });
  }

  onRepair(session, device) {
    session.setHandler('get_route_settings', async () => {
      const { origin, destination, origin_homey, destination_homey, travel_mode, route_image, route_traffic } = device.getSettings();
      const settings = { origin, destination, travel_mode: travel_mode || 'DRIVE',
        origin_homey: origin_homey === true, destination_homey: destination_homey === true,
        route_image: route_image !== false, route_traffic: route_traffic !== false };
      const unresolved = await Promise.all(['origin', 'destination'].map(async endpoint => {
        const id = settings[endpoint];
        if (typeof id !== 'string' || !id.trim().startsWith('place_id:')) return false;
        try {
          const name = await lookupPlaceAddress(this.getMapsKey(), id, this.homey.i18n.getLanguage());
          settings[endpoint] = { name, id };
          return false;
        } catch (error) {
          // Do not log addresses or saved IDs; Repair lets the user replace a failed lookup.
          this.error('Maps could not look up a saved place:', error.message);
          settings[endpoint] = '';
          return true;
        }
      }));
      if (unresolved.some(Boolean)) settings.address_lookup_failed = true;
      return settings;
    });
    session.setHandler('search_address', query => this.searchAddresses(query));
    session.setHandler('save_route_settings', async data => {
      const { settings, places } = parseRouteSettings(data);
      await device.updateRouteSettings(settings, places);
    });
  }

  async onPairListDevices() {
    const firstId = 'mapsdevice';
    const existing = this.getDevices().some(device => device.getData().id === firstId);
    return [{ name: 'Maps device', data: { id: existing ? uuidv4() : firstId } }];
  }
}

module.exports = MapsDriver;
