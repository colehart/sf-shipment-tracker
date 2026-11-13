// Loads a demo freight network: 12 sites and 24 shipments across the US.
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

// name, city, state, lat, lng
List<List<Object>> siteRows = new List<List<Object>>{
  new List<Object>{ 'Denver Distribution Center', 'Denver', 'CO', 39.7392, -104.9903 },
  new List<Object>{ 'Chicago Cross-Dock', 'Chicago', 'IL', 41.8781, -87.6298 },
  new List<Object>{ 'Dallas Fulfillment', 'Dallas', 'TX', 32.7767, -96.7970 },
  new List<Object>{ 'Atlanta Regional Hub', 'Atlanta', 'GA', 33.7490, -84.3880 },
  new List<Object>{ 'Port of Long Beach Terminal', 'Long Beach', 'CA', 33.7701, -118.1937 },
  new List<Object>{ 'Seattle Cold Storage', 'Seattle', 'WA', 47.6062, -122.3321 },
  new List<Object>{ 'Memphis Air Gateway', 'Memphis', 'TN', 35.1495, -90.0490 },
  new List<Object>{ 'Newark Port Warehouse', 'Newark', 'NJ', 40.7357, -74.1724 },
  new List<Object>{ 'Kansas City Rail Yard', 'Kansas City', 'MO', 39.0997, -94.5786 },
  new List<Object>{ 'Phoenix Retail DC', 'Phoenix', 'AZ', 33.4484, -112.0740 },
  new List<Object>{ 'Minneapolis Grocery Co-op', 'Minneapolis', 'MN', 44.9778, -93.2650 },
  new List<Object>{ 'Salt Lake Parts Depot', 'Salt Lake City', 'UT', 40.7608, -111.8910 }
};
List<Account> sites = new List<Account>();
for (List<Object> r : siteRows) {
  sites.add(
    new Account(
      Name = (String) r[0],
      Site = demoTag,
      BillingCity = (String) r[1],
      BillingState = (String) r[2],
      BillingCountry = 'United States',
      BillingLatitude = (Decimal) r[3],
      BillingLongitude = (Decimal) r[4],
      Type = 'Other',
      Description = 'Demo site for the Shipment Tracker map.'
    )
  );
}
insert sites;

// origin index, destination index, mode, carrier, status, fraction travelled, promise offset (hours from now)
List<List<Object>> lanes = new List<List<Object>>{
  new List<Object>{ 0, 1, 'Truck', 'Front Range Freight', 'In Transit', 0.55, 20 },
  new List<Object>{ 1, 0, 'Truck', 'Front Range Freight', 'In Transit', 0.30, 10 },
  new List<Object>{ 4, 9, 'Truck', 'Desert Line Carriers', 'In Transit', 0.70, 9 },
  new List<Object>{ 4, 0, 'Rail', 'Western Pacific Rail', 'Delayed', 0.40, 30 },
  new List<Object>{ 4, 8, 'Rail', 'Western Pacific Rail', 'In Transit', 0.25, 60 },
  new List<Object>{ 7, 3, 'Truck', 'Atlantic Coast Haulers', 'In Transit', 0.60, 7 },
  new List<Object>{ 7, 1, 'Rail', 'Great Lakes Rail', 'In Transit', 0.50, 40 },
  new List<Object>{ 6, 5, 'Air', 'Bluff City Air Cargo', 'In Transit', 0.45, 4 },
  new List<Object>{ 6, 2, 'Air', 'Bluff City Air Cargo', 'Delivered', 1.00, -6 },
  new List<Object>{ 2, 3, 'Truck', 'Lone Star Logistics', 'In Transit', 0.80, 6 },
  new List<Object>{ 2, 9, 'Truck', 'Lone Star Logistics', 'Exception', 0.35, 14 },
  new List<Object>{ 3, 7, 'Truck', 'Peach State Freight', 'In Transit', 0.20, 18 },
  new List<Object>{ 8, 10, 'Truck', 'Heartland Transport', 'In Transit', 0.65, 4 },
  new List<Object>{ 8, 2, 'Rail', 'Heartland Rail', 'In Transit', 0.15, 50 },
  new List<Object>{ 5, 11, 'Truck', 'Cascade Reefer Lines', 'In Transit', 0.50, 12 },
  new List<Object>{ 5, 4, 'Ocean', 'Pacific Coastal Shipping', 'In Transit', 0.30, 48 },
  new List<Object>{ 11, 0, 'Truck', 'Wasatch Express', 'Delivered', 1.00, -20 },
  new List<Object>{ 11, 9, 'Truck', 'Wasatch Express', 'In Transit', 0.40, 6 },
  new List<Object>{ 10, 1, 'Truck', 'North Star Freight', 'Delayed', 0.50, 5 },
  new List<Object>{ 9, 2, 'Truck', 'Desert Line Carriers', 'In Transit', 0.10, 26 },
  new List<Object>{ 0, 11, 'Truck', 'Front Range Freight', 'Booked', 0.00, 30 },
  new List<Object>{ 1, 7, 'Truck', 'Great Lakes Express', 'Booked', 0.00, 40 },
  new List<Object>{ 3, 6, 'Truck', 'Peach State Freight', 'In Transit', 0.75, 2 },
  new List<Object>{ 7, 4, 'Air', 'Coast to Coast Air', 'In Transit', 0.60, 3 }
};

Datetime now = Datetime.now();
List<Shipment__c> shipments = new List<Shipment__c>();
for (List<Object> l : lanes) {
  Account o = sites[(Integer) l[0]];
  Account d = sites[(Integer) l[1]];
  String status = (String) l[4];
  Decimal f = (Decimal) l[5];
  Shipment__c s = new Shipment__c(
    Origin__c = o.Id,
    Destination__c = d.Id,
    Mode__c = (String) l[2],
    Carrier__c = (String) l[3],
    Status__c = status,
    Weight_Kg__c = 2000 + Math.mod(shipments.size() * 1373, 18000),
    Promised_Delivery__c = now.addHours((Integer) l[6])
  );
  if (status == 'Booked') {
    s.Shipped_At__c = now.addHours(6);
  } else {
    s.Shipped_At__c = now.addHours(-24);
    s.Last_Ping_At__c = now.addMinutes(-15);
    s.Current_Location__Latitude__s =
      o.BillingLatitude + (d.BillingLatitude - o.BillingLatitude) * f;
    s.Current_Location__Longitude__s =
      o.BillingLongitude + (d.BillingLongitude - o.BillingLongitude) * f;
  }
  shipments.add(s);
}
insert shipments;
System.debug('Seeded ' + sites.size() + ' sites and ' + shipments.size() + ' shipments.');
