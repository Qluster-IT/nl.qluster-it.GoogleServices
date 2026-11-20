'use strict';

function arrivalTime(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const asUtc = ([year, month, day, hour, minute]) => Date.UTC(year, month - 1, day, hour, minute);
  const wallTime = asUtc(parts);
  // Sample both sides of any clock change, then require an exact local-time match.
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  });
  const fields = ['year', 'month', 'day', 'hour', 'minute'];
  const localParts = instant => {
    const formatted = formatter.formatToParts(instant);
    return fields.map(field => Number(formatted.find(({ type }) => type === field)?.value));
  };
  const matches = new Set();
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = wallTime + delta;
    const candidate = wallTime - (asUtc(localParts(sample)) - sample);
    if (localParts(candidate).every((part, i) => part === parts[i])) matches.add(candidate);
  }
  // Do not guess which occurrence the user meant when clocks go back.
  return matches.size === 1 ? matches.values().next().value : null;
}

function leaveByTime(arrival, durationSeconds, bufferMinutes) {
  if (!Number.isFinite(arrival) || !Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  // Round down so the displayed minute never omits a fraction of travel time.
  return Math.floor((arrival - durationSeconds * 1000 - bufferMinutes * 60000) / 60000) * 60000;
}

module.exports = { arrivalTime, leaveByTime };
