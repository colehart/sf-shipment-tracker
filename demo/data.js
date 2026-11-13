/**
 * Builds the demo network from shipmentDemoData.json, the same static resource
 * scripts/apex/seed-demo-data.apex loads into the org, shaped like
 * ShipmentMapController.getMapData() output.
 */
import { estimate, speedFor } from './eta.js';
import { decodePolyline, distanceKm, pointAt, remainingKm } from './routeGeometry.js';

const HOUR = 3600000;

export async function loadNetworkData() {
  const res = await fetch('./shipmentDemoData.json');
  if (!res.ok) {
    throw new Error(`Demo data failed to load (${res.status})`);
  }
  return res.json();
}

export function buildNetwork(data, now = Date.now()) {
  const sites = data.sites.map((s, i) => ({
    id: `site-${i}`,
    name: s.name,
    city: s.city,
    state: s.state,
    latitude: s.lat,
    longitude: s.lng
  }));
  const shipments = data.lanes.map((lane, i) => {
    const origin = sites[lane.origin];
    const destination = sites[lane.destination];
    const booked = lane.status === 'Booked';
    const path = decodePolyline(lane.route);
    let position;
    if (path.length >= 2) {
      position = pointAt(path, lane.progress);
    } else {
      position = [
        origin.longitude + (destination.longitude - origin.longitude) * lane.progress,
        origin.latitude + (destination.latitude - origin.latitude) * lane.progress
      ];
    }
    return {
      id: `shp-${i + 1}`,
      name: `SHP-${String(i + 1).padStart(5, '0')}`,
      status: lane.status,
      mode: lane.mode,
      carrier: lane.carrier,
      route: lane.route,
      path,
      originId: origin.id,
      originName: origin.name,
      destinationId: destination.id,
      destinationName: destination.name,
      promisedDelivery: now + lane.promiseHours * HOUR,
      shippedAt: booked ? now + 6 * HOUR : now - 24 * HOUR,
      lastPingAt: booked ? null : now - 15 * 60000,
      longitude: position[0],
      latitude: position[1]
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
    position: [s.longitude, s.latitude],
    destination: [dest.longitude, dest.latitude],
    asOf,
    promised: s.promisedDelivery,
    status: s.status,
    path: s.path
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
    const here = [s.longitude, s.latitude];
    const there = [dest.longitude, dest.latitude];
    let speed = speedFor(s.mode);
    if (s.status === 'Delayed') {
      speed /= 4;
    }
    const travelKm = speed * hours;
    let next;
    let arrived;
    if (s.path.length >= 2) {
      const total = remainingKm(s.path, [s.path[0][0], s.path[0][1]]);
      const left = Math.max(0, remainingKm(s.path, here) - travelKm);
      next = pointAt(s.path, total === 0 ? 1 : 1 - left / total);
      arrived = left < 0.5;
    } else {
      const remaining = distanceKm(here, there);
      const fraction = remaining === 0 ? 1 : Math.min(1, travelKm / remaining);
      next = [here[0] + (there[0] - here[0]) * fraction, here[1] + (there[1] - here[1]) * fraction];
      arrived = fraction >= 1;
    }
    s.longitude = next[0];
    s.latitude = next[1];
    s.lastPingAt = now;
    if (arrived) {
      s.status = 'Delivered';
    }
    score(s, network.siteById, now);
    moved += 1;
  }
  return moved;
}
