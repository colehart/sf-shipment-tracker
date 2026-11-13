# Setup: free Salesforce Developer Edition org

About 20 minutes from nothing to a working map.

## 1. Get an org

1. Sign up at <https://developer.salesforce.com/signup>. It is free and does not expire while you
   log in at least every few months.
2. Confirm the email and set a password. Note the username: it looks like an email but is unique
   to Salesforce.

## 2. Install the tools

```bash
npm install --global @salesforce/cli
sf --version
```

Optional: VS Code with the Salesforce Extension Pack.

## 3. Deploy

```bash
git clone https://github.com/colehart/sf-shipment-tracker.git
cd sf-shipment-tracker
sf org login web --alias tracker
sf project deploy start --target-org tracker
sf org assign permset --name Shipment_Tracker_User --target-org tracker
```

The deploy includes:

- the `Shipment__c` object, layout, list view, and tabs
- Apex classes, trigger, and tests
- the `shipmentMap` component and the `Shipment Map` app page
- the `Shipment Tracker` Lightning app
- a CSP Trusted Site for `https://tiles.openfreemap.org` (the basemap)
- Change Data Capture enabled for `Shipment__c`

## 4. Load demo data

```bash
sf apex run --file scripts/apex/seed-demo-data.apex --target-org tracker
```

This creates 12 sites (Accounts tagged `Shipment Tracker Demo` in the Account Site field) and 24
shipments. Re-running it replaces the demo data.

## 5. Open the map

```bash
sf org open --target-org tracker --path lightning/n/Shipment_Map
```

Or use the App Launcher and pick **Shipment Tracker**.

To see live updates, keep the map open and run:

```bash
sf apex run --file scripts/apex/simulate-pings.apex --target-org tracker
```

Pins move and the risk chips change within a second or two. To keep the demo moving on its own:

```apex
System.schedule('Shipment pings', '0 0 * * * ?', new ShipmentPingSimulator());
```

## 6. Optional: add the map to Account pages

Open any demo Account, click the gear icon, **Edit Page**, drag **Shipment Map** from the
Custom components list onto the page, and **Save** then **Activate**.

## 7. Optional: use your own Accounts

The map uses each Account's billing geocode (`BillingLatitude` / `BillingLongitude`). To fill
those in for real addresses, go to **Setup → Data Integration Rules → Geocodes for Account
Billing Address** and activate it. Salesforce geocodes existing and new addresses in the
background.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Gray map, console shows "Refused to connect" | The CSP Trusted Site did not deploy or is inactive. Check **Setup → Trusted URLs** for `tiles.openfreemap.org` with connect-src and img-src. |
| "Showing the standard map because the vector map could not start" | The browser blocked WebGL or the MapLibre worker. The fallback map still works. Check the console for the exact error. |
| Badge says "Manual refresh" | Streaming is unavailable for this user or context. Check that `Shipment__c` is selected under **Setup → Change Data Capture**. |
| "You do not have access to the shipment data this map needs" | Assign the `Shipment_Tracker_User` permission set. |
| Deploy fails on `PlatformEventChannelMember` | Developer Edition allows 5 CDC entities. Remove one under **Setup → Change Data Capture**, or delete `platformEventChannelMembers/` and rely on the refresh button. |
