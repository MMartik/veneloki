/**
 * Veneloki - Constants.gs
 * Yhteiset vakioarvot.
 */

const TRIP_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed"
});

const EVENT_SOURCE = Object.freeze({
  MANUAL: "manual",
  AUTOMATIC: "automatic"
});

const EVENT_TYPE = Object.freeze({
  TRIP_START: "trip_start",
  TRIP_END: "trip_end",
  STATUS_CHANGE: "status_change",
  NOTE: "note",
  DISTURBANCE: "disturbance",
  AUTOMATIC_PLACE: "automatic_place",
  FUEL: "fuel"
});

const VESSEL_STATUS = Object.freeze({
  UNDERWAY: "underway",
  MOORED: "moored"
});

const MANUAL_STATUS = Object.freeze({
  DEPARTED: "departed",
  MOORED: "moored",
  ANCHORED: "anchored"
});

const PLACE_GEOMETRY_TYPE = Object.freeze({
  CIRCLE: "circle",
  LINE: "line",
  POLYGON: "polygon"
});

const FILL_TYPE = Object.freeze({
  FULL: "full",
  PARTIAL: "partial"
});
