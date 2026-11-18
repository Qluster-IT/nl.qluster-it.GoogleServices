'use strict';

const Homey = require('homey');
const { pipeline, Readable } = require('stream');
const pipe = require('util').promisify(pipeline);
const { parseRoute } = require('../../lib/maps');

const readings = ['maps_minutes', 'maps_distance', 'maps_eta', 'maps_last_refreshed'];

class MapsDevice extends Homey.Device {
  async onInit() {
    for (const capability of ['maps_refresh', ...readings]) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
    await this.setCapabilityValue('maps_refresh', false);
    this.registerCapabilityListener('maps_refresh', async () => {
      try {
        await this.refreshRoute();
      } finally {
        await this.setCapabilityValue('maps_refresh', false);
      }
    });
    this.image = await this.homey.images.createImage();
    this.image.setStream(async stream => {
      const map = this.routeMap;
      if (!map || !this.driver.routeImagesEnabled()) throw new Error(this.homey.__('maps.image_unavailable'));
      try {
        // Keep failed attempts too: only an explicit route refresh permits another Google request.
        if (!this.routeImage) this.routeImage = this.driver.fetchRouteImage(map);
        const bytes = await this.routeImage;
        if (this.routeMap !== map || !this.driver.routeImagesEnabled()) {
          throw new Error('The route image is no longer available.');
        }
        await pipe(Readable.from([bytes]), stream);
      } catch (error) {
        this.error(error.message);
        throw error;
      }
    });
    await this.setCameraImage('route', this.homey.__('maps.image_title'), this.image);
    await this.clearReadings();
    await this.setWarning(this.getSetting('origin') && this.getSetting('destination')
      ? this.homey.__('maps.refresh_needed') : this.homey.__('maps.setup_needed'));
  }

  async onSettings({ newSettings, changedKeys }) {
    if (!changedKeys.some(key => ['origin', 'destination', 'travel_mode', 'route_image'].includes(key))) return;
    parseRoute(newSettings.origin, newSettings.destination, newSettings.travel_mode);
    this.changingSettings = true;
    try {
      if (this.pendingRefresh) await this.pendingRefresh.catch(() => {});
      await this.clearReadings();
      await this.setWarning(this.homey.__('maps.refresh_needed'));
    } finally {
      this.changingSettings = false;
    }
  }

  async clearReadings() {
    this.routeMap = null;
    this.routeImage = null;
    await Promise.all(readings.map(id => this.setCapabilityValue(id, null)));
    await this.image.update();
  }

  refreshRoute() {
    if (this.changingSettings) return Promise.reject(new Error('Route settings are changing. Try again.'));
    if (!this.pendingRefresh) {
      this.pendingRefresh = this.updateRoute().finally(() => { this.pendingRefresh = null; });
    }
    return this.pendingRefresh;
  }

  async updateRoute() {
    try {
      const previousMinutes = this.getCapabilityValue('maps_minutes');
      const { origin, destination, travel_mode, route_image } = this.getSettings();
      const input = parseRoute(origin, destination, travel_mode || 'DRIVE');
      const showMap = route_image !== false && this.driver.routeImagesEnabled();
      const { tokens, map } = await this.driver.calculateRoute(input, showMap);
      if (this.changingSettings || this.closed) throw new Error('The route changed during refresh. Try again.');
      await Promise.all([
        this.setCapabilityValue('maps_minutes', tokens.minutes),
        this.setCapabilityValue('maps_distance', tokens.kilometers),
        this.setCapabilityValue('maps_eta', new Intl.DateTimeFormat(this.homey.i18n.getLanguage(), {
          timeZone: this.homey.clock.getTimezone(), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        }).format(new Date(tokens.eta)))
      ]);
      this.routeMap = map;
      this.routeImage = null;
      await this.image.update();
      await this.setWarning(showMap && !map ? this.homey.__('maps.image_missing') : null);
      await this.setCapabilityValue('maps_last_refreshed', new Intl.DateTimeFormat(this.homey.i18n.getLanguage(), {
        timeZone: this.homey.clock.getTimezone(), year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit'
      }).format(new Date()));
      this.triggerRouteEvent('maps_route_updated', tokens);
      if (Number.isFinite(previousMinutes) && previousMinutes !== tokens.minutes) {
        this.triggerRouteEvent('maps_travel_time_changed', {
          minutes: tokens.minutes, previous_minutes: previousMinutes,
          change_minutes: Math.round((tokens.minutes - previousMinutes) * 10) / 10
        });
      }
      return tokens;
    } catch (error) {
      if (!this.changingSettings && !this.closed) {
        await this.setWarning(error.message);
        this.triggerRouteEvent('maps_refresh_failed', { error: error.message });
      }
      throw error;
    }
  }

  triggerRouteEvent(id, tokens) {
    // A triggered Flow may refresh this device again, so do not wait for it.
    void this.homey.flow.getDeviceTriggerCard(id).trigger(this, tokens)
      .catch(error => this.error(`Could not trigger ${id}:`, error));
  }

  async onUninit() {
    this.closed = true;
    this.routeMap = null;
    this.routeImage = null;
    if (this.pendingRefresh) await this.pendingRefresh.catch(() => {});
    if (this.image) await this.image.unregister();
  }
}

module.exports = MapsDevice;
