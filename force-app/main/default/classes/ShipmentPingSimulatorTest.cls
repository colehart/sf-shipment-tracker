@IsTest
private class ShipmentPingSimulatorTest {
  @IsTest
  static void advanceMovesShipmentsAndDeliversWhenArrived() {
    List<Account> sites = ShipmentTestData.denverAndChicago();
    Shipment__c slow = ShipmentTestData.shipment(sites[0], sites[1], Datetime.now().addDays(2));
    Shipment__c fast = ShipmentTestData.shipment(sites[0], sites[1], Datetime.now().addDays(2));
    fast.Mode__c = 'Air';
    Shipment__c parked = ShipmentTestData.shipment(sites[0], sites[1], null);
    parked.Status__c = 'Booked';
    insert new List<Shipment__c>{ slow, fast, parked };
    User u = ShipmentTestData.trackerUser();

    Integer moved;
    Test.startTest();
    System.runAs(u) {
      // 6 hours: the truck covers ~390 km, the plane covers the whole ~1,475 km.
      moved = ShipmentPingSimulator.advance(6);
    }
    Test.stopTest();

    Assert.areEqual(2, moved, 'Booked shipments should not move');
    Map<Id, Shipment__c> after = new Map<Id, Shipment__c>(
      [SELECT Status__c, Remaining_Km__c, Last_Ping_At__c FROM Shipment__c]
    );
    Assert.areEqual('In Transit', after.get(slow.Id).Status__c);
    Assert.isTrue(after.get(slow.Id).Remaining_Km__c < 1200, 'Truck should be closer to Chicago');
    Assert.areEqual('Delivered', after.get(fast.Id).Status__c);
    Assert.isNull(after.get(parked.Id).Last_Ping_At__c);
  }

  @IsTest
  static void scheduleRunsOneHour() {
    List<Account> sites = ShipmentTestData.denverAndChicago();
    insert ShipmentTestData.shipment(sites[0], sites[1], null);
    User u = ShipmentTestData.trackerUser();
    System.runAs(u) {
      Test.startTest();
      System.schedule('Test pings', '0 0 * * * ?', new ShipmentPingSimulator());
      Test.stopTest();
    }
    Assert.isNotNull([SELECT Last_Ping_At__c FROM Shipment__c LIMIT 1].Last_Ping_At__c);
  }

  @IsTest
  static void followsRouteWhenOneIsSet() {
    List<Account> sites = ShipmentTestData.denverAndChicago();
    Shipment__c s = ShipmentTestData.shipment(sites[0], sites[1], null);
    s.Route__c = ShipmentTestData.VIA_DALLAS_POLYLINE;
    insert s;
    User u = ShipmentTestData.trackerUser();
    Test.startTest();
    System.runAs(u) {
      // 10 hours at 65 km/h = 650 km south-east toward Dallas, not east toward Chicago.
      ShipmentPingSimulator.advance(10);
    }
    Test.stopTest();
    Shipment__c after = [SELECT Current_Location__Latitude__s FROM Shipment__c WHERE Id = :s.Id];
    Assert.isTrue(
      after.Current_Location__Latitude__s < ShipmentTestData.DENVER_LAT - 2,
      'Should have moved south along the route, got ' + after.Current_Location__Latitude__s
    );
  }

  @IsTest
  static void interpolateHitsEndpoints() {
    Location a = Location.newInstance(0, 0);
    Location b = Location.newInstance(10, 20);
    Location mid = ShipmentPingSimulator.interpolate(a, b, 0.5);
    Assert.isTrue(mid.getLatitude() == 5, 'latitude halfway');
    Assert.isTrue(mid.getLongitude() == 10, 'longitude halfway');
  }
}
