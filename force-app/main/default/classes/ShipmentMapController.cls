/**
 * Read-only API for the shipmentMap Lightning Web Component.
 *
 * Queries run in user mode, so object permissions, field-level security, and
 * sharing are all enforced: a user only sees the Accounts and Shipments they
 * could already open in the UI.
 */
public with sharing class ShipmentMapController {
  @TestVisible
  private static final Integer MAX_SHIPMENTS = 1000;
  @TestVisible
  private static final Integer MAX_SITES = 500;

  public class Site {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String name;
    @AuraEnabled
    public String city;
    @AuraEnabled
    public String state;
    @AuraEnabled
    public Decimal latitude;
    @AuraEnabled
    public Decimal longitude;
  }

  public class Shipment {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String name;
    @AuraEnabled
    public String status;
    @AuraEnabled
    public String mode;
    @AuraEnabled
    public String carrier;
    @AuraEnabled
    public String lateRisk;
    @AuraEnabled
    public Decimal remainingKm;
    @AuraEnabled
    public Datetime estimatedArrival;
    @AuraEnabled
    public Datetime promisedDelivery;
    @AuraEnabled
    public Datetime lastPingAt;
    @AuraEnabled
    public Id originId;
    @AuraEnabled
    public String originName;
    @AuraEnabled
    public Id destinationId;
    @AuraEnabled
    public String destinationName;
    @AuraEnabled
    public Decimal latitude;
    @AuraEnabled
    public Decimal longitude;
  }

  public class MapData {
    @AuraEnabled
    public List<Site> sites = new List<Site>();
    @AuraEnabled
    public List<Shipment> shipments = new List<Shipment>();
  }

  /**
   * @param accountId optional. On an Account record page, limits the map to that
   *                  Account and the shipments moving in or out of it.
   */
  @AuraEnabled(cacheable=true)
  public static MapData getMapData(Id accountId) {
    try {
      MapData data = new MapData();
      List<Shipment__c> records = queryShipments(accountId);
      Set<Id> linkedAccounts = new Set<Id>();
      for (Shipment__c s : records) {
        data.shipments.add(toDto(s));
        linkedAccounts.add(s.Origin__c);
        linkedAccounts.add(s.Destination__c);
      }
      linkedAccounts.remove(null);
      if (accountId != null) {
        linkedAccounts.add(accountId);
      }
      for (Account a : querySites(accountId, linkedAccounts)) {
        data.sites.add(toDto(a));
      }
      return data;
    } catch (Exception e) {
      // User-mode queries throw when the user lacks object or field access.
      String message = 'You do not have access to the shipment data this map needs. Ask an admin for the Shipment Tracker User permission set.';
      AuraHandledException handled = new AuraHandledException(message);
      handled.setMessage(message);
      throw handled;
    }
  }

  private static List<Shipment__c> queryShipments(Id accountId) {
    Integer maxRows = MAX_SHIPMENTS;
    if (accountId == null) {
      return [
        SELECT
          Id,
          Name,
          Status__c,
          Mode__c,
          Carrier__c,
          Late_Risk__c,
          Remaining_Km__c,
          Estimated_Arrival__c,
          Promised_Delivery__c,
          Last_Ping_At__c,
          Origin__c,
          Origin__r.Name,
          Origin__r.BillingLatitude,
          Origin__r.BillingLongitude,
          Destination__c,
          Destination__r.Name,
          Current_Location__Latitude__s,
          Current_Location__Longitude__s
        FROM Shipment__c
        WITH USER_MODE
        ORDER BY Promised_Delivery__c ASC NULLS LAST
        LIMIT :maxRows
      ];
    }
    return [
      SELECT
        Id,
        Name,
        Status__c,
        Mode__c,
        Carrier__c,
        Late_Risk__c,
        Remaining_Km__c,
        Estimated_Arrival__c,
        Promised_Delivery__c,
        Last_Ping_At__c,
        Origin__c,
        Origin__r.Name,
        Origin__r.BillingLatitude,
        Origin__r.BillingLongitude,
        Destination__c,
        Destination__r.Name,
        Current_Location__Latitude__s,
        Current_Location__Longitude__s
      FROM Shipment__c
      WHERE Origin__c = :accountId OR Destination__c = :accountId
      WITH USER_MODE
      ORDER BY Promised_Delivery__c ASC NULLS LAST
      LIMIT :maxRows
    ];
  }

  private static List<Account> querySites(Id accountId, Set<Id> linkedAccounts) {
    Integer maxRows = MAX_SITES;
    if (accountId == null) {
      // Every geocoded Account, so sites with no open shipments still show.
      return [
        SELECT Id, Name, BillingCity, BillingState, BillingLatitude, BillingLongitude
        FROM Account
        WHERE BillingLatitude != NULL AND BillingLongitude != NULL
        WITH USER_MODE
        ORDER BY Name
        LIMIT :maxRows
      ];
    }
    return [
      SELECT Id, Name, BillingCity, BillingState, BillingLatitude, BillingLongitude
      FROM Account
      WHERE Id IN :linkedAccounts AND BillingLatitude != NULL AND BillingLongitude != NULL
      WITH USER_MODE
      ORDER BY Name
      LIMIT :maxRows
    ];
  }

  @TestVisible
  private static Shipment toDto(Shipment__c s) {
    Shipment dto = new Shipment();
    dto.id = s.Id;
    dto.name = s.Name;
    dto.status = s.Status__c;
    dto.mode = s.Mode__c;
    dto.carrier = s.Carrier__c;
    dto.lateRisk = s.Late_Risk__c;
    dto.remainingKm = s.Remaining_Km__c;
    dto.estimatedArrival = s.Estimated_Arrival__c;
    dto.promisedDelivery = s.Promised_Delivery__c;
    dto.lastPingAt = s.Last_Ping_At__c;
    dto.originId = s.Origin__c;
    dto.originName = s.Origin__r?.Name;
    dto.destinationId = s.Destination__c;
    dto.destinationName = s.Destination__r?.Name;
    if (s.Current_Location__Latitude__s != null) {
      dto.latitude = s.Current_Location__Latitude__s;
      dto.longitude = s.Current_Location__Longitude__s;
    } else {
      // No ping yet: draw the shipment at its origin.
      dto.latitude = s.Origin__r?.BillingLatitude;
      dto.longitude = s.Origin__r?.BillingLongitude;
    }
    return dto;
  }

  @TestVisible
  private static Site toDto(Account a) {
    Site dto = new Site();
    dto.id = a.Id;
    dto.name = a.Name;
    dto.city = a.BillingCity;
    dto.state = a.BillingState;
    dto.latitude = a.BillingLatitude;
    dto.longitude = a.BillingLongitude;
    return dto;
  }
}
