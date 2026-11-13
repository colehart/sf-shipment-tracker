/**
 * Keeps trigger logic out of the trigger file so it can be unit tested and
 * extended (after-save notifications, rollups) without touching the trigger.
 */
public with sharing class ShipmentTriggerHandler {
  @TestVisible
  private static Boolean bypass = false;

  public static void beforeInsert(List<Shipment__c> newRecords) {
    if (bypass) {
      return;
    }
    ShipmentEtaService.apply(newRecords);
  }

  public static void beforeUpdate(List<Shipment__c> newRecords, Map<Id, Shipment__c> oldMap) {
    if (bypass) {
      return;
    }
    List<Shipment__c> changed = new List<Shipment__c>();
    for (Shipment__c s : newRecords) {
      if (needsRecalc(s, oldMap.get(s.Id))) {
        changed.add(s);
      }
    }
    if (!changed.isEmpty()) {
      ShipmentEtaService.apply(changed);
    }
  }

  private static final List<String> ETA_INPUTS = new List<String>{
    'Origin__c',
    'Destination__c',
    'Mode__c',
    'Status__c',
    'Shipped_At__c',
    'Promised_Delivery__c',
    'Last_Ping_At__c',
    'Current_Location__Latitude__s',
    'Current_Location__Longitude__s'
  };

  @TestVisible
  private static Boolean needsRecalc(Shipment__c newRecord, Shipment__c oldRecord) {
    for (String field : ETA_INPUTS) {
      if (newRecord.get(field) != oldRecord.get(field)) {
        return true;
      }
    }
    return false;
  }
}
