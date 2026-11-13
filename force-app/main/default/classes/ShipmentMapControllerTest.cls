@IsTest
private class ShipmentMapControllerTest {
  @TestSetup
  static void setup() {
    List<Account> sites = ShipmentTestData.denverAndChicago();
    Account dallas = ShipmentTestData.site('Dallas Yard', 32.7767, -96.7970);
    Account noGeocode = new Account(Name = 'No Geocode Inc');
    insert new List<Account>{ dallas, noGeocode };

    Shipment__c toChicago = ShipmentTestData.shipment(
      sites[0],
      sites[1],
      Datetime.now().addDays(2)
    );
    toChicago.Current_Location__Latitude__s = 41.2565;
    toChicago.Current_Location__Longitude__s = -95.9345;
    toChicago.Last_Ping_At__c = Datetime.now();
    Shipment__c toDallas = ShipmentTestData.shipment(sites[1], dallas, Datetime.now().addDays(3));
    insert new List<Shipment__c>{ toChicago, toDallas };
  }

  @IsTest
  static void returnsAllShipmentsAndGeocodedSites() {
    User u = ShipmentTestData.trackerUser();
    ShipmentMapController.MapData data;
    System.runAs(u) {
      data = ShipmentMapController.getMapData(null);
    }
    Assert.areEqual(2, data.shipments.size());
    Assert.areEqual(3, data.sites.size(), 'Accounts without a geocode are left off the map');

    for (ShipmentMapController.Shipment s : data.shipments) {
      Assert.isNotNull(s.latitude, s.name + ' needs a position');
      Assert.isNotNull(s.originName);
      Assert.isNotNull(s.estimatedArrival);
    }
  }

  @IsTest
  static void unpingedShipmentIsDrawnAtOrigin() {
    User u = ShipmentTestData.trackerUser();
    Account chicago = [SELECT Id, BillingLatitude FROM Account WHERE Name = 'Chicago Hub'];
    ShipmentMapController.MapData data;
    System.runAs(u) {
      data = ShipmentMapController.getMapData(null);
    }
    for (ShipmentMapController.Shipment s : data.shipments) {
      if (s.originId == chicago.Id) {
        Assert.areEqual(chicago.BillingLatitude, s.latitude);
      }
    }
  }

  @IsTest
  static void filtersToOneAccount() {
    User u = ShipmentTestData.trackerUser();
    Account dallas = [SELECT Id FROM Account WHERE Name = 'Dallas Yard'];
    ShipmentMapController.MapData data;
    System.runAs(u) {
      data = ShipmentMapController.getMapData(dallas.Id);
    }
    Assert.areEqual(1, data.shipments.size(), 'Only the Chicago to Dallas shipment touches Dallas');
    Assert.areEqual(2, data.sites.size(), 'Dallas plus the linked Chicago hub');
  }

  @IsTest
  static void userWithoutPermissionGetsFriendlyError() {
    Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
    User noAccess = new User(
      Alias = 'noacc',
      Email = 'no.access@example.com',
      EmailEncodingKey = 'UTF-8',
      LastName = 'NoAccess',
      LanguageLocaleKey = 'en_US',
      LocaleSidKey = 'en_US',
      ProfileId = p.Id,
      TimeZoneSidKey = 'America/Denver',
      Username = 'no.access.' +
        String.valueOf(Crypto.getRandomInteger()).replace('-', '') +
        '@example.com.test'
    );
    insert noAccess;
    Boolean threw = false;
    System.runAs(noAccess) {
      try {
        ShipmentMapController.getMapData(null);
      } catch (AuraHandledException e) {
        threw = true;
      }
    }
    Assert.isTrue(threw, 'A user without the permission set should get an AuraHandledException');
  }
}
