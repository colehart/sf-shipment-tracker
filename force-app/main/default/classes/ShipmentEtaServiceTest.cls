@IsTest
private class ShipmentEtaServiceTest {
  private static final Datetime T0 = Datetime.newInstanceGmt(2026, 3, 2, 12, 0, 0);

  private static Location denver() {
    return Location.newInstance(ShipmentTestData.DENVER_LAT, ShipmentTestData.DENVER_LNG);
  }

  private static Location chicago() {
    return Location.newInstance(ShipmentTestData.CHICAGO_LAT, ShipmentTestData.CHICAGO_LNG);
  }

  @IsTest
  static void estimatesTruckEtaFromDistanceAndSpeed() {
    ShipmentEtaService.Estimate e = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      T0.addDays(3),
      'In Transit'
    );

    Assert.isTrue(
      e.remainingKm > 1400 && e.remainingKm < 1550,
      'Denver to Chicago is about 1,475 km, got ' + e.remainingKm
    );
    // ~1,475 km at 65 km/h is about 22.7 hours.
    Long hours = (e.estimatedArrival.getTime() - T0.getTime()) / 3600000;
    Assert.isTrue(
      hours >= 21 && hours <= 23,
      'Truck ETA should be about 22 hours out, got ' + hours
    );
    Assert.areEqual(ShipmentEtaService.RISK_ON_TIME, e.lateRisk);
  }

  @IsTest
  static void airIsFasterThanTruck() {
    ShipmentEtaService.Estimate truck = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      null,
      'In Transit'
    );
    ShipmentEtaService.Estimate air = ShipmentEtaService.estimate(
      'Air',
      denver(),
      chicago(),
      T0,
      null,
      'In Transit'
    );
    Assert.isTrue(air.estimatedArrival < truck.estimatedArrival, 'Air should arrive before truck');
  }

  @IsTest
  static void unknownModeFallsBackToTruckSpeed() {
    ShipmentEtaService.Estimate truck = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      null,
      null
    );
    ShipmentEtaService.Estimate unknown = ShipmentEtaService.estimate(
      null,
      denver(),
      chicago(),
      T0,
      null,
      null
    );
    Assert.areEqual(truck.estimatedArrival, unknown.estimatedArrival);
  }

  @IsTest
  static void flagsLateWhenEtaPassesPromise() {
    ShipmentEtaService.Estimate e = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      T0.addHours(10),
      'In Transit'
    );
    Assert.areEqual(ShipmentEtaService.RISK_LATE, e.lateRisk);
  }

  @IsTest
  static void flagsAtRiskInsideBuffer() {
    // ETA is ~22.7h out; promise at 25h leaves ~2h of slack, under the 4h buffer.
    ShipmentEtaService.Estimate e = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      T0.addHours(25),
      'In Transit'
    );
    Assert.areEqual(ShipmentEtaService.RISK_AT_RISK, e.lateRisk);
  }

  @IsTest
  static void delayedAndExceptionStatusesEscalateToAtRisk() {
    for (String status : new List<String>{ 'Delayed', 'Exception' }) {
      ShipmentEtaService.Estimate e = ShipmentEtaService.estimate(
        'Truck',
        denver(),
        chicago(),
        T0,
        T0.addDays(5),
        status
      );
      Assert.areEqual(ShipmentEtaService.RISK_AT_RISK, e.lateRisk, status + ' should be At Risk');
    }
  }

  @IsTest
  static void noPromiseMeansNoRisk() {
    ShipmentEtaService.Estimate e = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      null,
      'In Transit'
    );
    Assert.isNull(e.lateRisk);
    Assert.isNotNull(e.estimatedArrival);
  }

  @IsTest
  static void deliveredHasNoRemainingDistance() {
    ShipmentEtaService.Estimate e = ShipmentEtaService.estimate(
      'Truck',
      chicago(),
      chicago(),
      T0,
      T0,
      'Delivered'
    );
    Assert.areEqual(0, e.remainingKm);
    Assert.isNull(e.lateRisk);
  }

  @IsTest
  static void missingLocationReturnsNull() {
    Assert.isNull(ShipmentEtaService.estimate('Truck', null, chicago(), T0, null, null));
    Assert.isNull(ShipmentEtaService.estimate('Truck', denver(), null, T0, null, null));
  }

  @IsTest
  static void triggerStampsEtaOnInsertInBulk() {
    ShipmentEtaService.nowOverride = T0;
    List<Account> sites = ShipmentTestData.denverAndChicago();
    List<Shipment__c> batch = new List<Shipment__c>();
    for (Integer i = 0; i < 200; i++) {
      batch.add(ShipmentTestData.shipment(sites[0], sites[1], T0.addDays(3)));
    }

    Test.startTest();
    insert batch;
    Test.stopTest();

    for (Shipment__c s : [
      SELECT Remaining_Km__c, Estimated_Arrival__c, Late_Risk__c
      FROM Shipment__c
    ]) {
      Assert.isNotNull(s.Remaining_Km__c);
      Assert.isNotNull(s.Estimated_Arrival__c);
      Assert.areEqual(ShipmentEtaService.RISK_ON_TIME, s.Late_Risk__c);
    }
  }

  @IsTest
  static void triggerRecalculatesWhenPingArrives() {
    ShipmentEtaService.nowOverride = T0;
    List<Account> sites = ShipmentTestData.denverAndChicago();
    Shipment__c s = ShipmentTestData.shipment(sites[0], sites[1], T0.addHours(30));
    insert s;
    Decimal before = [SELECT Remaining_Km__c FROM Shipment__c WHERE Id = :s.Id].Remaining_Km__c;

    Test.startTest();
    // Halfway-ish, near Omaha.
    s.Current_Location__Latitude__s = 41.2565;
    s.Current_Location__Longitude__s = -95.9345;
    s.Last_Ping_At__c = T0.addHours(8);
    update s;
    Test.stopTest();

    Shipment__c after = [
      SELECT Remaining_Km__c, Estimated_Arrival__c
      FROM Shipment__c
      WHERE Id = :s.Id
    ];
    Assert.isTrue(after.Remaining_Km__c < before, 'Remaining distance should shrink after a ping');
    Assert.isTrue(after.Estimated_Arrival__c > T0.addHours(8), 'ETA should be after the ping time');
  }

  @IsTest
  static void unrelatedEditsSkipRecalculation() {
    List<Account> sites = ShipmentTestData.denverAndChicago();
    Shipment__c s = ShipmentTestData.shipment(sites[0], sites[1], null);
    insert s;
    Shipment__c changed = s.clone(true, true);
    changed.Carrier__c = 'Another Carrier';
    Assert.isFalse(ShipmentTriggerHandler.needsRecalc(changed, s));
    changed.Status__c = 'Delayed';
    Assert.isTrue(ShipmentTriggerHandler.needsRecalc(changed, s));
  }

  @IsTest
  static void bookedShipmentPlansFromScheduledDeparture() {
    ShipmentEtaService.nowOverride = T0;
    List<Account> sites = ShipmentTestData.denverAndChicago();
    Shipment__c s = ShipmentTestData.shipment(sites[0], sites[1], null);
    s.Status__c = 'Booked';
    s.Shipped_At__c = T0.addDays(2);
    insert s;
    Shipment__c saved = [SELECT Estimated_Arrival__c FROM Shipment__c WHERE Id = :s.Id];
    Assert.isTrue(
      saved.Estimated_Arrival__c > T0.addDays(2),
      'ETA should count from the departure date'
    );
  }

  @IsTest
  static void bypassSkipsTrigger() {
    List<Account> sites = ShipmentTestData.denverAndChicago();
    ShipmentTriggerHandler.bypass = true;
    Shipment__c s = ShipmentTestData.shipment(sites[0], sites[1], null);
    insert s;
    s.Status__c = 'Delayed';
    update s;
    Assert.isNull(
      [SELECT Estimated_Arrival__c FROM Shipment__c WHERE Id = :s.Id].Estimated_Arrival__c
    );
  }

  @IsTest
  static void routeDistanceReplacesStraightLine() {
    // A dog-leg via Dallas is much longer than Denver to Chicago direct.
    List<Location> route = new List<Location>{
      denver(),
      Location.newInstance(32.7767, -96.7970),
      chicago()
    };
    ShipmentEtaService.Estimate direct = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      T0.addDays(2),
      'In Transit'
    );
    ShipmentEtaService.Estimate routed = ShipmentEtaService.estimate(
      'Truck',
      denver(),
      chicago(),
      T0,
      T0.addDays(2),
      'In Transit',
      route
    );
    Assert.isTrue(
      routed.remainingKm > direct.remainingKm + 500,
      'Route via Dallas should add distance'
    );
    Assert.isTrue(routed.estimatedArrival > direct.estimatedArrival);
  }

  @IsTest
  static void triggerUsesRouteField() {
    ShipmentEtaService.nowOverride = T0;
    List<Account> sites = ShipmentTestData.denverAndChicago();
    Shipment__c direct = ShipmentTestData.shipment(sites[0], sites[1], null);
    Shipment__c routed = ShipmentTestData.shipment(sites[0], sites[1], null);
    // Denver -> Dallas -> Chicago, encoded at precision 5.
    routed.Route__c = ShipmentTestData.VIA_DALLAS_POLYLINE;
    insert new List<Shipment__c>{ direct, routed };
    Map<Id, Shipment__c> saved = new Map<Id, Shipment__c>(
      [SELECT Remaining_Km__c FROM Shipment__c]
    );
    Assert.isTrue(
      saved.get(routed.Id).Remaining_Km__c > saved.get(direct.Id).Remaining_Km__c + 500
    );
  }
}
