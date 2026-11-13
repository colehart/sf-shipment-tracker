// Loads the demo freight network from the shipmentDemoData static resource:
// 12 sites and 24 shipments across the US, with road routes for truck lanes
// and great-circle arcs for air lanes (once `npm run routes` has filled them in).
// Run with:  sf apex run --file scripts/apex/seed-demo-data.apex
// Safe to re-run: it deletes the demo records it created last time first.

// Demo Accounts are tagged in the standard Account Site field.
String demoTag = 'Shipment Tracker Demo';
delete [
  SELECT Id
  FROM Shipment__c
  WHERE Origin__r.Site = :demoTag OR Destination__r.Site = :demoTag
];
delete [SELECT Id FROM Account WHERE Site = :demoTag];

StaticResource resource = [SELECT Body FROM StaticResource WHERE Name = 'shipmentDemoData' LIMIT 1];
Map<String, Object> network = (Map<String, Object>) JSON.deserializeUntyped(
  resource.Body.toString()
);

// JSON numbers like 0 or 1 come back as Integer, so read every number through String.
Decimal toDecimal(Object value) {
  return value == null ? null : Decimal.valueOf(String.valueOf(value));
}

List<Account> sites = new List<Account>();
for (Object o : (List<Object>) network.get('sites')) {
  Map<String, Object> site = (Map<String, Object>) o;
  sites.add(
    new Account(
      Name = (String) site.get('name'),
      Site = demoTag,
      BillingCity = (String) site.get('city'),
      BillingState = (String) site.get('state'),
      BillingCountry = 'United States',
      BillingLatitude = toDecimal(site.get('lat')),
      BillingLongitude = toDecimal(site.get('lng')),
      Type = 'Other',
      Description = 'Demo site for the Shipment Tracker map.'
    )
  );
}
insert sites;

Datetime now = Datetime.now();
List<Shipment__c> shipments = new List<Shipment__c>();
for (Object o : (List<Object>) network.get('lanes')) {
  Map<String, Object> lane = (Map<String, Object>) o;
  Account origin = sites[(Integer) lane.get('origin')];
  Account destination = sites[(Integer) lane.get('destination')];
  String status = (String) lane.get('status');
  Decimal progress = toDecimal(lane.get('progress'));
  String route = (String) lane.get('route');

  Shipment__c s = new Shipment__c(
    Origin__c = origin.Id,
    Destination__c = destination.Id,
    Mode__c = (String) lane.get('mode'),
    Carrier__c = (String) lane.get('carrier'),
    Status__c = status,
    Route__c = route,
    Weight_Kg__c = 2000 + Math.mod(shipments.size() * 1373, 18000),
    Promised_Delivery__c = now.addHours((Integer) lane.get('promiseHours'))
  );
  if (status == 'Booked') {
    s.Shipped_At__c = now.addHours(6);
  } else {
    s.Shipped_At__c = now.addHours(-24);
    s.Last_Ping_At__c = now.addMinutes(-15);
    Location here;
    List<Location> path = RouteGeometry.decode(route);
    if (path.size() >= 2) {
      here = RouteGeometry.pointAt(path, progress);
    } else {
      here = Location.newInstance(
        origin.BillingLatitude + (destination.BillingLatitude - origin.BillingLatitude) * progress,
        origin.BillingLongitude +
        (destination.BillingLongitude - origin.BillingLongitude) * progress
      );
    }
    s.Current_Location__Latitude__s = here.getLatitude();
    s.Current_Location__Longitude__s = here.getLongitude();
  }
  shipments.add(s);
}
insert shipments;
System.debug('Seeded ' + sites.size() + ' sites and ' + shipments.size() + ' shipments.');
