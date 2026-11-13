/**
 * Demo helper: moves every in-transit shipment toward its destination as if
 * the carriers had just reported new GPS pings. Each update fires the trigger,
 * which recalculates ETA and late risk, and publishes a change event the map
 * listens for, so open maps update without a page refresh.
 *
 * Run from Anonymous Apex:  ShipmentPingSimulator.advance(6);
 * Or schedule it:           System.schedule('Pings', '0 0 * * * ?', new ShipmentPingSimulator());
 */
public with sharing class ShipmentPingSimulator implements Schedulable {
  public void execute(SchedulableContext context) {
    advance(1);
  }

  /** Simulates the given number of hours of travel and returns how many shipments moved. */
  public static Integer advance(Decimal hours) {
    List<Shipment__c> moving = [
      SELECT
        Id,
        Mode__c,
        Status__c,
        Origin__c,
        Destination__c,
        Last_Ping_At__c,
        Current_Location__Latitude__s,
        Current_Location__Longitude__s,
        Route__c
      FROM Shipment__c
      WHERE Status__c IN ('In Transit', 'Delayed')
      WITH USER_MODE
      LIMIT 200
    ];
    Set<Id> accountIds = new Set<Id>();
    for (Shipment__c s : moving) {
      accountIds.add(s.Origin__c);
      accountIds.add(s.Destination__c);
    }
    accountIds.remove(null);
    Map<Id, Location> geocodes = ShipmentEtaService.accountLocations(accountIds);

    List<Shipment__c> updates = new List<Shipment__c>();
    for (Shipment__c s : moving) {
      Location here = ShipmentEtaService.currentPosition(s, geocodes);
      Location there = geocodes.get(s.Destination__c);
      if (here == null || there == null) {
        continue;
      }
      Decimal speed = ShipmentEtaService.AVG_SPEED_KPH.containsKey(s.Mode__c)
        ? ShipmentEtaService.AVG_SPEED_KPH.get(s.Mode__c)
        : ShipmentEtaService.DEFAULT_SPEED_KPH;
      // Delayed freight crawls at a quarter speed.
      if (s.Status__c == 'Delayed') {
        speed = speed / 4;
      }
      Decimal travelKm = speed * hours;
      List<Location> route = RouteGeometry.decode(s.Route__c);
      Location next;
      Boolean arrived;
      if (route.size() >= 2) {
        // Follow the planned road (or air) path.
        next = RouteGeometry.advance(route, here, travelKm);
        arrived = RouteGeometry.remainingKm(route, next) < 0.5;
      } else {
        Decimal remaining = Decimal.valueOf(Location.getDistance(here, there, 'km'));
        Decimal fraction = 1;
        if (remaining > 0 && travelKm < remaining) {
          fraction = travelKm / remaining;
        }
        next = interpolate(here, there, fraction);
        arrived = fraction >= 1;
      }

      Shipment__c u = new Shipment__c(Id = s.Id);
      u.Current_Location__Latitude__s = next.getLatitude();
      u.Current_Location__Longitude__s = next.getLongitude();
      u.Last_Ping_At__c = ShipmentEtaService.now();
      if (arrived) {
        u.Status__c = 'Delivered';
      }
      updates.add(u);
    }
    update as user updates;
    return updates.size();
  }

  /** Straight-line interpolation in lat/lng; plenty for a demo at continental scale. */
  @TestVisible
  private static Location interpolate(Location a, Location b, Decimal fraction) {
    Double f = fraction.doubleValue();
    return Location.newInstance(
      a.getLatitude() + (b.getLatitude() - a.getLatitude()) * f,
      a.getLongitude() + (b.getLongitude() - a.getLongitude()) * f
    );
  }
}
