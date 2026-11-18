'use strict';

const fetch = require('node-fetch');

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
    response.body?.destroy();
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${api} denied access. Check billing, API enablement and restrictions on the Maps API key.`);
    }
    if (response.status === 429) throw new Error(`${api} quota exceeded. Try again later.`);
    if (response.status === 400) throw new Error(`${api} rejected the request. Check the route and Maps API key.`);
    throw new Error(`${api} returned HTTP ${response.status}.`);
  }
  return response;
}

async function computeRoute(key, input, includeMap = false) {
  const { origin, destination, mode } = input;
  const body = { origin: origin.waypoint, destination: destination.waypoint, travelMode: mode };
  const fields = ['routes.duration', 'routes.distanceMeters'];
  if (mode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
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
  const seconds = typeof route.duration === 'string' && /^\d+(\.\d+)?s$/.test(route.duration)
    ? Number(route.duration.slice(0, -1)) : NaN;
  if (!Number.isFinite(seconds)) throw new Error('Routes API did not return a valid duration.');
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
  return {
    tokens: {
      minutes: Math.round(seconds / 6) / 10,
      kilometers: Math.round(meters / 10) / 100,
      eta: new Date(departure + seconds * 1000).toISOString(),
      link: link.href
    },
    map: route.polyline?.encodedPolyline ? {
      path: route.polyline.encodedPolyline,
      start: legs[0]?.startLocation?.latLng,
      end: legs[legs.length - 1]?.endLocation?.latLng
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

async function fetchMap(key, map) {
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

module.exports = { parseRoute, computeRoute, autocompletePlaces, fetchMap };
