import { LightningElement, api, wire } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { subscribe, unsubscribe, onError, isEmpEnabled } from 'lightning/empApi';
import MAPLIBRE from '@salesforce/resourceUrl/maplibregl';
import getMapData from '@salesforce/apex/ShipmentMapController.getMapData';
import {
  RISK,
  RISK_COLORS,
  boundsOf,
  fallbackMarkers,
  filterByRisk,
  riskOf,
  routeFeatures,
  shipmentFeatures,
  siteFeatures,
  slackHours,
  sortForTriage,
  summarize
} from 'c/shipmentGeo';

// Free vector tiles, no API key. The host must be a CSP Trusted Site (see cspTrustedSites/).
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
export const CHANGE_CHANNEL = '/data/Shipment__ChangeEvent';
const REFRESH_DEBOUNCE_MS = 750;

const SOURCES = { sites: 'sites', shipments: 'shipments', routes: 'routes' };

export default class ShipmentMap extends NavigationMixin(LightningElement) {
  /** Set automatically on an Account record page; limits the map to that Account. */
  @api recordId;
  @api cardTitle = 'Shipment Tracker';
  @api mapHeight = 560;

  data = { sites: [], shipments: [] };
  error;
  isLoading = true;
  useFallback = false;
  fallbackReason;
  riskFilter = null;
  selectedId = null;
  liveUpdates = false;

  map;
  maplibregl;
  wiredResult;
  subscription;
  refreshTimer;
  libraryRequested = false;
  hasFitBounds = false;

  @wire(getMapData, { accountId: '$recordId' })
  wiredMapData(result) {
    this.wiredResult = result;
    const { data, error } = result;
    if (data) {
      this.data = data;
      this.error = undefined;
      this.isLoading = false;
      this.syncMap();
    } else if (error) {
      this.error = error?.body?.message || 'Shipments could not be loaded.';
      this.isLoading = false;
    }
  }

  connectedCallback() {
    this.subscribeToChanges();
  }

  renderedCallback() {
    if (this.libraryRequested || this.useFallback) {
      return;
    }
    this.libraryRequested = true;
    this.startMapLibre();
  }

  disconnectedCallback() {
    clearTimeout(this.refreshTimer);
    if (this.subscription) {
      unsubscribe(this.subscription, () => {});
      this.subscription = undefined;
    }
    if (this.map) {
      this.map.remove();
      this.map = undefined;
    }
  }

  // ---------- MapLibre lifecycle ----------

  async startMapLibre() {
    try {
      await Promise.all([
        loadScript(this, `${MAPLIBRE}/maplibre-gl-csp.js`),
        loadStyle(this, `${MAPLIBRE}/maplibre-gl.css`)
      ]);
      // Under Lightning Web Security the UMD bundle attaches to the sandboxed window.
      const maplibregl = window.maplibregl;
      if (!maplibregl) {
        throw new Error('MapLibre did not load.');
      }
      // The CSP build fetches its worker from a URL instead of a Blob.
      maplibregl.setWorkerUrl(`${MAPLIBRE}/maplibre-gl-csp-worker.js`);
      this.maplibregl = maplibregl;
      this.createMap();
    } catch (e) {
      this.switchToFallback(e);
    }
  }

  createMap() {
    const container = this.template.querySelector('.map-canvas');
    if (!container) {
      return;
    }
    const maplibregl = this.maplibregl;
    this.map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE,
      center: [-98.5, 39.8],
      zoom: 3,
      attributionControl: { compact: true },
      cooperativeGestures: true
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    this.map.on('load', () => {
      this.addLayers();
      this.syncMap();
    });
    this.map.on('error', (event) => {
      // Tile or style failures (often a missing CSP Trusted Site) land here.
      console.error('shipmentMap: MapLibre error', event?.error);
      if (!this.map?.isStyleLoaded()) {
        this.switchToFallback(event?.error);
      }
    });
  }

  addLayers() {
    const map = this.map;
    const empty = { type: 'FeatureCollection', features: [] };
    Object.values(SOURCES).forEach((id) => map.addSource(id, { type: 'geojson', data: empty }));

    map.addLayer({
      id: 'route-travelled',
      type: 'line',
      source: SOURCES.routes,
      filter: ['==', ['get', 'leg'], 'travelled'],
      paint: { 'line-color': '#9e9e9e', 'line-width': 2, 'line-opacity': 0.7 }
    });
    map.addLayer({
      id: 'route-remaining',
      type: 'line',
      source: SOURCES.routes,
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
      source: SOURCES.sites,
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
      source: SOURCES.shipments,
      paint: {
        'circle-radius': ['case', ['get', 'selected'], 10, ['get', 'delivered'], 4, 7],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': ['case', ['get', 'selected'], '#032d60', '#ffffff'],
        'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5]
      }
    });

    map.on('click', 'shipments', (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) {
        this.selectShipment(id, { fly: false });
      }
    });
    map.on('click', 'sites', (event) => {
      const feature = event.features?.[0];
      if (feature) {
        this.showPopup(
          feature.geometry.coordinates,
          feature.properties.name,
          feature.properties.place
        );
      }
    });
    ['shipments', 'sites'].forEach((layer) => {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
      });
    });
  }

  /** Pushes the current data and filter into the map sources. Safe to call at any time. */
  syncMap() {
    const map = this.map;
    if (!map || !map.getSource(SOURCES.shipments)) {
      return;
    }
    const shipments = filterByRisk(this.data.shipments, this.riskFilter);
    map.getSource(SOURCES.sites).setData(siteFeatures(this.data.sites));
    map.getSource(SOURCES.shipments).setData(shipmentFeatures(shipments, this.selectedId));
    map.getSource(SOURCES.routes).setData(routeFeatures(shipments, this.data.sites));

    if (!this.hasFitBounds) {
      const bounds = boundsOf(this.data.sites, this.data.shipments);
      if (bounds) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 9, duration: 0 });
        this.hasFitBounds = true;
      }
    }
  }

  showPopup(coordinates, heading, detail) {
    if (!this.map || !this.maplibregl) {
      return;
    }
    // Built with DOM nodes, not HTML strings, so record data is never parsed as markup.
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = heading;
    body.appendChild(title);
    if (detail) {
      const line = document.createElement('div');
      line.textContent = detail;
      body.appendChild(line);
    }
    this.popup?.remove();
    this.popup = new this.maplibregl.Popup({ offset: 12, closeButton: false })
      .setLngLat(coordinates)
      .setDOMContent(body)
      .addTo(this.map);
  }

  switchToFallback(error) {
    console.warn('shipmentMap: falling back to lightning-map', error);
    this.fallbackReason = error?.message || 'MapLibre could not start in this browser.';
    this.useFallback = true;
    if (this.map) {
      this.map.remove();
      this.map = undefined;
    }
  }

  // ---------- Live updates via Change Data Capture ----------

  async subscribeToChanges() {
    try {
      if (!(await isEmpEnabled())) {
        return;
      }
      onError((error) => {
        console.warn('shipmentMap: streaming error', error);
        this.liveUpdates = false;
      });
      this.subscription = await subscribe(CHANGE_CHANNEL, -1, () => this.scheduleRefresh());
      this.liveUpdates = Boolean(this.subscription);
    } catch {
      this.liveUpdates = false;
    }
  }

  /** Coalesces a burst of change events (a bulk update) into one Apex call. */
  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  refresh() {
    return this.wiredResult ? refreshApex(this.wiredResult) : Promise.resolve();
  }

  // ---------- Panel interactions ----------

  handleRefresh() {
    this.isLoading = true;
    this.refresh().finally(() => {
      this.isLoading = false;
    });
  }

  handleRiskFilter(event) {
    const risk = event.currentTarget.dataset.risk;
    this.riskFilter = this.riskFilter === risk ? null : risk;
    this.syncMap();
  }

  handleRowClick(event) {
    this.selectShipment(event.currentTarget.dataset.id, { fly: true });
  }

  handleRowKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.handleRowClick(event);
    }
  }

  handleOpenRecord(event) {
    event.stopPropagation();
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: event.currentTarget.dataset.id, actionName: 'view' }
    });
  }

  handleFallbackSelect(event) {
    const id = event.detail?.selectedMarkerValue;
    if (this.data.shipments.some((s) => s.id === id)) {
      this.selectedId = id;
    }
  }

  selectShipment(id, { fly }) {
    this.selectedId = id;
    const shipment = this.data.shipments.find((s) => s.id === id);
    this.syncMap();
    if (!shipment || !this.map) {
      return;
    }
    const coords = [shipment.longitude, shipment.latitude];
    if (fly) {
      this.map.flyTo({ center: coords, zoom: Math.max(this.map.getZoom(), 5) });
    }
    this.showPopup(
      coords,
      `${shipment.name} · ${riskOf(shipment)}`,
      `${shipment.originName || '?'} → ${shipment.destinationName || '?'}`
    );
  }

  // ---------- Template getters ----------

  get mapStyle() {
    return `height: ${Number(this.mapHeight) || 560}px;`;
  }

  get hasShipments() {
    return this.data.shipments.length > 0;
  }

  get showEmptyState() {
    return !this.isLoading && !this.error && !this.hasShipments;
  }

  get liveLabel() {
    return this.liveUpdates ? 'Live' : 'Manual refresh';
  }

  get liveBadgeClass() {
    return this.liveUpdates ? 'slds-badge slds-theme_success' : 'slds-badge';
  }

  get fallbackMapMarkers() {
    return fallbackMarkers(this.data.sites, this.data.shipments);
  }

  get riskChips() {
    const counts = summarize(this.data.shipments);
    return [RISK.LATE, RISK.AT_RISK, RISK.ON_TIME].map((risk) => ({
      risk,
      count: counts[risk],
      label: `${counts[risk]} ${risk}`,
      pressed: String(this.riskFilter === risk),
      className: `risk-chip${this.riskFilter === risk ? ' risk-chip_active' : ''}`,
      dotStyle: `background:${RISK_COLORS[risk]}`
    }));
  }

  get rows() {
    const dateFormat = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    return sortForTriage(filterByRisk(this.data.shipments, this.riskFilter)).map((s) => {
      const risk = riskOf(s);
      const slack = slackHours(s);
      let slackLabel = '';
      if (slack !== null && s.status !== 'Delivered') {
        slackLabel = slack >= 0 ? `${slack}h ahead of promise` : `${Math.abs(slack)}h past promise`;
      }
      return {
        ...s,
        risk,
        lane: `${s.originName || '?'} → ${s.destinationName || '?'}`,
        etaLabel: s.estimatedArrival
          ? `ETA ${dateFormat.format(new Date(s.estimatedArrival))}`
          : 'No ETA',
        slackLabel,
        meta: [s.mode, s.carrier, s.status].filter(Boolean).join(' · '),
        dotStyle: `background:${RISK_COLORS[risk]}`,
        className: `shipment-row${s.id === this.selectedId ? ' shipment-row_selected' : ''}`,
        ariaSelected: String(s.id === this.selectedId),
        openLabel: `Open ${s.name}`
      };
    });
  }
}
