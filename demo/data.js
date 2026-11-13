/**
 * The same demo network as scripts/apex/seed-demo-data.apex, built in the
 * browser and shaped like ShipmentMapController.getMapData() output.
 */
import { estimate, distanceKm, speedFor } from './eta.js';

const SITES = [
  ['Denver Distribution Center', 'Denver', 'CO', 39.7392, -104.9903],
  ['Chicago Cross-Dock', 'Chicago', 'IL', 41.8781, -87.6298],
  ['Dallas Fulfillment', 'Dallas', 'TX', 32.7767, -96.797],
  ['Atlanta Regional Hub', 'Atlanta', 'GA', 33.749, -84.388],
  ['Port of Long Beach Terminal', 'Long Beach', 'CA', 33.7701, -118.1937],
  ['Seattle Cold Storage', 'Seattle', 'WA', 47.6062, -122.3321],
  ['Memphis Air Gateway', 'Memphis', 'TN', 35.1495, -90.049],
  ['Newark Port Warehouse', 'Newark', 'NJ', 40.7357, -74.1724],
  ['Kansas City Rail Yard', 'Kansas City', 'MO', 39.0997, -94.5786],
  ['Phoenix Retail DC', 'Phoenix', 'AZ', 33.4484, -112.074],
  ['Minneapolis Grocery Co-op', 'Minneapolis', 'MN', 44.9778, -93.265],
  ['Salt Lake Parts Depot', 'Salt Lake City', 'UT', 40.7608, -111.891]
];

// origin, destination, mode, carrier, status, fraction travelled, promise (hours from now)
const LANES = [
  [0, 1, 'Truck', 'Front Range Freight', 'In Transit', 0.55, 20],
  [1, 0, 'Truck', 'Front Range Freight', 'In Transit', 0.3, 10],
  [4, 9, 'Truck', 'Desert Line Carriers', 'In Transit', 0.7, 9],
  [4, 0, 'Rail', 'Western Pacific Rail', 'Delayed', 0.4, 30],
  [4, 8, 'Rail', 'Western Pacific Rail', 'In Transit', 0.25, 60],
  [7, 3, 'Truck', 'Atlantic Coast Haulers', 'In Transit', 0.6, 7],
  [7, 1, 'Rail', 'Great Lakes Rail', 'In Transit', 0.5, 40],
  [6, 5, 'Air', 'Bluff City Air Cargo', 'In Transit', 0.45, 4],
  [6, 2, 'Air', 'Bluff City Air Cargo', 'Delivered', 1, -6],
  [2, 3, 'Truck', 'Lone Star Logistics', 'In Transit', 0.8, 6],
  [2, 9, 'Truck', 'Lone Star Logistics', 'Exception', 0.35, 14],
  [3, 7, 'Truck', 'Peach State Freight', 'In Transit', 0.2, 18],
  [8, 10, 'Truck', 'Heartland Transport', 'In Transit', 0.65, 4],
  [8, 2, 'Rail', 'Heartland Rail', 'In Transit', 0.15, 50],
  [5, 11, 'Truck', 'Cascade Reefer Lines', 'In Transit', 0.5, 12],
  [5, 4, 'Ocean', 'Pacific Coastal Shipping', 'In Transit', 0.3, 48],
  [11, 0, 'Truck', 'Wasatch Express', 'Delivered', 1, -20],
  [11, 9, 'Truck', 'Wasatch Express', 'In Transit', 0.4, 6],
  [10, 1, 'Truck', 'North Star Freight', 'Delayed', 0.5, 5],
  [9, 2, 'Truck', 'Desert Line Carriers', 'In Transit', 0.1, 26],
  [0, 11, 'Truck', 'Front Range Freight', 'Booked', 0, 30],
  [1, 7, 'Truck', 'Great Lakes Express', 'Booked', 0, 40],
  [3, 6, 'Truck', 'Peach State Freight', 'In Transit', 0.75, 2],
  [7, 4, 'Air', 'Coast to Coast Air', 'In Transit', 0.6, 3]
];

const HOUR = 3600000;

export function buildNetwork(now = Date.now()) {
  const sites = SITES.map(([name, city, state, latitude, longitude], i) => ({
    id: `site-${i}`,
    name,
    city,
    state,
    latitude,
    longitude
  }));
  const shipments = LANES.map(([o, d, mode, carrier, status, f, promiseHours], i) => {
    const origin = sites[o];
    const destination = sites[d];
    const booked = status === 'Booked';
    return {
      id: `shp-${i + 1}`,
      name: `SHP-${String(i + 1).padStart(5, '0')}`,
      status,
      mode,
      carrier,
      originId: origin.id,
      originName: origin.name,
      destinationId: destination.id,
      destinationName: destination.name,
      promisedDelivery: now + promiseHours * HOUR,
      shippedAt: booked ? now + 6 * HOUR : now - 24 * HOUR,
      lastPingAt: booked ? null : now - 15 * 60000,
      latitude: origin.latitude + (destination.latitude - origin.latitude) * f,
      longitude: origin.longitude + (destination.longitude - origin.longitude) * f
    };
  });
  const siteById = new Map(sites.map((s) => [s.id, s]));
  shipments.forEach((s) => score(s, siteById, now));
  return { sites, shipments, siteById };
}

/** Same as the trigger: stamp remaining km, ETA, and late risk. */
export function score(s, siteById, now) {
  const dest = siteById.get(s.destinationId);
  let asOf = s.lastPingAt;
  if (asOf == null) {
    asOf = s.shippedAt && s.shippedAt > now ? s.shippedAt : now;
  }
  const e = estimate({
    mode: s.mode,
    position: { lat: s.latitude, lng: s.longitude },
    destination: { lat: dest.latitude, lng: dest.longitude },
    asOf,
    promised: s.promisedDelivery,
    status: s.status
  });
  s.remainingKm = e?.remainingKm ?? null;
  s.estimatedArrival = e?.estimatedArrival ?? null;
  s.lateRisk = e?.lateRisk ?? null;
}

/** Same as ShipmentPingSimulator.advance(): move in-transit freight `hours` of travel. */
export function advance(network, hours, now) {
  let moved = 0;
  for (const s of network.shipments) {
    if (s.status !== 'In Transit' && s.status !== 'Delayed') {
      continue;
    }
    const dest = network.siteById.get(s.destinationId);
    const here = { lat: s.latitude, lng: s.longitude };
    const there = { lat: dest.latitude, lng: dest.longitude };
    let speed = speedFor(s.mode);
    if (s.status === 'Delayed') {
      speed /= 4;
    }
    const remaining = distanceKm(here, there);
    const fraction = remaining === 0 ? 1 : Math.min(1, (speed * hours) / remaining);
    s.latitude = here.lat + (there.lat - here.lat) * fraction;
    s.longitude = here.lng + (there.lng - here.lng) * fraction;
    s.lastPingAt = now;
    if (fraction >= 1) {
      s.status = 'Delivered';
    }
    score(s, network.siteById, now);
    moved += 1;
  }
  return moved;
}
