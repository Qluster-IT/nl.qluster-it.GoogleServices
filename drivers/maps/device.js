'use strict';

const Homey = require('homey');
const { pipeline, Readable } = require('stream');
const pipe = require('util').promisify(pipeline);
const { validateSavedRoute, resolveSavedRoute, savedRouteEndpoint, routePlacesKey } = require('../../lib/maps');
const { arrivalTime, leaveByTime } = require('../../lib/maps-leave-by');

const readings = ['maps_minutes', 'maps_distance', 'maps_eta', 'maps_last_refreshed', 'maps_traffic_delay', 'maps_leave_by'];
const routeStoreKey = 'maps_route_state';
const leaveBySettings = ['arrival_deadline', 'departure_buffer'];

class MapsDevice extends Homey.Device {
  async onInit() {
    for (const capability of ['maps_refresh', ...readings]) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
    const storedRoute = this.getStoreValue(routeStoreKey);
    if (storedRoute?.version === 1 && typeof storedRoute.map?.path === 'string') {
      this.routeMap = storedRoute.map;
      if (typeof storedRoute.image === 'string' && storedRoute.image.length > 0) {
        this.routeImage = Promise.resolve(Buffer.from(storedRoute.image, 'base64'));
      }
    }
    await this.setCapabilityValue('maps_refresh', false);
    this.registerCapabilityListener('maps_refresh', async () => {
      if (this.buttonRefreshInProgress) return;
      this.buttonRefreshInProgress = true;
      try {
        await this.refreshRoute();
      } finally {
        this.buttonRefreshInProgress = false;
        await this.setCapabilityValue('maps_refresh', false);
      }
    });
    this.image = await this.homey.images.createImage();
    this.image.setStream(async stream => {
      const map = this.routeMap;
      if (!map || !this.driver.routeImagesEnabled()) throw new Error(this.homey.__('maps.image_unavailable'));
      try {
        // Keep failed attempts too: only an explicit route refresh permits another Google request.
        if (!this.routeImage) {
          this.routeImage = this.driver.fetchRouteImage(map).then(async bytes => {
            if (this.routeMap !== map || !this.driver.routeImagesEnabled()) {
              throw new Error('The route image is no longer available.');
            }
            await this.setStoreValue(routeStoreKey, {
              ...this.getStoreValue(routeStoreKey), version: 1, map, image: bytes.toString('base64')
            });
            return bytes;
          });
        }
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
    if (storedRoute?.durationSeconds != null || this.getSetting('arrival_deadline')) {
      await this.updateLeaveBy(this.getSettings(), storedRoute?.durationSeconds);
    }
    if (!this.routeMap) {
      await this.setWarning((this.getSetting('origin_homey') || this.getSetting('origin'))
        && (this.getSetting('destination_homey') || this.getSetting('destination'))
        ? this.homey.__('maps.refresh_needed') : this.homey.__('maps.setup_needed'));
    }
  }

  async onSettings({ newSettings, changedKeys }) {
    const planningChanged = changedKeys.some(key => leaveBySettings.includes(key));
    if (planningChanged) {
      const { deadline, buffer } = this.getLeaveByOptions(newSettings);
      if (newSettings.arrival_deadline?.trim() && deadline === null) throw new Error(this.homey.__('maps.invalid_deadline'));
      if (!Number.isInteger(buffer) || buffer < 0 || buffer > 1440) throw new Error(this.homey.__('maps.invalid_buffer'));
    }
    if (!changedKeys.some(key => ['origin', 'destination', 'origin_homey', 'destination_homey', 'travel_mode', 'route_image'].includes(key))) {
      if (planningChanged) {
        await this.pendingRefresh?.catch(() => {});
        await this.updateLeaveBy(newSettings, this.getStoreValue(routeStoreKey)?.durationSeconds);
      }
      return;
    }
    validateSavedRoute(newSettings);
    const stored = this.getStoreValue(routePlacesKey);
    const places = { ...stored };
    for (const key of ['origin', 'destination']) {
      if (!changedKeys.includes(key)) continue;
      if (newSettings[key]?.trim().startsWith('place_id:')) throw new Error(this.homey.__('maps.use_readable_address'));
      delete places[key];
    }
    await this.changeRouteSettings(undefined, Object.keys(stored ?? {}).length !== Object.keys(places).length ? places : undefined);
  }

  async updateRouteSettings(settings, selectedPlaces) {
    const current = this.getSettings();
    const stored = this.getStoreValue(routePlacesKey);
    const places = {};
    const defaults = { origin: '', destination: '', origin_homey: false, destination_homey: false,
      travel_mode: 'DRIVE', route_image: true, route_traffic: true };
    let updatePlaces = false;
    let changeRoute = false;
    for (const key of ['origin', 'destination']) {
      const old = stored?.[key];
      const next = selectedPlaces[key] ?? (old?.address === settings[key] ? old : undefined);
      if (next) places[key] = next;
      if (old?.id !== next?.id || old?.address !== next?.address) updatePlaces = true;
      if (!settings[`${key}_homey`] &&
        savedRouteEndpoint(settings, places, key) !== savedRouteEndpoint(current, stored, key)?.trim()) changeRoute = true;
    }
    const changes = {};
    for (const [key, value] of Object.entries(settings)) {
      if (value !== (current[key] ?? defaults[key])) changes[key] = value;
    }
    const keys = Object.keys(changes);
    changeRoute ||= keys.some(key => !['origin', 'destination', 'route_traffic'].includes(key));
    if (updatePlaces || changeRoute) await this.changeRouteSettings(changes, updatePlaces ? places : undefined, changeRoute);
    else if (keys.length) await this.setSettings(changes);
  }

  async changeRouteSettings(changes, places, clear = true) {
    if (this.changingSettings) throw new Error(this.homey.__('maps.settings_busy'));
    this.changingSettings = true;
    try {
      if (this.pendingRefresh) await this.pendingRefresh.catch(() => {});
      // Programmatic settings changes do not call onSettings.
      const previousPlaces = places ? this.getStoreValue(routePlacesKey) : undefined;
      if (places) await this.setStoreValue(routePlacesKey, places);
      try {
        if (changes && Object.keys(changes).length) await this.setSettings(changes);
      } catch (error) {
        if (places) {
          if (previousPlaces) await this.setStoreValue(routePlacesKey, previousPlaces);
          else await this.unsetStoreValue(routePlacesKey);
        }
        throw error;
      }
      if (clear) {
        await this.clearReadings();
        await this.setWarning(this.homey.__('maps.refresh_needed'));
      }
    } finally {
      this.changingSettings = false;
    }
  }

  async clearReadings() {
    this.routeMap = null;
    this.routeImage = null;
    await this.unsetStoreValue(routeStoreKey);
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

  getHomeyRoutePoint() {
    const latitude = this.homey.geolocation.getLatitude();
    const longitude = this.homey.geolocation.getLongitude();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new Error(this.homey.__('maps.homey_location_unavailable'));
    }
    return { text: `${latitude},${longitude}`, waypoint: { location: { latLng: { latitude, longitude } } } };
  }

  getLeaveByOptions(settings) {
    const value = settings.arrival_deadline?.trim();
    return {
      deadline: value ? arrivalTime(value, this.homey.clock.getTimezone()) : null,
      buffer: settings.departure_buffer ?? 0
    };
  }

  async updateLeaveBy(settings, durationSeconds) {
    const { deadline, buffer } = this.getLeaveByOptions(settings);
    const time = leaveByTime(deadline, durationSeconds, buffer);
    const value = time === null ? null : new Intl.DateTimeFormat(this.homey.i18n.getLanguage(), {
      timeZone: this.homey.clock.getTimezone(), year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }).format(time);
    await this.setCapabilityValue('maps_leave_by', value);
  }

  async updateRoute() {
    try {
      const previousMinutes = this.getCapabilityValue('maps_minutes');
      const settings = this.getSettings();
      const { route_image, route_traffic } = settings;
      const input = resolveSavedRoute(settings, () => this.getHomeyRoutePoint(), this.getStoreValue(routePlacesKey));
      const showMap = route_image !== false && this.driver.routeImagesEnabled();
      const { tokens, map, delayMinutes, durationSeconds } = await this.driver.calculateRoute(input, showMap, showMap && route_traffic !== false);
      if (this.changingSettings || this.closed) throw new Error('The route changed during refresh. Try again.');
      const formatLocalTime = new Intl.DateTimeFormat(this.homey.i18n.getLanguage(), {
        timeZone: this.homey.clock.getTimezone(), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      await this.setStoreValue(routeStoreKey, { version: 1, map, image: null, durationSeconds });
      await Promise.all([
        this.setCapabilityValue('maps_minutes', tokens.minutes),
        this.setCapabilityValue('maps_distance', tokens.kilometers),
        this.setCapabilityValue('maps_traffic_delay', delayMinutes ?? null),
        this.setCapabilityValue('maps_eta', formatLocalTime.format(new Date(tokens.eta))),
        this.updateLeaveBy(this.getSettings(), durationSeconds)
      ]);
      this.routeMap = map;
      this.routeImage = null;
      await this.image.update();
      await this.setWarning(showMap && !map ? this.homey.__('maps.image_missing') : null);
      await this.setCapabilityValue('maps_last_refreshed', formatLocalTime.format(new Date()));
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
