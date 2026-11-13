/**
 * Route math for shipments that carry a planned path in Route__c.
 * Mirrors the routeGeometry Lightning module so Apex and the map agree.
 *
 * Routes are Google encoded polylines at precision 5 (the format OSRM and most
 * routing APIs return). Distances use Location.getDistance (haversine, km).
 */
public with sharing class RouteGeometry {
  public static List<Location> decode(String encoded) {
    List<Location> points = new List<Location>();
    if (String.isBlank(encoded)) {
      return points;
    }
    List<Integer> chars = encoded.getChars();
    Integer index = 0;
    Integer lat = 0;
    Integer lng = 0;
    while (index < chars.size()) {
      Integer[] deltas = new List<Integer>{ 0, 0 };
      for (Integer axis = 0; axis < 2; axis++) {
        Integer result = 0;
        Integer shift = 0;
        Integer b;
        do {
          b = chars[index++] - 63;
          result |= (b & 31) << shift;
          shift += 5;
        } while (b >= 32);
        deltas[axis] = (result & 1) == 1 ? ~(result >> 1) : (result >> 1);
      }
      lat += deltas[0];
      lng += deltas[1];
      points.add(Location.newInstance(lat / 100000.0, lng / 100000.0));
    }
    return points;
  }

  public static Decimal distanceKm(Location a, Location b) {
    return Decimal.valueOf(Location.getDistance(a, b, 'km'));
  }

  public static Decimal lengthKm(List<Location> route) {
    return lengthFrom(route, 0);
  }

  private static Decimal lengthFrom(List<Location> route, Integer start) {
    Decimal total = 0;
    for (Integer i = start + 1; i < route.size(); i++) {
      total += distanceKm(route[i - 1], route[i]);
    }
    return total;
  }

  public static Integer nearestIndex(List<Location> route, Location point) {
    Integer best = 0;
    Double bestKm = null;
    for (Integer i = 0; i < route.size(); i++) {
      Double km = Location.getDistance(route[i], point, 'km');
      if (bestKm == null || km < bestKm) {
        bestKm = km;
        best = i;
      }
    }
    return best;
  }

  /** Distance left along the route from the given position, or null without a usable route. */
  public static Decimal remainingKm(List<Location> route, Location position) {
    if (route == null || route.size() < 2 || position == null) {
      return null;
    }
    Integer i = nearestIndex(route, position);
    return distanceKm(position, route[i]) + lengthFrom(route, i);
  }

  /** The point a fraction (0 to 1) of the way along the route. */
  public static Location pointAt(List<Location> route, Decimal fraction) {
    if (route == null || route.isEmpty()) {
      return null;
    }
    Decimal f = fraction;
    if (f < 0) {
      f = 0;
    } else if (f > 1) {
      f = 1;
    }
    Decimal target = f * lengthKm(route);
    Decimal walked = 0;
    for (Integer i = 1; i < route.size(); i++) {
      Decimal leg = distanceKm(route[i - 1], route[i]);
      if (walked + leg >= target) {
        Double t = 0;
        if (leg != 0) {
          t = ((target - walked) / leg).doubleValue();
        }
        Location a = route[i - 1];
        Location b = route[i];
        return Location.newInstance(
          a.getLatitude() + (b.getLatitude() - a.getLatitude()) * t,
          a.getLongitude() + (b.getLongitude() - a.getLongitude()) * t
        );
      }
      walked += leg;
    }
    return route[route.size() - 1];
  }

  /** Moves a position the given distance further along the route. */
  public static Location advance(List<Location> route, Location position, Decimal km) {
    Decimal total = lengthKm(route);
    if (total == 0) {
      return route[route.size() - 1];
    }
    Decimal left = remainingKm(route, position) - km;
    if (left < 0) {
      left = 0;
    }
    return pointAt(route, 1 - left / total);
  }
}
