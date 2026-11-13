/**
 * Browser port of ShipmentEtaService.cls, so the public demo scores shipments
 * exactly the way the org does. Keep the constants in step with the Apex class.
 */
export const AT_RISK_BUFFER_HOURS = 4;
export const AVG_SPEED_KPH = { Truck: 65, Rail: 40, Ocean: 28, Air: 500 };
export const DEFAULT_SPEED_KPH = 65;

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance, the same haversine math as Apex Location.getDistance. */
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function speedFor(mode) {
  return AVG_SPEED_KPH[mode] ?? DEFAULT_SPEED_KPH;
}

export function classify(eta, promised, status) {
  if (!promised) {
    return null;
  }
  const slackHours = (promised - eta) / 3600000;
  if (slackHours < 0) {
    return 'Late';
  }
  if (slackHours < AT_RISK_BUFFER_HOURS || status === 'Delayed' || status === 'Exception') {
    return 'At Risk';
  }
  return 'On Time';
}

/** Mirrors ShipmentEtaService.estimate(). Times are epoch milliseconds. */
export function estimate({ mode, position, destination, asOf, promised, status }) {
  if (!position || !destination || asOf == null) {
    return null;
  }
  if (status === 'Delivered') {
    return { remainingKm: 0, estimatedArrival: null, lateRisk: null };
  }
  const km = distanceKm(position, destination);
  const minutes = Math.ceil((km / speedFor(mode)) * 60);
  const estimatedArrival = asOf + minutes * 60000;
  return {
    remainingKm: Math.round(km * 10) / 10,
    estimatedArrival,
    lateRisk: classify(estimatedArrival, promised, status)
  };
}
