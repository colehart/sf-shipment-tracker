/**
 * Route math shared by the map component, the static demo, and the route
 * script. Mirrors RouteGeometry.cls so the browser and Apex agree on distances.
 *
 * Coordinates are [lng, lat] arrays (GeoJSON order). Routes are stored as
 * Google encoded polylines at precision 5, the format OSRM returns.
 */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance in km between two [lng, lat] points (haversine). */
export function distanceKm(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function decodePolyline(encoded) {
  const coords = [];
  if (!encoded) {
    return coords;
  }
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng']) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') {
        lat += delta;
      } else {
        lng += delta;
      }
    }
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

function encodeValue(value) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(coords) {
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  for (const [lng, lat] of coords) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += encodeValue(iLat - prevLat) + encodeValue(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

export function lengthKm(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += distanceKm(coords[i - 1], coords[i]);
  }
  return total;
}

/** Index of the route vertex closest to a point. */
export function nearestIndex(coords, point) {
  let best = 0;
  let bestKm = Infinity;
  coords.forEach((c, i) => {
    const km = distanceKm(c, point);
    if (km < bestKm) {
      bestKm = km;
      best = i;
    }
  });
  return best;
}

/**
 * Splits a route at the vertex nearest the current position.
 * Returns the travelled and remaining legs, each starting or ending at `point`.
 */
export function splitAt(coords, point) {
  if (coords.length < 2) {
    return { travelled: [], remaining: [] };
  }
  const i = nearestIndex(coords, point);
  return {
    travelled: [...coords.slice(0, i + 1), point],
    remaining: [point, ...coords.slice(i + 1)]
  };
}

/** Distance left to drive from `point` to the end of the route. */
export function remainingKm(coords, point) {
  if (coords.length < 2) {
    return null;
  }
  const i = nearestIndex(coords, point);
  return distanceKm(point, coords[i]) + lengthKm(coords.slice(i));
}

/** The point a given fraction (0 to 1) of the way along the route. */
export function pointAt(coords, fraction) {
  if (!coords.length) {
    return null;
  }
  const target = Math.max(0, Math.min(1, fraction)) * lengthKm(coords);
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const leg = distanceKm(coords[i - 1], coords[i]);
    if (walked + leg >= target) {
      const t = leg === 0 ? 0 : (target - walked) / leg;
      const [x0, y0] = coords[i - 1];
      const [x1, y1] = coords[i];
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    walked += leg;
  }
  return coords[coords.length - 1];
}

/** Points along the great circle from a to b, for drawing air lanes. */
export function greatCircle(a, b, segments = 32) {
  const [lng1, lat1] = a.map(toRad);
  const [lng2, lat2] = b.map(toRad);
  const d = distanceKm(a, b) / EARTH_RADIUS_KM;
  if (d === 0) {
    return [a, b];
  }
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    points.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return points;
}
