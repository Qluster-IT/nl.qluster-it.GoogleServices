'use strict';

const fetch = require('node-fetch');
const routePlacesKey = 'maps_route_places';
const endpoints = ['origin', 'destination'];

const modes = new Map([
  ['DRIVE', 'driving'],
  ['TRANSIT', 'transit'],
  ['WALK', 'walking'],
  ['BICYCLE', 'bicycling']
]);

function waypoint(value) {
  const selected = typeof value === 'string' ? value : value?.id;
  const text = typeof selected === 'string' ? selected.trim() : '';
  if (!text || text.length > 512) throw new Error('Enter an origin and destination (address or latitude, longitude).');
  if (text.startsWith('place_id:')) {
    const placeId = text.slice(9);
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(placeId)) throw new Error('Choose a valid Google Maps location.');
    return { text, waypoint: { placeId } };
  }
  const pair = text.match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!pair) return { text, waypoint: { address: text } };
  const latitude = Number(pair[1]);
  const longitude = Number(pair[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Coordinates must be latitude (-90 to 90), longitude (-180 to 180).');
  }
  return { text: `${latitude},${longitude}`, waypoint: { location: { latLng: { latitude, longitude } } } };
}

function parseRoute(origin, destination, mode) {
  if (!modes.has(mode)) throw new Error('Choose a supported travel mode.');
  return { origin: waypoint(origin), destination: waypoint(destination), mode };
}

async function request(url, options, api) {
  let response;
  try {
    response = await fetch(url, { timeout: 10000, redirect: 'error', ...options });
  } catch {
    // Transport errors can contain the full URL, including the Static Maps key.
    throw new Error(`${api} could not be reached. Check the connection and try again.`);
  }
  if (!response.ok) {
    let googleError;
    if (/^application\/json\b/i.test(response.headers?.get('content-type') || '')) {
      try { googleError = (await response.json())?.error; } catch { /* Use the HTTP status when the body is unreadable. */ }
    } else response.body?.destroy();
    let message;
    if (response.status === 401 || response.status === 403) {
      message = `${api} denied access. Check billing, API enablement and restrictions on the Maps API key.`;
    } else if (response.status === 429) {
      message = `${api} quota exceeded. Try again later.`;
    } else if (response.status === 400) {
      message = `${api} rejected the request. Check the route and Maps API key.`;
    } else {
      message = `${api} returned HTTP ${response.status}.`;
    }
    const error = new Error(message);
    Object.defineProperties(error, { httpStatus: { value: response.status }, googleError: { value: googleError } });
    throw error;
  }
  return response;
}

function validateSavedRoute(data) {
  if (!modes.has(data?.travel_mode)) throw new Error('Choose a supported travel mode.');
  const result = {};
  for (const key of endpoints) {
    const useHomey = data[`${key}_homey`] ?? false;
    if (typeof useHomey !== 'boolean') throw new Error('Choose whether to use Homey’s location.');
    result[`${key}_homey`] = useHomey;
    result[key] = useHomey ? (data[key] ?? '') : waypoint(data[key]).text;
    if (typeof result[key] !== 'string' || result[key].length > 512) throw new Error('Enter a valid address.');
  }
  return result;
}

function parseRouteSettings(data) {
  const values = { ...data };
  const places = {};
  for (const key of endpoints) {
    const value = values[key];
    if (value && typeof value === 'object') {
      const { name, id } = value;
      const label = waypoint(name);
      const point = waypoint(id);
      if (!label.waypoint.address || !point.waypoint.placeId) throw new Error('Choose a valid Google Maps location.');
      values[key] = label.text;
      places[key] = { address: label.text, id: point.text };
    } else if (typeof value === 'string' && value.trim().startsWith('place_id:')) {
      throw new Error('Enter an address or select a Google Maps suggestion instead of a place ID.');
    }
  }
  const settings = validateSavedRoute(values);
  if (typeof data.route_image !== 'boolean') throw new Error('Choose whether to show the route image.');
  if (typeof data.route_traffic !== 'boolean') throw new Error('Choose whether to show traffic on the route image.');
  return { settings: { ...settings, travel_mode: data.travel_mode,
    route_image: data.route_image, route_traffic: data.route_traffic }, places };
}

function savedRouteEndpoint(settings, places, key) {
  const address = settings[key];
  return places?.[key]?.address === address ? places[key].id : address;
}

function resolveSavedRoute(settings, getLocation, places) {
  const mode = settings.travel_mode || 'DRIVE';
  const validated = validateSavedRoute({ ...settings, travel_mode: mode });
  const homeyPoint = validated.origin_homey || validated.destination_homey ? getLocation() : null;
  const point = key => validated[`${key}_homey`] ? homeyPoint : waypoint(savedRouteEndpoint(validated, places, key));
  return { origin: point('origin'), destination: point('destination'), mode };
}

function durationSeconds(duration) {
  return typeof duration === 'string' && /^\d+(\.\d+)?s$/.test(duration) ? Number(duration.slice(0, -1)) : NaN;
}

async function computeRoute(key, input, includeMap = false, includeTraffic = false) {
  const { origin, destination, mode } = input;
  const body = { origin: origin.waypoint, destination: destination.waypoint, travelMode: mode };
  const fields = ['routes.duration', 'routes.distanceMeters'];
  if (mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
    fields.push('routes.staticDuration', 'fallbackInfo.routingMode');
  }
  const traffic = includeMap && includeTraffic && mode === 'DRIVE';
  if (traffic) {
    body.extraComputations = ['TRAFFIC_ON_POLYLINE'];
    fields.push('routes.travelAdvisory.speedReadingIntervals');
  }
  if (includeMap) {
    body.polylineQuality = 'OVERVIEW';
    fields.push('routes.polyline.encodedPolyline', 'routes.legs.startLocation.latLng', 'routes.legs.endLocation.latLng');
  }
  const departure = Date.now();
  const response = await request('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fields.join(',')
    },
    body: JSON.stringify(body),
    size: 1024 * 1024
  }, 'Routes API');
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Routes API returned an unreadable response.');
  }
  const route = result?.routes?.[0];
  if (!route) throw new Error('Google Maps found no route for these locations and travel mode.');
  const seconds = durationSeconds(route.duration);
  if (!Number.isFinite(seconds)) throw new Error('Routes API did not return a valid duration.');
  const baseline = durationSeconds(route.staticDuration);
  // Google omits a zero-valued distance in some responses.
  const meters = route.distanceMeters ?? 0;
  if (!Number.isFinite(meters) || meters < 0) throw new Error('Routes API did not return a valid distance.');

  const link = new URL('https://www.google.com/maps/dir/');
  link.search = new URLSearchParams({
    api: '1', origin: origin.text, destination: destination.text, travelmode: modes.get(mode)
  }).toString();
  for (const [name, point] of [['origin', origin], ['destination', destination]]) {
    if (point.waypoint.placeId) {
      link.searchParams.set(name, name === 'origin' ? 'Origin' : 'Destination');
      link.searchParams.set(`${name}_place_id`, point.waypoint.placeId);
    }
  }
  const legs = route.legs || [];
  const intervals = traffic ? route.travelAdvisory?.speedReadingIntervals : undefined;
  return {
    durationSeconds: seconds,
    tokens: {
      minutes: Math.round(seconds / 6) / 10,
      kilometers: Math.round(meters / 10) / 100,
      eta: new Date(departure + seconds * 1000).toISOString(),
      link: link.href
    },
    delayMinutes: mode === 'DRIVE' && Number.isFinite(baseline) && result.fallbackInfo?.routingMode !== 'FALLBACK_TRAFFIC_UNAWARE'
      ? Math.round(Math.max(0, seconds - baseline) / 6) / 10 : null,
    map: route.polyline?.encodedPolyline ? {
      path: route.polyline.encodedPolyline,
      start: legs[0]?.startLocation?.latLng,
      end: legs[legs.length - 1]?.endLocation?.latLng,
      ...(Array.isArray(intervals) && intervals.length ? { intervals } : {})
    } : null
  };
}

async function autocompletePlaces(key, query, languageCode) {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 512) {
    throw new Error('Enter between 3 and 512 characters to search for an address.');
  }
  const response = await request('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text'
    },
    body: JSON.stringify({ input: query.trim(), languageCode }),
    size: 1024 * 1024
  }, 'Places API (New)');
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Places API (New) returned an unreadable response.');
  }
  if (!result || typeof result !== 'object' || (result.suggestions !== undefined && !Array.isArray(result.suggestions))) {
    throw new Error('Places API (New) returned invalid address suggestions.');
  }
  return (result.suggestions || []).map(suggestion => {
    const prediction = suggestion?.placePrediction;
    if (typeof prediction?.placeId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(prediction.placeId)
      || typeof prediction?.text?.text !== 'string') {
      throw new Error('Places API (New) returned an invalid address suggestion.');
    }
    return { label: prediction.text.text, value: `place_id:${prediction.placeId}` };
  });
}

async function lookupPlaceAddress(key, value, languageCode) {
  const { waypoint: { placeId } } = waypoint(value);
  if (!placeId) throw new Error('Choose a valid Google Maps location.');
  const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
  if (languageCode) url.searchParams.set('languageCode', languageCode);
  const response = await request(url.href, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'formattedAddress' },
    size: 1024 * 1024
  }, 'Places API (New)');
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Places API (New) returned an unreadable response.');
  }
  const address = result?.formattedAddress;
  if (typeof address !== 'string' || !address.trim() || address.length > 512 || address.trim().startsWith('place_id:')) {
    throw new Error('Places API (New) returned an invalid address.');
  }
  return address.trim();
}

const trafficColors = new Map([
  ['NORMAL', '0x16864AFF'], ['SLOW', '0xDC7600FF'], ['TRAFFIC_JAM', '0xC62828FF']
]);

function* trafficPaths(path, intervals) {
  let offset = 0;
  function readDelta() {
    let value = 0;
    for (let shift = 0; shift <= 30; shift += 5) {
      const byte = path.charCodeAt(offset++) - 63;
      if (!Number.isInteger(byte) || byte < 0 || byte > 63) break;
      value += (byte & 31) * 2 ** shift;
      if (byte < 32) return value % 2 ? -(value + 1) / 2 : value / 2;
    }
    throw new Error('Routes API returned an invalid encoded route.');
  }
  function encodeDelta(delta) {
    let value = delta < 0 ? -delta * 2 - 1 : delta * 2;
    let encoded = '';
    while (value >= 32) {
      encoded += String.fromCharCode((value & 31) + 95);
      value = Math.floor(value / 32);
    }
    return encoded + String.fromCharCode(value + 63);
  }
  const points = [];
  let lat = 0, lng = 0;
  while (offset < path.length) {
    lat += readDelta();
    lng += readDelta();
    points.push({ lat, lng, offset });
  }
  for (const interval of intervals) {
    const color = trafficColors.get(interval?.speed);
    if (!color) continue;
    const first = interval.startPolylinePointIndex ?? 0;
    const last = interval.endPolylinePointIndex;
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last <= first || last >= points.length) {
      throw new Error('Routes API returned an invalid traffic interval.');
    }
    // Include the endpoint so adjacent painted road segments meet at their shared point.
    const start = points[first];
    yield `color:${color}|weight:5|enc:${encodeDelta(start.lat)}${encodeDelta(start.lng)}${path.slice(start.offset, points[last].offset)}`;
  }
}

async function fetchMap(key, map, onTrafficOmitted) {
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.search = new URLSearchParams({
    size: '640x400', scale: '2', format: 'png', maptype: 'roadmap',
    path: `color:0x155BE9FF|weight:5|enc:${map.path}`, key
  }).toString();
  for (const [label, point] of [['A', map.start], ['B', map.end]]) {
    if (Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)) {
      url.searchParams.append('markers', `color:0x155BE9|label:${label}|${point.latitude},${point.longitude}`);
    }
  }
  if (url.href.length > 16384) throw new Error('This route is too detailed for a Google Maps image.');
  if (map.intervals?.length) {
    const colored = new URL(url);
    for (const path of trafficPaths(map.path, map.intervals)) {
      colored.searchParams.append('path', path);
      if (colored.href.length > 16384) {
        onTrafficOmitted?.();
        break;
      }
    }
    if (colored.href.length <= 16384) url.search = colored.search;
  }
  const response = await request(url.href, { size: 5 * 1024 * 1024 }, 'Maps Static API');
  if (!/^image\/png\b/i.test(response.headers.get('content-type') || '') || response.headers.has('x-staticmap-api-warning')) {
    response.body?.destroy();
    throw new Error('Maps Static API did not return a complete route image.');
  }
  try {
    return await response.buffer();
  } catch {
    throw new Error('The Maps Static API image could not be downloaded.');
  }
}

module.exports = { parseRoute, validateSavedRoute, parseRouteSettings, resolveSavedRoute, savedRouteEndpoint,
  routePlacesKey, computeRoute, autocompletePlaces, lookupPlaceAddress, fetchMap, request };
