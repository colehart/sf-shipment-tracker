import { createElement } from '@lwc/engine-dom';
import ShipmentMap, { BASEMAP_STYLE, CHANGE_CHANNEL } from 'c/shipmentMap';
import getMapData from '@salesforce/apex/ShipmentMapController.getMapData';
import { refreshApex } from '@salesforce/apex';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import { subscribe, isEmpEnabled } from 'lightning/empApi';
import { getNavigateCalledWith } from 'lightning/navigation';

const mockMapData = require('./data/mapData.json');

jest.mock(
  '@salesforce/apex/ShipmentMapController.getMapData',
  () => {
    const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);
jest.mock('@salesforce/apex', () => ({ refreshApex: jest.fn(() => Promise.resolve()) }), {
  virtual: true
});

/** Minimal stand-in for the MapLibre global the static resource installs. */
function installFakeMapLibre() {
  const sources = {};
  const handlers = {};
  const map = {
    addControl: jest.fn(),
    addSource: jest.fn((id) => {
      sources[id] = { setData: jest.fn() };
    }),
    addLayer: jest.fn(),
    getSource: jest.fn((id) => sources[id]),
    getCanvas: jest.fn(() => ({ style: {} })),
    on: jest.fn((event, layerOrFn, maybeFn) => {
      const key = typeof layerOrFn === 'string' ? `${event}:${layerOrFn}` : event;
      handlers[key] = maybeFn || layerOrFn;
    }),
    fitBounds: jest.fn(),
    flyTo: jest.fn(),
    getZoom: jest.fn(() => 3),
    isStyleLoaded: jest.fn(() => true),
    remove: jest.fn()
  };
  const popup = {
    setLngLat: jest.fn().mockReturnThis(),
    setDOMContent: jest.fn().mockReturnThis(),
    addTo: jest.fn().mockReturnThis(),
    remove: jest.fn()
  };
  const lib = {
    Map: jest.fn(() => map),
    NavigationControl: jest.fn(),
    ScaleControl: jest.fn(),
    Popup: jest.fn(() => popup),
    setWorkerUrl: jest.fn()
  };
  window.maplibregl = lib;
  return { lib, map, popup, sources, fire: (key, arg) => handlers[key](arg) };
}

// Lets pending promise callbacks (resource loading, wire updates) run.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(props = {}) {
  const element = createElement('c-shipment-map', { is: ShipmentMap });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

describe('c-shipment-map', () => {
  let fake;

  beforeEach(() => {
    fake = installFakeMapLibre();
    isEmpEnabled.mockResolvedValue(true);
    subscribe.mockResolvedValue({ channel: CHANGE_CHANNEL });
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    delete window.maplibregl;
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('loads the CSP build of MapLibre from the static resource and points it at the worker', async () => {
    mount();
    await flushPromises();

    expect(loadScript).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/maplibre-gl-csp\.js$/)
    );
    expect(loadStyle).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/maplibre-gl\.css$/)
    );
    expect(fake.lib.setWorkerUrl).toHaveBeenCalledWith(
      expect.stringMatching(/maplibre-gl-csp-worker\.js$/)
    );
    expect(fake.lib.Map).toHaveBeenCalledWith(expect.objectContaining({ style: BASEMAP_STYLE }));
  });

  it('pushes shipments, sites, and routes into the map once the style loads', async () => {
    mount();
    await flushPromises();
    getMapData.emit(mockMapData);
    fake.fire('load');
    await flushPromises();

    expect(fake.map.addLayer).toHaveBeenCalledTimes(4);
    const shipmentData = fake.sources.shipments.setData.mock.calls.at(-1)[0];
    expect(shipmentData.features).toHaveLength(4);
    expect(fake.sources.sites.setData.mock.calls.at(-1)[0].features).toHaveLength(3);
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('passes the record id to Apex on an Account page', async () => {
    mount({ recordId: '001000000000003AAA' });
    await flushPromises();
    expect(getMapData.getLastConfig()).toEqual({ accountId: '001000000000003AAA' });
  });

  it('lists shipments most urgent first with risk chip counts', async () => {
    const element = mount();
    getMapData.emit(mockMapData);
    await flushPromises();

    const names = [...element.shadowRoot.querySelectorAll('.row-name')].map((n) => n.textContent);
    expect(names).toEqual(['SHP-00002', 'SHP-00003', 'SHP-00001', 'SHP-00004']);
    const chips = [...element.shadowRoot.querySelectorAll('.risk-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['1 Late', '1 At Risk', '1 On Time']);
  });

  it('filters the list and the map when a risk chip is pressed, and clears on a second press', async () => {
    const element = mount();
    await flushPromises();
    getMapData.emit(mockMapData);
    fake.fire('load');
    await flushPromises();

    const lateChip = element.shadowRoot.querySelector('[data-risk="Late"]');
    lateChip.click();
    await flushPromises();
    expect(element.shadowRoot.querySelectorAll('.shipment-row')).toHaveLength(1);
    expect(lateChip.getAttribute('aria-pressed')).toBe('true');
    expect(fake.sources.shipments.setData.mock.calls.at(-1)[0].features).toHaveLength(1);

    lateChip.click();
    await flushPromises();
    expect(element.shadowRoot.querySelectorAll('.shipment-row')).toHaveLength(4);
  });

  it('flies to a shipment and opens a popup when its row is clicked', async () => {
    const element = mount();
    await flushPromises();
    getMapData.emit(mockMapData);
    fake.fire('load');
    await flushPromises();

    element.shadowRoot.querySelector('[data-id="a00000000000001AAA"]').click();
    await flushPromises();

    expect(fake.map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-95.9345, 41.2565] })
    );
    expect(fake.popup.setDOMContent).toHaveBeenCalled();
    const selectedRow = element.shadowRoot.querySelector('.shipment-row_selected');
    expect(selectedRow.dataset.id).toBe('a00000000000001AAA');
  });

  it('selects a shipment when its pin is clicked', async () => {
    const element = mount();
    await flushPromises();
    getMapData.emit(mockMapData);
    fake.fire('load');
    fake.fire('click:shipments', { features: [{ properties: { id: 'a00000000000003AAA' } }] });
    await flushPromises();

    expect(element.shadowRoot.querySelector('.shipment-row_selected').dataset.id).toBe(
      'a00000000000003AAA'
    );
    expect(fake.map.flyTo).not.toHaveBeenCalled();
  });

  it('navigates to the shipment record from the open button', async () => {
    const element = mount();
    getMapData.emit(mockMapData);
    await flushPromises();

    element.shadowRoot.querySelector('lightning-button-icon[data-id="a00000000000002AAA"]').click();
    const { pageReference } = getNavigateCalledWith();
    expect(pageReference.attributes.recordId).toBe('a00000000000002AAA');
  });

  it('subscribes to Shipment change events and debounces refreshes', async () => {
    const element = mount();
    await flushPromises();
    expect(subscribe).toHaveBeenCalledWith(CHANGE_CHANNEL, -1, expect.any(Function));
    expect(element.shadowRoot.querySelector('.slds-badge').textContent).toBe('Live');

    jest.useFakeTimers();
    const onEvent = subscribe.mock.calls[0][2];
    onEvent({});
    onEvent({});
    onEvent({});
    jest.runAllTimers();
    expect(refreshApex).toHaveBeenCalledTimes(1);
  });

  it('shows manual refresh when streaming is unavailable', async () => {
    isEmpEnabled.mockResolvedValue(false);
    const element = mount();
    await flushPromises();
    expect(subscribe).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('.slds-badge').textContent).toBe('Manual refresh');
  });

  it('falls back to lightning-map when MapLibre cannot start', async () => {
    fake.lib.Map.mockImplementation(() => {
      throw new Error('WebGL is not supported');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const element = mount();
    getMapData.emit(mockMapData);
    await flushPromises();

    const fallback = element.shadowRoot.querySelector('lightning-map');
    expect(fallback).not.toBeNull();
    expect(fallback.mapMarkers).toHaveLength(7);
    expect(element.shadowRoot.querySelector('.fallback-note').textContent).toContain(
      'WebGL is not supported'
    );
  });

  it('falls back when the basemap style fails to load', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fake.map.isStyleLoaded.mockReturnValue(false);
    const element = mount();
    await flushPromises();
    fake.fire('error', { error: new Error('Refused to connect: CSP') });
    await flushPromises();

    expect(element.shadowRoot.querySelector('lightning-map')).not.toBeNull();
    expect(fake.map.remove).toHaveBeenCalled();
  });

  it('shows the Apex error message', async () => {
    const element = mount();
    getMapData.error({ message: 'No access' });
    await flushPromises();
    expect(element.shadowRoot.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('shows an empty state when there are no shipments', async () => {
    const element = mount();
    getMapData.emit({ sites: [], shipments: [] });
    await flushPromises();
    expect(element.shadowRoot.textContent).toContain('No shipments yet');
  });

  it('selects a row from the keyboard', async () => {
    const element = mount();
    await flushPromises();
    getMapData.emit(mockMapData);
    fake.fire('load');
    await flushPromises();

    const row = element.shadowRoot.querySelector('li[data-id="a00000000000002AAA"]');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flushPromises();
    expect(row.getAttribute('aria-selected')).toBe('true');
  });

  it('refreshes from the header button', async () => {
    const element = mount();
    getMapData.emit(mockMapData);
    await flushPromises();
    element.shadowRoot.querySelector('.refresh-button').click();
    await flushPromises();
    expect(refreshApex).toHaveBeenCalledTimes(1);
  });

  it('shows a site popup when a site is clicked', async () => {
    mount();
    await flushPromises();
    getMapData.emit(mockMapData);
    fake.fire('load');
    fake.fire('click:sites', {
      features: [
        {
          geometry: { coordinates: [-104.99, 39.74] },
          properties: { name: 'Denver DC', place: 'Denver, CO' }
        }
      ]
    });
    expect(fake.popup.setLngLat).toHaveBeenCalledWith([-104.99, 39.74]);
  });

  it('removes the map when it leaves the page', async () => {
    const element = mount();
    await flushPromises();
    document.body.removeChild(element);
    expect(fake.map.remove).toHaveBeenCalled();
  });
});
