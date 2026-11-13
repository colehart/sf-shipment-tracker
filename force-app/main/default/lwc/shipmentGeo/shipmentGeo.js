/**
 * Pure helpers that turn ShipmentMapController data into GeoJSON and list rows.
 * No DOM or MapLibre access lives here, so all of it is unit tested in Jest.
 */

export const RISK = Object.freeze({
  ON_TIME: 'On Time',
  AT_RISK: 'At Risk',
  LATE: 'Late',
  NONE: 'Unscored'
});

// SLDS palette tokens, as hex because MapLibre paint properties cannot read CSS variables.
export const RISK_COLORS = Object.freeze({
  [RISK.ON_TIME]: '#2e844a',
  [RISK.AT_RISK]: '#dd7a01',
  [RISK.LATE]: '#ba0517',
  [RISK.NONE]: '#747474'
});

const RISK_ORDER = [RISK.LATE, RISK.AT_RISK, RISK.ON_TIME, RISK.NONE];

export function riskOf(shipment) {
  if (shipment.status === 'Delivered') {
    return RISK.NONE;
  }
  return shipment.lateRisk || RISK.NONE;
}

function hasCoords(item) {
  return Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude);
}

function point(lng, lat, properties) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties
  };
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

export function siteFeatures(sites = []) {
  return featureCollection(
    sites.filter(hasCoords).map((s) =>
      point(s.longitude, s.latitude, {
        id: s.id,
        name: s.name,
        place: [s.city, s.state].filter(Boolean).join(', ')
      })
    )
  );
}

export function shipmentFeatures(shipments = [], selectedId = null) {
  return featureCollection(
    shipments.filter(hasCoords).map((s) => {
      const risk = riskOf(s);
      return point(s.longitude, s.latitude, {
        id: s.id,
        name: s.name,
        risk,
        color: RISK_COLORS[risk],
        delivered: s.status === 'Delivered',
        selected: s.id === selectedId
      });
    })
  );
}

/**
 * Two line features per shipment: the leg already travelled (origin to current
 * position) and the leg remaining (current position to destination).
 */
export function routeFeatures(shipments = [], sites = []) {
  const siteById = new Map(sites.filter(hasCoords).map((s) => [s.id, s]));
  const features = [];
  for (const s of shipments) {
    const origin = siteById.get(s.originId);
    const destination = siteById.get(s.destinationId);
    if (!hasCoords(s) || !destination || s.status === 'Delivered') {
      continue;
    }
    const here = [s.longitude, s.latitude];
    const risk = riskOf(s);
    if (origin) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[origin.longitude, origin.latitude], here] },
        properties: { id: s.id, leg: 'travelled', color: RISK_COLORS[risk] }
      });
    }
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [here, [destination.longitude, destination.latitude]]
      },
      properties: { id: s.id, leg: 'remaining', color: RISK_COLORS[risk] }
    });
  }
  return featureCollection(features);
}

/** [[west, south], [east, north]] around every site and shipment, or null when empty. */
export function boundsOf(sites = [], shipments = []) {
  const points = [...sites, ...shipments].filter(hasCoords);
  if (!points.length) {
    return null;
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.longitude);
    east = Math.max(east, p.longitude);
    south = Math.min(south, p.latitude);
    north = Math.max(north, p.latitude);
  }
  return [
    [west, south],
    [east, north]
  ];
}

export function summarize(shipments = []) {
  const counts = { [RISK.ON_TIME]: 0, [RISK.AT_RISK]: 0, [RISK.LATE]: 0, [RISK.NONE]: 0 };
  for (const s of shipments) {
    counts[riskOf(s)] += 1;
  }
  return counts;
}

export function filterByRisk(shipments = [], risk = null) {
  return risk ? shipments.filter((s) => riskOf(s) === risk) : shipments;
}

/** Late first, then at risk, then on time; ties broken by earliest promised delivery. */
export function sortForTriage(shipments = []) {
  return [...shipments].sort((a, b) => {
    const byRisk = RISK_ORDER.indexOf(riskOf(a)) - RISK_ORDER.indexOf(riskOf(b));
    if (byRisk !== 0) {
      return byRisk;
    }
    const aTime = a.promisedDelivery ? Date.parse(a.promisedDelivery) : Infinity;
    const bTime = b.promisedDelivery ? Date.parse(b.promisedDelivery) : Infinity;
    return aTime - bTime;
  });
}

/** How far past (positive) or ahead of (negative) the promise the ETA is, in whole hours. */
export function slackHours(shipment) {
  if (!shipment.estimatedArrival || !shipment.promisedDelivery) {
    return null;
  }
  const ms = Date.parse(shipment.promisedDelivery) - Date.parse(shipment.estimatedArrival);
  return Math.round(ms / 3600000);
}

/** Plain-language slack for the list, e.g. "3h ahead of promise". Empty when not applicable. */
export function slackLabel(shipment) {
  if (shipment.status === 'Delivered' || !shipment.estimatedArrival || !shipment.promisedDelivery) {
    return '';
  }
  const ms = Date.parse(shipment.promisedDelivery) - Date.parse(shipment.estimatedArrival);
  const hours = Math.floor(Math.abs(ms) / 3600000);
  const amount = hours < 1 ? 'Under 1h' : `${hours}h`;
  return ms >= 0 ? `${amount} ahead of promise` : `${amount} past promise`;
}

/** Markers for the built-in lightning-map, used when MapLibre cannot start. */
export function fallbackMarkers(sites = [], shipments = []) {
  const siteMarkers = sites.filter(hasCoords).map((s) => ({
    location: { Latitude: s.latitude, Longitude: s.longitude },
    title: s.name,
    description: [s.city, s.state].filter(Boolean).join(', '),
    icon: 'standard:account',
    value: s.id
  }));
  const shipmentMarkers = shipments.filter(hasCoords).map((s) => ({
    location: { Latitude: s.latitude, Longitude: s.longitude },
    title: `${s.name} · ${riskOf(s)}`,
    description: `${s.originName || '?'} to ${s.destinationName || '?'} (${s.status || 'No status'})`,
    icon: 'custom:custom98',
    value: s.id
  }));
  return [...siteMarkers, ...shipmentMarkers];
}
