/** Shared fixtures for the Shipment Tracker Apex tests. */
@IsTest
public class ShipmentTestData {
  // Denver to Chicago is roughly 1,475 km great-circle.
  public static final Decimal DENVER_LAT = 39.7392;
  public static final Decimal DENVER_LNG = -104.9903;
  public static final Decimal CHICAGO_LAT = 41.8781;
  public static final Decimal CHICAGO_LNG = -87.6298;

  /** Denver -> Dallas -> Chicago as a precision-5 encoded polyline. */
  public static final String VIA_DALLAS_POLYLINE = '_qpqFj|x_Srzni@cg_q@wrpv@_n}v@';

  public static Account site(String name, Decimal lat, Decimal lng) {
    return new Account(
      Name = name,
      BillingCity = name,
      BillingLatitude = lat,
      BillingLongitude = lng
    );
  }

  public static List<Account> denverAndChicago() {
    List<Account> sites = new List<Account>{
      site('Denver DC', DENVER_LAT, DENVER_LNG),
      site('Chicago Hub', CHICAGO_LAT, CHICAGO_LNG)
    };
    insert sites;
    return sites;
  }

  public static Shipment__c shipment(Account origin, Account destination, Datetime promised) {
    return new Shipment__c(
      Origin__c = origin.Id,
      Destination__c = destination.Id,
      Mode__c = 'Truck',
      Status__c = 'In Transit',
      Carrier__c = 'Test Freight',
      Promised_Delivery__c = promised
    );
  }

  /** A Standard User with the Shipment Tracker permission set, for user-mode tests. */
  public static User trackerUser() {
    Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
    String unique = String.valueOf(Crypto.getRandomInteger()).replace('-', '');
    User u = new User(
      Alias = 'shiptst',
      Email = 'shipment.tracker.test@example.com',
      EmailEncodingKey = 'UTF-8',
      LastName = 'Tracker',
      LanguageLocaleKey = 'en_US',
      LocaleSidKey = 'en_US',
      ProfileId = p.Id,
      TimeZoneSidKey = 'America/Denver',
      Username = 'shipment.tracker.' + unique + '@example.com.test'
    );
    insert u;
    PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'Shipment_Tracker_User' LIMIT 1];
    insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
    return u;
  }
}
