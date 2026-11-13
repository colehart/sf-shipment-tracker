trigger ShipmentTrigger on Shipment__c(before insert, before update) {
  if (Trigger.isInsert) {
    ShipmentTriggerHandler.beforeInsert(Trigger.new);
  } else if (Trigger.isUpdate) {
    ShipmentTriggerHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
  }
}
