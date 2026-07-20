/**
 * Veneloki - EventService.gs
 *
 * Sisältää sekä yleisen lokikirjauksen tallennuksen että
 * manuaaliset tapahtumat:
 * - Irti
 * - Kiinni
 * - Ankkurissa
 * - Oma kirjaus
 * - Häiriö
 */

/**
 * Yleinen lokikirjauksen tallennus.
 */
function createEventRecord_(data) {
  const sheet = getRequiredSheet_("Lokikirjaukset");
  const headers = getHeaderMap_(sheet);
  const now = new Date();
  const eventId = createId_("event");
  const row = buildEmptyRow_(headers);

  setRowValue_(row, headers, "eventId", eventId);
  setRowValue_(row, headers, "tripId", data.tripId || "");
  setRowValue_(row, headers, "legId", data.legId || "");
  setRowValue_(row, headers, "eventTime", data.eventTime || now);
  setRowValue_(row, headers, "eventType", data.eventType || "");
  setRowValue_(row, headers, "source", data.source || "");
  setRowValue_(row, headers, "status", data.status || "");
  setRowValue_(row, headers, "title", data.title || "");
  setRowValue_(row, headers, "text", data.text || "");
  setRowValue_(row, headers, "latitude", nullableNumber_(data.latitude));
  setRowValue_(row, headers, "longitude", nullableNumber_(data.longitude));
  setRowValue_(row, headers, "accuracyM", nullableNumber_(data.accuracyM));
  setRowValue_(row, headers, "speedMs", nullableNumber_(data.speedMs));
  setRowValue_(row, headers, "headingDeg", nullableNumber_(data.headingDeg));
  setRowValue_(row, headers, "automaticEnteredAt", data.automaticEnteredAt || "");
  setRowValue_(row, headers, "automaticExitedAt", data.automaticExitedAt || "");
  setRowValue_(row, headers, "matchedPlaceId", data.matchedPlaceId || "");
  setRowValue_(row, headers, "photoCount", Number(data.photoCount || 0));
  setRowValue_(row, headers, "isDeleted", false);
  setRowValue_(row, headers, "createdAt", now);
  setRowValue_(row, headers, "updatedAt", now);

  appendRow_(sheet, row);

  return {
    eventId,
    tripId: data.tripId || "",
    eventTime: (data.eventTime || now).toISOString()
  };
}

function addDeparture(payload) {
  const trip = requireActiveTrip_();
  validateManualEventPayload_(payload);

  if (getOpenLeg_(trip.tripId)) {
    throw new Error("Avoin legi on jo käynnissä. Irti-kirjausta ei voi tehdä uudelleen.");
  }

  const now = new Date();
  const title = buildStatusTitle_("Irti", payload.placeName);

  const event = createEventRecord_({
    tripId: trip.tripId,
    eventTime: now,
    eventType: EVENT_TYPE.STATUS_CHANGE,
    source: EVENT_SOURCE.MANUAL,
    status: MANUAL_STATUS.DEPARTED,
    title,
    text: cleanText_(payload.text),
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: payload.accuracyM,
    speedMs: payload.speedMs,
    headingDeg: payload.headingDeg,
    matchedPlaceId: payload.placeId || ""
  });

  const leg = openLeg_({
    tripId: trip.tripId,
    startEventId: event.eventId,
    startTime: now,
    startLat: payload.latitude,
    startLon: payload.longitude
  });

  setEventLegId_(event.eventId, leg.legId);
  touchTrip_(trip.tripId);

  return {
    ok: true,
    eventId: event.eventId,
    legId: leg.legId,
    vesselStatus: VESSEL_STATUS.UNDERWAY,
    eventTime: now.toISOString()
  };
}

function addArrival(payload) {
  return addMooringEvent_(payload, MANUAL_STATUS.MOORED, "Kiinni");
}

function addAnchor(payload) {
  return addMooringEvent_(payload, MANUAL_STATUS.ANCHORED, "Ankkurissa");
}

function addNote(payload) {
  const trip = requireActiveTrip_();
  validateTextEventPayload_(payload);

  const now = new Date();
  const openLeg = getOpenLeg_(trip.tripId);

  const event = createEventRecord_({
    tripId: trip.tripId,
    legId: openLeg ? openLeg.legId : "",
    eventTime: now,
    eventType: EVENT_TYPE.NOTE,
    source: EVENT_SOURCE.MANUAL,
    title: "Oma kirjaus",
    text: cleanText_(payload.text),
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: payload.accuracyM,
    speedMs: payload.speedMs,
    headingDeg: payload.headingDeg,
    matchedPlaceId: payload.placeId || ""
  });

  touchTrip_(trip.tripId);

  return {
    ok: true,
    eventId: event.eventId,
    eventTime: now.toISOString()
  };
}

function addDisturbance(payload) {
  const trip = requireActiveTrip_();
  validateTextEventPayload_(payload);

  const now = new Date();
  const openLeg = getOpenLeg_(trip.tripId);

  const event = createEventRecord_({
    tripId: trip.tripId,
    legId: openLeg ? openLeg.legId : "",
    eventTime: now,
    eventType: EVENT_TYPE.DISTURBANCE,
    source: EVENT_SOURCE.MANUAL,
    title: "Häiriö",
    text: cleanText_(payload.text),
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: payload.accuracyM,
    speedMs: payload.speedMs,
    headingDeg: payload.headingDeg,
    matchedPlaceId: payload.placeId || ""
  });

  touchTrip_(trip.tripId);

  return {
    ok: true,
    eventId: event.eventId,
    eventTime: now.toISOString()
  };
}

function addMooringEvent_(payload, manualStatus, label) {
  const trip = requireActiveTrip_();
  validateManualEventPayload_(payload);

  const openLeg = getOpenLeg_(trip.tripId);

  if (!openLeg) {
    throw new Error(label + "-kirjausta ei voi tehdä, koska avointa legiä ei ole.");
  }

  const now = new Date();
  const title = buildStatusTitle_(label, payload.placeName);

  const event = createEventRecord_({
    tripId: trip.tripId,
    legId: openLeg.legId,
    eventTime: now,
    eventType: EVENT_TYPE.STATUS_CHANGE,
    source: EVENT_SOURCE.MANUAL,
    status: manualStatus,
    title,
    text: cleanText_(payload.text),
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: payload.accuracyM,
    speedMs: payload.speedMs,
    headingDeg: payload.headingDeg,
    matchedPlaceId: payload.placeId || ""
  });

  const leg = closeLeg_({
    legId: openLeg.legId,
    endEventId: event.eventId,
    endTime: now,
    endLat: payload.latitude,
    endLon: payload.longitude
  });

  touchTrip_(trip.tripId);

  return {
    ok: true,
    eventId: event.eventId,
    legId: leg.legId,
    vesselStatus: VESSEL_STATUS.MOORED,
    durationMin: leg.durationMin,
    eventTime: now.toISOString()
  };
}

function requireActiveTrip_() {
  const trip = getCurrentTrip();

  if (!trip) {
    throw new Error("Aktiivista matkaa ei ole.");
  }

  return trip;
}

function validateManualEventPayload_(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Tapahtuman tiedot puuttuvat.");
  }

  validateCoordinatePair_(payload.latitude, payload.longitude);
}

function validateTextEventPayload_(payload) {
  validateManualEventPayload_(payload);

  if (!cleanText_(payload.text)) {
    throw new Error("Teksti on pakollinen.");
  }
}

function buildStatusTitle_(label, placeName) {
  const place = cleanText_(placeName);
  return place ? label + " – " + place : label;
}

function cleanText_(value) {
  return String(value || "").trim();
}

function setEventLegId_(eventId, legId) {
  const sheet = getRequiredSheet_("Lokikirjaukset");
  const headers = getHeaderMap_(sheet);
  const eventIdColumn = headers.eventId + 1;
  const legIdColumn = headers.legId + 1;

  if (sheet.getLastRow() < 2) {
    throw new Error("Lokikirjausta ei löytynyt.");
  }

  const ids = sheet.getRange(2, eventIdColumn, sheet.getLastRow() - 1, 1).getDisplayValues();

  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (ids[index][0] === eventId) {
      sheet.getRange(index + 2, legIdColumn).setValue(legId);
      return;
    }
  }

  throw new Error("Lokikirjausta ei löytynyt tunnisteella: " + eventId);
}

function touchTrip_(tripId) {
  const sheet = getRequiredSheet_("Matkat");
  const headers = getHeaderMap_(sheet);

  if (sheet.getLastRow() < 2) {
    return;
  }

  const tripIdColumn = headers.tripId + 1;
  const ids = sheet.getRange(2, tripIdColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
  const now = new Date();

  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (ids[index][0] === tripId) {
      if ("dataUpdatedAt" in headers) {
        sheet.getRange(index + 2, headers.dataUpdatedAt + 1).setValue(now);
      }
      if ("updatedAt" in headers) {
        sheet.getRange(index + 2, headers.updatedAt + 1).setValue(now);
      }
      return;
    }
  }
}
