// Moves every in-transit shipment 3 hours closer to its destination.
// Open the Shipment Map first: it updates live as the change events arrive.
// Run with:  sf apex run --file scripts/apex/simulate-pings.apex
Integer moved = ShipmentPingSimulator.advance(3);
System.debug('Moved ' + moved + ' shipments.');
