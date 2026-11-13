/**
 * Fills in route geometry for every lane in the demo network:
 *
 *   Truck  road route from the public OSRM demo server (router.project-osrm.org)
 *   Air    great-circle arc, computed locally
 *   Rail, Ocean  left empty, drawn as straight lines (no free routing source)
 *
 * Run with `npm run routes`, then commit the updated
 * force-app/main/default/staticresources/shipmentDemoData.json.
 *
 * OSRM's demo server allows light use only, so requests go one at a time with a
 * pause between them. Lanes that already have a road route are skipped unless
 * you pass --force.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(
  __dirname,
  '..',
  'force-app/main/default/staticresources/shipmentDemoData.json'
);
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const PAUSE_MS = 1100;
const force = process.argv.includes('--force');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadGeometry() {
  // routeGeometry is an ES module shared with the Lightning component.
  return import(
    path.join(__dirname, '..', 'force-app/main/default/lwc/routeGeometry/routeGeometry.js')
  );
}

async function roadRoute(from, to) {
  const url = `${OSRM}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=polyline`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'sf-shipment-tracker demo route builder' }
  });
  if (!res.ok) {
    throw new Error(`OSRM answered ${res.status}`);
  }
  const body = await res.json();
  if (body.code !== 'Ok' || !body.routes?.length) {
    throw new Error(`OSRM could not route: ${body.code}`);
  }
  return body.routes[0];
}

async function main() {
  const geo = await loadGeometry();
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const name = (i) => data.sites[i].name;
  let changed = 0;
  let failed = 0;

  for (const lane of data.lanes) {
    const from = data.sites[lane.origin];
    const to = data.sites[lane.destination];
    const label = `${lane.mode.padEnd(5)} ${name(lane.origin)} -> ${name(lane.destination)}`;

    if (lane.mode === 'Air') {
      const arc = geo.greatCircle([from.lng, from.lat], [to.lng, to.lat], 48);
      lane.route = geo.encodePolyline(arc);
      lane.routeSource = 'great-circle';
      changed++;
      console.log(`arc    ${label}`);
      continue;
    }
    if (lane.mode !== 'Truck') {
      console.log(`skip   ${label} (no free routing source for ${lane.mode})`);
      continue;
    }
    if (lane.routeSource === 'osrm' && !force) {
      console.log(`keep   ${label}`);
      continue;
    }
    try {
      const route = await roadRoute(from, to);
      lane.route = route.geometry;
      lane.routeSource = 'osrm';
      changed++;
      const straight = geo.distanceKm([from.lng, from.lat], [to.lng, to.lat]);
      console.log(
        `road   ${label} ${Math.round(route.distance / 1000)} km by road, ${Math.round(straight)} km straight`
      );
    } catch (e) {
      failed++;
      console.warn(`FAILED ${label}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nUpdated ${changed} lanes in ${path.relative(process.cwd(), FILE)}.`);
  if (failed) {
    console.warn(`${failed} truck lanes failed; they stay straight lines. Re-run to retry them.`);
    process.exitCode = 1;
  }
}

main();
