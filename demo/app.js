/**
 * Static demo of the shipmentMap Lightning Web Component.
 *
 * The GeoJSON, sorting, and risk helpers are the component's own shipmentGeo
 * module, copied in at build time, so the demo and the org draw the same map.
 * Data comes from data.js instead of Apex, and "Play pings" stands in for
 * carrier updates arriving through Change Data Capture.
 */
import {
  RISK,
  RISK_COLORS,
  boundsOf,
  filterByRisk,
  riskOf,
  routeFeatures,
  shipmentFeatures,
  siteFeatures,
  slackLabel,
  sortForTriage,
  summarize
} from './shipmentGeo.js';
import { buildNetwork, advance } from './data.js';

const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe6ec' } }]
};
const HOUR = 3600000;
const PLAY_INTERVAL_MS = 1000;

const state = {
  clock: Date.now(),
  network: null,
  riskFilter: null,
  selectedId: null,
  timer: null
};

const els = {
  chips: document.getElementById('chips'),
  list: document.getElementById('list'),
  clock: document.getElementById('clock'),
  play: document.getElementById('play'),
  step: document.getElementById('step'),
  reset: document.getElementById('reset'),
  note: document.getElementById('map-note')
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

/** Shape internal records like ShipmentMapController's DTOs (ISO date strings). */
function toDto(s) {
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  return {
    ...s,
    estimatedArrival: iso(s.estimatedArrival),
    promisedDelivery: iso(s.promisedDelivery),
    lastPingAt: iso(s.lastPingAt)
  };
}

const shipments = () => state.network.shipments.map(toDto);
const sites = () => state.network.sites;

// ---------- Map ----------

const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAP_STYLE,
  center: [-98.5, 39.8],
  zoom: 3,
  attributionControl: { compact: true },
  cooperativeGestures: matchMedia('(pointer: coarse)').matches
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

let popup = null;
let layersReady = false;
let usedFallback = false;

map.on('error', (event) => {
  console.error('MapLibre error', event?.error);
  if (!usedFallback && !map.isStyleLoaded()) {
    usedFallback = true;
    els.note.hidden = false;
    els.note.textContent = 'Basemap tiles could not load, so only the freight network is shown.';
    map.setStyle(FALLBACK_STYLE);
  }
});

map.on('style.load', () => {
  addLayers();
  syncMap();
});

function addLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  ['sites', 'shipments', 'routes'].forEach((id) => {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data: empty });
    }
  });
  map.addLayer({
    id: 'route-travelled',
    type: 'line',
    source: 'routes',
    filter: ['==', ['get', 'leg'], 'travelled'],
    paint: { 'line-color': '#9e9e9e', 'line-width': 2, 'line-opacity': 0.7 }
  });
  map.addLayer({
    id: 'route-remaining',
    type: 'line',
    source: 'routes',
    filter: ['==', ['get', 'leg'], 'remaining'],
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 2.5,
      'line-dasharray': [2, 2],
      'line-opacity': 0.85
    }
  });
  map.addLayer({
    id: 'sites',
    type: 'circle',
    source: 'sites',
    paint: {
      'circle-radius': 6,
      'circle-color': '#ffffff',
      'circle-stroke-color': '#032d60',
      'circle-stroke-width': 2.5
    }
  });
  map.addLayer({
    id: 'shipments',
    type: 'circle',
    source: 'shipments',
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 10, ['get', 'delivered'], 4, 7],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': ['case', ['get', 'selected'], '#032d60', '#ffffff'],
      'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5]
    }
  });
  layersReady = true;
}

let fitted = false;
function syncMap() {
  if (!layersReady || !map.getSource('shipments')) {
    return;
  }
  const visible = filterByRisk(shipments(), state.riskFilter);
  map.getSource('sites').setData(siteFeatures(sites()));
  map.getSource('shipments').setData(shipmentFeatures(visible, state.selectedId));
  map.getSource('routes').setData(routeFeatures(visible, sites()));
  if (!fitted) {
    const bounds = boundsOf(sites(), shipments());
    if (bounds) {
      map.fitBounds(bounds, { padding: 40, duration: 0 });
      fitted = true;
    }
  }
}

function showPopup(coords, heading, detail) {
  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = heading;
  body.appendChild(title);
  for (const line of [].concat(detail || [])) {
    const div = document.createElement('div');
    div.textContent = line;
    body.appendChild(div);
  }
  popup?.remove();
  popup = new maplibregl.Popup({ offset: 12, closeButton: false })
    .setLngLat(coords)
    .setDOMContent(body)
    .addTo(map);
}

map.on('click', 'shipments', (e) => {
  const id = e.features?.[0]?.properties?.id;
  if (id) {
    select(id, false);
  }
});
map.on('click', 'sites', (e) => {
  const f = e.features?.[0];
  if (f) {
    showPopup(f.geometry.coordinates, f.properties.name, f.properties.place);
  }
});
['shipments', 'sites'].forEach((layer) => {
  map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
});

// ---------- Panel ----------

function select(id, fly) {
  state.selectedId = id;
  const s = shipments().find((x) => x.id === id);
  render();
  if (!s) {
    return;
  }
  const coords = [s.longitude, s.latitude];
  if (fly) {
    map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 5) });
  }
  const eta = s.estimatedArrival
    ? `ETA ${dateFormat.format(new Date(s.estimatedArrival))}`
    : s.status;
  showPopup(coords, `${s.name} · ${riskOf(s)}`, [`${s.originName} → ${s.destinationName}`, eta]);
  els.list.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function renderChips() {
  const counts = summarize(shipments());
  els.chips.replaceChildren(
    ...[RISK.LATE, RISK.AT_RISK, RISK.ON_TIME].map((risk) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'risk-chip';
      b.setAttribute('aria-pressed', String(state.riskFilter === risk));
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = RISK_COLORS[risk];
      b.append(dot, `${counts[risk]} ${risk}`);
      b.addEventListener('click', () => {
        state.riskFilter = state.riskFilter === risk ? null : risk;
        render();
      });
      return b;
    })
  );
}

function renderList() {
  const rows = sortForTriage(filterByRisk(shipments(), state.riskFilter)).map((s) => {
    const risk = riskOf(s);
    const li = document.createElement('li');
    li.className = 'shipment-row';
    li.dataset.id = s.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(s.id === state.selectedId));

    const top = document.createElement('div');
    top.className = 'row-top';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = RISK_COLORS[risk];
    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = s.name;
    const riskEl = document.createElement('span');
    riskEl.className = 'row-risk';
    riskEl.textContent = risk;
    top.append(dot, name, riskEl);

    const lane = document.createElement('div');
    lane.className = 'row-lane';
    lane.textContent = `${s.originName} → ${s.destinationName}`;

    const eta = document.createElement('div');
    eta.className = 'row-meta';
    let etaText = s.estimatedArrival
      ? `ETA ${dateFormat.format(new Date(s.estimatedArrival))}`
      : 'No ETA';
    const slack = slackLabel(s);
    if (slack) {
      etaText += ` · ${slack}`;
    }
    eta.textContent = etaText;

    const meta = document.createElement('div');
    meta.className = 'row-meta';
    meta.textContent = [s.mode, s.carrier, s.status].join(' · ');

    li.append(top, lane, eta, meta);
    li.addEventListener('click', () => select(s.id, true));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(s.id, true);
      }
    });
    return li;
  });
  els.list.replaceChildren(...rows);
}

function render() {
  els.clock.textContent = `Demo time ${dateFormat.format(new Date(state.clock))}`;
  renderChips();
  renderList();
  syncMap();
}

// ---------- Simulated carrier pings ----------

function tick(hours) {
  state.clock += hours * HOUR;
  advance(state.network, hours, state.clock);
  render();
}

function setPlaying(on) {
  clearInterval(state.timer);
  state.timer = on ? setInterval(() => tick(1), PLAY_INTERVAL_MS) : null;
  els.play.textContent = on ? 'Pause' : 'Play pings';
  els.play.setAttribute('aria-pressed', String(on));
}

els.play.addEventListener('click', () => setPlaying(!state.timer));
els.step.addEventListener('click', () => tick(3));
els.reset.addEventListener('click', () => {
  setPlaying(false);
  state.clock = Date.now();
  state.network = buildNetwork(state.clock);
  state.selectedId = null;
  popup?.remove();
  render();
});

state.network = buildNetwork(state.clock);
render();
