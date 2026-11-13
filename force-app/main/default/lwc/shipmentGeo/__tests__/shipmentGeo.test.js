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
  slackLabel,
  sortForTriage,
  summarize
} from 'c/shipmentGeo';

const { sites, shipments } = require('../../shipmentMap/__tests__/data/mapData.json');

describe('c-shipment-geo', () => {
  it('treats delivered and unscored shipments as Unscored', () => {
    expect(riskOf({ status: 'Delivered', lateRisk: 'Late' })).toBe(RISK.NONE);
    expect(riskOf({ status: 'Booked', lateRisk: null })).toBe(RISK.NONE);
    expect(riskOf({ status: 'In Transit', lateRisk: 'At Risk' })).toBe(RISK.AT_RISK);
  });

  it('builds site points in lng/lat order and skips sites without coordinates', () => {
    const fc = siteFeatures([...sites, { id: 'x', name: 'No geocode' }]);
    expect(fc.features).toHaveLength(3);
    expect(fc.features[0].geometry.coordinates).toEqual([-104.9903, 39.7392]);
    expect(fc.features[0].properties.place).toBe('Denver, CO');
  });

  it('colors shipments by risk and marks the selected one', () => {
    const fc = shipmentFeatures(shipments, 'a00000000000002AAA');
    const late = fc.features.find((f) => f.properties.id === 'a00000000000002AAA');
    expect(late.properties.color).toBe(RISK_COLORS[RISK.LATE]);
    expect(late.properties.selected).toBe(true);
    const delivered = fc.features.find((f) => f.properties.id === 'a00000000000004AAA');
    expect(delivered.properties.delivered).toBe(true);
  });

  it('draws travelled and remaining legs, and none for delivered freight', () => {
    const fc = routeFeatures(shipments, sites);
    const forFirst = fc.features.filter((f) => f.properties.id === 'a00000000000001AAA');
    expect(forFirst.map((f) => f.properties.leg)).toEqual(['travelled', 'remaining']);
    expect(forFirst[1].geometry.coordinates).toEqual([
      [-95.9345, 41.2565],
      [-87.6298, 41.8781]
    ]);
    expect(fc.features.some((f) => f.properties.id === 'a00000000000004AAA')).toBe(false);
  });

  it('skips routes to unmapped destinations and travelled legs from unmapped origins', () => {
    const chicagoOnly = sites.filter((s) => s.name === 'Chicago Hub');
    const fc = routeFeatures(shipments, chicagoOnly);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ id: 'a00000000000001AAA', leg: 'remaining' });
  });

  it('computes bounds around every point', () => {
    expect(boundsOf(sites, shipments)).toEqual([
      [-104.9903, 32.7767],
      [-87.6298, 41.8781]
    ]);
    expect(boundsOf([], [])).toBeNull();
  });

  it('summarizes and filters by risk', () => {
    expect(summarize(shipments)).toEqual({
      [RISK.ON_TIME]: 1,
      [RISK.AT_RISK]: 1,
      [RISK.LATE]: 1,
      [RISK.NONE]: 1
    });
    expect(filterByRisk(shipments, RISK.LATE).map((s) => s.name)).toEqual(['SHP-00002']);
    expect(filterByRisk(shipments, null)).toHaveLength(4);
  });

  it('sorts late first, then at risk, then on time', () => {
    expect(sortForTriage(shipments).map((s) => s.name)).toEqual([
      'SHP-00002',
      'SHP-00003',
      'SHP-00001',
      'SHP-00004'
    ]);
  });

  it('breaks risk ties by earliest promise, with no promise last', () => {
    const a = { name: 'a', lateRisk: 'On Time', promisedDelivery: '2026-03-05T00:00:00Z' };
    const b = { name: 'b', lateRisk: 'On Time', promisedDelivery: '2026-03-02T00:00:00Z' };
    const c = { name: 'c', lateRisk: 'On Time' };
    expect(sortForTriage([c, a, b]).map((s) => s.name)).toEqual(['b', 'a', 'c']);
  });

  it('reports slack in hours', () => {
    expect(slackHours(shipments[0])).toBe(28);
    expect(slackHours(shipments[1])).toBe(-8);
    expect(slackHours(shipments[3])).toBeNull();
  });

  it('labels slack in plain language', () => {
    expect(slackLabel(shipments[0])).toBe('28h ahead of promise');
    expect(slackLabel(shipments[1])).toBe('8h past promise');
    expect(slackLabel(shipments[3])).toBe('');
    expect(
      slackLabel({
        estimatedArrival: '2026-03-02T12:20:00Z',
        promisedDelivery: '2026-03-02T12:00:00Z'
      })
    ).toBe('Under 1h past promise');
  });

  it('builds lightning-map markers for the fallback view', () => {
    const markers = fallbackMarkers(sites, shipments);
    expect(markers).toHaveLength(7);
    expect(markers[3]).toMatchObject({
      location: { Latitude: 41.2565, Longitude: -95.9345 },
      title: 'SHP-00001 · On Time',
      value: 'a00000000000001AAA'
    });
  });
});
