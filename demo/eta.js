/**
 * Browser port of ShipmentEtaService.cls, so the public demo scores shipments
 * exactly the way the org does. Keep the constants in step with the Apex class.
 * Positions are [lng, lat]; times are epoch milliseconds.
 */
import { distanceKm, remainingKm } from './routeGeometry.js';

export const AT_RISK_BUFFER_HOURS = 4;
export const AVG_SPEED_KPH = { Truck: 65, Rail: 40, Ocean: 28, Air: 500 };
export const DEFAULT_SPEED_KPH = 65;

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

/** Mirrors ShipmentEtaService.estimate(), including distance along a planned route. */
export function estimate({ mode, position, destination, asOf, promised, status, path }) {
  if (!position || !destination || asOf == null) {
    return null;
  }
  if (status === 'Delivered') {
    return { remainingKm: 0, estimatedArrival: null, lateRisk: null };
  }
  const km = remainingKm(path ?? [], position) ?? distanceKm(position, destination);
  const minutes = Math.ceil((km / speedFor(mode)) * 60);
  const estimatedArrival = asOf + minutes * 60000;
  return {
    remainingKm: Math.round(km * 10) / 10,
    estimatedArrival,
    lateRisk: classify(estimatedArrival, promised, status)
  };
}
