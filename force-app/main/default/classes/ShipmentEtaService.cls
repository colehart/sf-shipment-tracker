/**
 * Computes remaining distance, estimated arrival, and late risk for shipments.
 *
 * The math lives in estimate(), a pure function with no SOQL or DML so it is
 * cheap to unit test. apply() is the bulk-safe entry point the trigger calls:
 * one query for every Account geocode it needs, no matter how many records.
 */
public with sharing class ShipmentEtaService {
  public static final String RISK_ON_TIME = 'On Time';
  public static final String RISK_AT_RISK = 'At Risk';
  public static final String RISK_LATE = 'Late';

  /** Hours of slack below which an on-schedule shipment is flagged At Risk. */
  public static final Decimal AT_RISK_BUFFER_HOURS = 4;

  /**
   * Average door-to-door speed by mode, including stops, dwell, and handling.
   * Deliberately simple planning numbers; a real system would learn these per lane.
   */
  public static final Map<String, Decimal> AVG_SPEED_KPH = new Map<String, Decimal>{
    'Truck' => 65,
    'Rail' => 40,
    'Ocean' => 28,
    'Air' => 500
  };
  public static final Decimal DEFAULT_SPEED_KPH = 65;

  @TestVisible
  private static Datetime nowOverride;

  public static Datetime now() {
    return nowOverride != null ? nowOverride : Datetime.now();
  }

  public class Estimate {
    public Decimal remainingKm;
    public Datetime estimatedArrival;
    public String lateRisk;
  }

  /**
   * Pure ETA and risk calculation.
   *
   * @param mode         Mode__c value; unknown or blank falls back to truck speed
   * @param position     where the freight is now (last ping, or the origin if no ping yet)
   * @param destination  destination Account geocode
   * @param asOf         time the position was observed
   * @param promised     Promised_Delivery__c, may be null
   * @param status       Status__c, used to escalate Delayed and Exception shipments
   * @return null when there is not enough location data to estimate
   */
  public static Estimate estimate(
    String mode,
    Location position,
    Location destination,
    Datetime asOf,
    Datetime promised,
    String status
  ) {
    return estimate(mode, position, destination, asOf, promised, status, null);
  }

  /**
   * Same as above, but measures the distance left along a planned route
   * (decoded Route__c) instead of a straight line when one is given.
   */
  public static Estimate estimate(
    String mode,
    Location position,
    Location destination,
    Datetime asOf,
    Datetime promised,
    String status,
    List<Location> route
  ) {
    if (position == null || destination == null || asOf == null) {
      return null;
    }
    Estimate result = new Estimate();
    if (status == 'Delivered') {
      result.remainingKm = 0;
      return result;
    }

    Decimal km = RouteGeometry.remainingKm(route, position);
    if (km == null) {
      km = Decimal.valueOf(Location.getDistance(position, destination, 'km'));
    }
    result.remainingKm = km.setScale(1);

    Decimal speed = AVG_SPEED_KPH.containsKey(mode) ? AVG_SPEED_KPH.get(mode) : DEFAULT_SPEED_KPH;
    Integer minutes = (km / speed * 60).round(System.RoundingMode.CEILING).intValue();
    result.estimatedArrival = asOf.addMinutes(minutes);
    result.lateRisk = classify(result.estimatedArrival, promised, status);
    return result;
  }

  @TestVisible
  private static String classify(Datetime eta, Datetime promised, String status) {
    if (promised == null) {
      return null;
    }
    Decimal slackHours = (promised.getTime() - eta.getTime()) / 3600000.0;
    if (slackHours < 0) {
      return RISK_LATE;
    }
    if (slackHours < AT_RISK_BUFFER_HOURS || status == 'Delayed' || status == 'Exception') {
      return RISK_AT_RISK;
    }
    return RISK_ON_TIME;
  }

  /**
   * Stamps Remaining_Km__c, Estimated_Arrival__c, and Late_Risk__c on each record.
   * Intended for before-insert and before-update triggers, so it does no DML.
   */
  public static void apply(List<Shipment__c> shipments) {
    Set<Id> accountIds = new Set<Id>();
    for (Shipment__c s : shipments) {
      if (s.Origin__c != null) {
        accountIds.add(s.Origin__c);
      }
      if (s.Destination__c != null) {
        accountIds.add(s.Destination__c);
      }
    }
    Map<Id, Location> geocodes = accountLocations(accountIds);

    for (Shipment__c s : shipments) {
      Location position = currentPosition(s, geocodes);
      Datetime asOf = s.Last_Ping_At__c;
      if (asOf == null) {
        // Not moving yet: plan from the later of now and the scheduled departure.
        asOf = (s.Shipped_At__c != null && s.Shipped_At__c > now()) ? s.Shipped_At__c : now();
      }
      Estimate e = estimate(
        s.Mode__c,
        position,
        geocodes.get(s.Destination__c),
        asOf,
        s.Promised_Delivery__c,
        s.Status__c,
        RouteGeometry.decode(s.Route__c)
      );
      s.Remaining_Km__c = e?.remainingKm;
      s.Estimated_Arrival__c = e?.estimatedArrival;
      s.Late_Risk__c = e?.lateRisk;
    }
  }

  /** Last reported position, or the origin geocode when the carrier has not pinged yet. */
  public static Location currentPosition(Shipment__c s, Map<Id, Location> geocodes) {
    if (s.Current_Location__Latitude__s != null && s.Current_Location__Longitude__s != null) {
      return Location.newInstance(
        s.Current_Location__Latitude__s,
        s.Current_Location__Longitude__s
      );
    }
    return geocodes.get(s.Origin__c);
  }

  /**
   * Billing geocodes for the given Accounts. Runs in system mode on purpose:
   * the ETA must be correct even when the editing user cannot see the far-end Account.
   * Only coordinates are read, and they are never returned to the caller.
   */
  public static Map<Id, Location> accountLocations(Set<Id> accountIds) {
    Map<Id, Location> result = new Map<Id, Location>();
    if (accountIds.isEmpty()) {
      return result;
    }
    for (Account a : [
      SELECT Id, BillingLatitude, BillingLongitude
      FROM Account
      WHERE Id IN :accountIds AND BillingLatitude != NULL AND BillingLongitude != NULL
      WITH SYSTEM_MODE
    ]) {
      result.put(a.Id, Location.newInstance(a.BillingLatitude, a.BillingLongitude));
    }
    return result;
  }
}
