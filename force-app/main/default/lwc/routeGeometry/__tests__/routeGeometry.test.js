import {
  decodePolyline,
  distanceKm,
  encodePolyline,
  greatCircle,
  lengthKm,
  nearestIndex,
  pointAt,
  remainingKm,
  splitAt
} from 'c/routeGeometry';

const DENVER = [-104.9903, 39.7392];
const CHICAGO = [-87.6298, 41.8781];

describe('c-route-geometry', () => {
  it('decodes the reference polyline from the Google spec', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252]
    ]);
  });

  it('round-trips encode and decode', () => {
    const coords = [DENVER, [-95.9345, 41.2565], CHICAGO].map(([x, y]) => [
      Math.round(x * 1e5) / 1e5,
      Math.round(y * 1e5) / 1e5
    ]);
    expect(decodePolyline(encodePolyline(coords))).toEqual(coords);
    expect(decodePolyline('')).toEqual([]);
  });

  it('measures Denver to Chicago at about 1,475 km', () => {
    expect(distanceKm(DENVER, CHICAGO)).toBeGreaterThan(1450);
    expect(distanceKm(DENVER, CHICAGO)).toBeLessThan(1500);
  });

  it('adds up route length and remaining distance', () => {
    const route = [DENVER, [-95.9345, 41.2565], CHICAGO];
    const total = lengthKm(route);
    expect(total).toBeGreaterThan(distanceKm(DENVER, CHICAGO));
    expect(remainingKm(route, DENVER)).toBeCloseTo(total, 5);
    expect(remainingKm(route, CHICAGO)).toBeCloseTo(0, 5);
    expect(remainingKm([DENVER], DENVER)).toBeNull();
  });

  it('finds points along the route', () => {
    const route = [
      [0, 0],
      [0, 10]
    ];
    expect(pointAt(route, 0)).toEqual([0, 0]);
    expect(pointAt(route, 1)).toEqual([0, 10]);
    expect(pointAt(route, 0.5)[1]).toBeCloseTo(5, 5);
    expect(pointAt(route, 2)).toEqual([0, 10]);
    expect(pointAt([], 0.5)).toBeNull();
  });

  it('splits a route at the nearest vertex', () => {
    const route = [
      [0, 0],
      [0, 5],
      [0, 10]
    ];
    expect(nearestIndex(route, [0.1, 4.8])).toBe(1);
    const { travelled, remaining } = splitAt(route, [0.1, 4.8]);
    expect(travelled).toEqual([
      [0, 0],
      [0, 5],
      [0.1, 4.8]
    ]);
    expect(remaining).toEqual([
      [0.1, 4.8],
      [0, 10]
    ]);
    expect(splitAt([[0, 0]], [0, 0])).toEqual({ travelled: [], remaining: [] });
  });

  it('draws great-circle arcs that bow north across the US', () => {
    const arc = greatCircle(DENVER, CHICAGO, 10);
    expect(arc).toHaveLength(11);
    expect(arc[0][0]).toBeCloseTo(DENVER[0], 5);
    expect(arc[10][1]).toBeCloseTo(CHICAGO[1], 5);
    const midLat = arc[5][1];
    expect(midLat).toBeGreaterThan((DENVER[1] + CHICAGO[1]) / 2);
    expect(greatCircle(DENVER, DENVER)).toEqual([DENVER, DENVER]);
  });
});
