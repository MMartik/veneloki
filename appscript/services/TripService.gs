/**
 * Veneloki - TripService.gs
 *
 * Matkojen käsittely:
 * - aloita matka
 * - päätä matka
 * - hae aktiivinen matka
 * - tarkista aktiivinen matka
 */

function startTrip(payload) {
  validateStartTripPayload_(payload);

  if (isTripActive()) {
    throw new Error("Aktiivinen matka on jo käynnissä.");
  }

  const now = new Date();
  const tripId = createId_("trip");
  const sheet = getRequiredSheet_("Matkat");
  const headers = getHeaderMap_(sheet);

  const row = buildEmptyRow_(headers);

  setRowValue_(row, headers, "tripId", tripId);
  setRowValue_(row, headers, "status", TRIP_STATUS.ACTIVE);
  setRowValue_(row, headers, "startTime", now);
  setRowValue_(row, headers, "crew", String(payload.crew || "").trim());
  setRowValue_(row, headers, "startNotes", String(payload.startNotes || "").trim());
  setRowValue_(row, headers, "startLat", nullableNumber_(payload.latitude));
  setRowValue_(row, headers, "startLon", nullableNumber_(payload.longitude));
  setRowValue_(row, headers, "engineHoursStart", nullableNumber_(payload.engineHours));
  setRowValue_(row, headers, "dataUpdatedAt", now);
  setRowValue_(row, headers, "createdAt", now);
  setRowValue_(row, headers, "updatedAt", now);

  appendRow_(sheet, row);

  const event = createTripStartEvent_({
    tripId,
    crew: payload.crew,
    startNotes: payload.startNotes,
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: payload.accuracyM,
    speedMs: payload.speedMs,
    headingDeg: payload.headingDeg,
    eventTime: now
  });

  return {
    ok: true,
    tripId,
    eventId: event.eventId,
    startedAt: now.toISOString()
  };
}

function endTrip(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Matkan päätöstiedot puuttuvat.");
  }

  const activeTrip = getCurrentTrip();

  if (!activeTrip) {
    throw new Error("Aktiivista matkaa ei löytynyt.");
  }

  const now = new Date();
  const sheet = getRequiredSheet_("Matkat");
  const headers = getHeaderMap_(sheet);

  const rowNumber = activeTrip.__rowNumber;
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];

  setRowValue_(values, headers, "status", TRIP_STATUS.COMPLETED);
  setRowValue_(values, headers, "endTime", now);
  setRowValue_(values, headers, "endNotes", String(payload.endNotes || "").trim());
  setRowValue_(values, headers, "endLat", nullableNumber_(payload.latitude));
  setRowValue_(values, headers, "endLon", nullableNumber_(payload.longitude));
  setRowValue_(values, headers, "engineHoursEnd", nullableNumber_(payload.engineHours));
  setRowValue_(values, headers, "dataUpdatedAt", now);
  setRowValue_(values, headers, "updatedAt", now);

  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);

  const event = createTripEndEvent_({
    tripId: activeTrip.tripId,
    endNotes: payload.endNotes,
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: payload.accuracyM,
    speedMs: payload.speedMs,
    headingDeg: payload.headingDeg,
    eventTime: now
  });

  return {
    ok: true,
    tripId: activeTrip.tripId,
    eventId: event.eventId,
    endedAt: now.toISOString()
  };
}

function getCurrentTrip() {
  const sheet = getRequiredSheet_("Matkat");

  if (sheet.getLastRow() < 2) {
    return null;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const trip = rowToObject_(headers, rows[index]);

    if (trip.status === TRIP_STATUS.ACTIVE) {
      trip.__rowNumber = index + 2;
      return trip;
    }
  }

  return null;
}

function isTripActive() {
  return getCurrentTrip() !== null;
}

function validateStartTripPayload_(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Matkan aloitustiedot puuttuvat.");
  }

  const crew = String(payload.crew || "").trim();

  if (!crew) {
    throw new Error("Miehistö on pakollinen tieto.");
  }

  validateCoordinatePair_(payload.latitude, payload.longitude);
}

function createTripStartEvent_(data) {
  return createEventRecord_({
    tripId: data.tripId,
    eventTime: data.eventTime,
    eventType: EVENT_TYPE.TRIP_START,
    source: EVENT_SOURCE.MANUAL,
    title: "Matka aloitettu",
    text: buildTripStartText_(data.crew, data.startNotes),
    latitude: data.latitude,
    longitude: data.longitude,
    accuracyM: data.accuracyM,
    speedMs: data.speedMs,
    headingDeg: data.headingDeg
  });
}

function createTripEndEvent_(data) {
  return createEventRecord_({
    tripId: data.tripId,
    eventTime: data.eventTime,
    eventType: EVENT_TYPE.TRIP_END,
    source: EVENT_SOURCE.MANUAL,
    title: "Matka päätetty",
    text: String(data.endNotes || "").trim(),
    latitude: data.latitude,
    longitude: data.longitude,
    accuracyM: data.accuracyM,
    speedMs: data.speedMs,
    headingDeg: data.headingDeg
  });
}

function buildTripStartText_(crew, notes) {
  const lines = [];

  if (crew) {
    lines.push("Miehistö: " + String(crew).trim());
  }

  if (notes) {
    lines.push(String(notes).trim());
  }

  return lines.join("\n");
}
