@IsTest
private class RouteGeometryTest {
  @IsTest
  static void decodesReferencePolyline() {
    List<Location> points = RouteGeometry.decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    Assert.areEqual(3, points.size());
    Assert.isTrue(Math.abs(points[0].getLatitude() - 38.5) < 0.000001);
    Assert.isTrue(Math.abs(points[0].getLongitude() + 120.2) < 0.000001);
    Assert.isTrue(Math.abs(points[2].getLatitude() - 43.252) < 0.000001);
    Assert.isTrue(Math.abs(points[2].getLongitude() + 126.453) < 0.000001);
    Assert.areEqual(0, RouteGeometry.decode('').size());
  }

  private static List<Location> northLine() {
    return new List<Location>{
      Location.newInstance(0, 0),
      Location.newInstance(5, 0),
      Location.newInstance(10, 0)
    };
  }

  @IsTest
  static void measuresRemainingDistance() {
    List<Location> route = northLine();
    Decimal total = RouteGeometry.lengthKm(route);
    Assert.isTrue(
      total > 1100 && total < 1120,
      'Ten degrees of latitude is about 1,112 km, got ' + total
    );
    Assert.areEqual(total, RouteGeometry.remainingKm(route, Location.newInstance(0, 0)));
    Decimal half = RouteGeometry.remainingKm(route, Location.newInstance(5, 0));
    Assert.isTrue(Math.abs(half - total / 2) < 1, 'Halfway should leave half the route');
    Assert.isNull(
      RouteGeometry.remainingKm(
        new List<Location>{ Location.newInstance(0, 0) },
        Location.newInstance(0, 0)
      )
    );
  }

  @IsTest
  static void findsPointsAlongRoute() {
    List<Location> route = northLine();
    Assert.isTrue(Math.abs(RouteGeometry.pointAt(route, 0.25).getLatitude() - 2.5) < 0.01);
    Assert.isTrue(RouteGeometry.pointAt(route, 5).getLatitude() == 10, 'clamps past the end');
    Assert.isTrue(RouteGeometry.pointAt(route, -1).getLatitude() == 0, 'clamps before the start');
    Assert.isNull(RouteGeometry.pointAt(new List<Location>(), 0.5));
  }

  @IsTest
  static void advancesAlongRouteAndStopsAtTheEnd() {
    List<Location> route = northLine();
    Location moved = RouteGeometry.advance(route, Location.newInstance(0, 0), 556);
    Assert.isTrue(
      Math.abs(moved.getLatitude() - 5) < 0.05,
      'Should be near the midpoint, got ' + moved.getLatitude()
    );
    Location end = RouteGeometry.advance(route, moved, 100000);
    Assert.isTrue(end.getLatitude() == 10, 'stops at the destination');
  }
}
