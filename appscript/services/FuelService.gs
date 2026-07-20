/**
 * Veneloki - FuelService.gs
 *
 * Tankkausten käsittely.
 * Jos konetunteja ei syötetä, käytetään laskennallista arviota,
 * jos todellinen lähtölukema on olemassa.
 */

function addFuelEntry(payload) {
  validateFuelPayload_(payload);

  const now = payload.fuelTime
    ? new Date(payload.fuelTime)
    : new Date();

  if (Number.isNaN(now.getTime())) {
    throw new Error("Virheellinen tankkauksen päivämäärä tai aika.");
  }

  const fuelId = createId_("fuel");
  const activeTrip = getCurrentTrip();
  const tripId = activeTrip ? activeTrip.tripId : "";
  const litres = Number(payload.litres);
  const priceTotal = Number(payload.priceTotal);
  const pricePerLitre = calculatePricePerLitre_(litres, priceTotal);
  const fillType = normalizeFillType_(payload.fillType);
  const placeName = cleanFuelText_(payload.placeName);
  const notes = cleanFuelText_(payload.notes);
  const engineHours = resolveFuelEngineHours_(payload.engineHours, now);

  let eventId = "";

  if (activeTrip) {
    const openLeg = getOpenLeg_(activeTrip.tripId);
    const event = createEventRecord_({
      tripId: activeTrip.tripId,
      legId: openLeg ? openLeg.legId : "",
      eventTime: now,
      eventType: EVENT_TYPE.FUEL,
      source: EVENT_SOURCE.MANUAL,
      title: buildFuelEventTitle_(placeName),
      text: buildFuelEventText_({
        litres,
        priceTotal,
        pricePerLitre,
        engineHours,
        fillType,
        notes
      }),
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracyM: payload.accuracyM,
      speedMs: payload.speedMs,
      headingDeg: payload.headingDeg,
      matchedPlaceId: payload.placeId || ""
    });

    eventId = event.eventId;
    touchTrip_(activeTrip.tripId);
  }

  saveFuelRow_({
    fuelId,
    tripId,
    eventId,
    fuelTime: now,
    latitude: payload.latitude,
    longitude: payload.longitude,
    litres,
    priceTotal,
    pricePerLitre,
    engineHours,
    fillType,
    notes
  });

  saveBoatFuelEvent_({
    fuelId,
    fuelTime: now,
    litres,
    priceTotal,
    pricePerLitre,
    engineHours,
    fillType,
    placeName,
    notes
  });

  return {
    ok: true,
    fuelId,
    tripId,
    eventId,
    fuelTime: now.toISOString(),
    litres,
    priceTotal,
    pricePerLitre,
    engineHours,
    fillType
  };
}

function resolveFuelEngineHours_(providedHours, fuelTime) {
  if (
    providedHours !== null &&
    providedHours !== undefined &&
    providedHours !== ""
  ) {
    return Number(providedHours);
  }

  const suggested = getSuggestedEngineHours(fuelTime);
  return suggested === null ? "" : suggested;
}

function saveFuelRow_(data) {
  const sheet = getRequiredSheet_("Tankkaukset");
  const headers = getHeaderMap_(sheet);
  const now = new Date();
  const row = buildEmptyRow_(headers);

  setRowValue_(row, headers, "fuelId", data.fuelId);
  setRowValue_(row, headers, "tripId", data.tripId || "");
  setRowValue_(row, headers, "eventId", data.eventId || "");
  setRowValue_(row, headers, "fuelTime", data.fuelTime);
  setRowValue_(row, headers, "latitude", nullableNumber_(data.latitude));
  setRowValue_(row, headers, "longitude", nullableNumber_(data.longitude));
  setRowValue_(row, headers, "litres", data.litres);
  setRowValue_(row, headers, "priceTotal", data.priceTotal);
  setRowValue_(row, headers, "pricePerLitre", data.pricePerLitre);
  setRowValue_(row, headers, "engineHours", nullableNumber_(data.engineHours));
  setRowValue_(row, headers, "fillType", data.fillType);
  setRowValue_(row, headers, "notes", data.notes || "");
  setRowValue_(row, headers, "createdAt", now);
  setRowValue_(row, headers, "updatedAt", now);

  appendRow_(sheet, row);
}

function saveBoatFuelEvent_(data) {
  const sheet = getRequiredSheet_("Vene");
  const headers = getHeaderMap_(sheet);
  const now = new Date();
  const row = buildEmptyRow_(headers);

  const details = [
    data.placeName ? "Paikka: " + data.placeName : "",
    "Litrat: " + formatFuelNumber_(data.litres, 2) + " l",
    "Hinta: " + formatFuelNumber_(data.priceTotal, 2) + " €",
    "Litrahinta: " + formatFuelNumber_(data.pricePerLitre, 3) + " €/l",
    data.engineHours !== ""
      ? "Konetunnit: " + formatFuelNumber_(Number(data.engineHours), 1) + " h"
      : "",
    "Tyyppi: " + (data.fillType === FILL_TYPE.FULL ? "Täyteen" : "Osatankkaus"),
    data.notes || ""
  ].filter(Boolean);

  setRowValue_(row, headers, "boatEventId", createId_("boat"));
  setRowValue_(row, headers, "eventTime", data.fuelTime);
  setRowValue_(row, headers, "eventType", "fuel");
  setRowValue_(row, headers, "value", data.litres);
  setRowValue_(row, headers, "unit", "l");
  setRowValue_(row, headers, "notes", details.join("\n"));
  setRowValue_(row, headers, "createdAt", now);
  setRowValue_(row, headers, "updatedAt", now);

  appendRow_(sheet, row);
}

function validateFuelPayload_(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Tankkauksen tiedot puuttuvat.");
  }

  const litres = Number(payload.litres);
  const priceTotal = Number(payload.priceTotal);

  if (!Number.isFinite(litres) || litres <= 0) {
    throw new Error("Litramäärän pitää olla positiivinen numero.");
  }

  if (!Number.isFinite(priceTotal) || priceTotal < 0) {
    throw new Error("Kokonaishinnan pitää olla vähintään 0 euroa.");
  }

  normalizeFillType_(payload.fillType);
  validateCoordinatePair_(payload.latitude, payload.longitude);

  if (
    payload.engineHours !== null &&
    payload.engineHours !== undefined &&
    payload.engineHours !== ""
  ) {
    const engineHours = Number(payload.engineHours);

    if (!Number.isFinite(engineHours) || engineHours < 0) {
      throw new Error("Konetuntien pitää olla vähintään 0.");
    }
  }
}

function normalizeFillType_(value) {
  if (value === FILL_TYPE.FULL || value === FILL_TYPE.PARTIAL) {
    return value;
  }

  throw new Error(
    "Tankkaustyypin pitää olla '" +
    FILL_TYPE.FULL +
    "' tai '" +
    FILL_TYPE.PARTIAL +
    "'."
  );
}

function calculatePricePerLitre_(litres, priceTotal) {
  if (litres <= 0) {
    throw new Error("Litrahintaa ei voi laskea ilman litramäärää.");
  }

  return priceTotal / litres;
}

function buildFuelEventTitle_(placeName) {
  return placeName ? "Tankkaus – " + placeName : "Tankkaus";
}

function buildFuelEventText_(data) {
  const lines = [
    formatFuelNumber_(data.litres, 2) + " l",
    formatFuelNumber_(data.priceTotal, 2) + " €",
    formatFuelNumber_(data.pricePerLitre, 3) + " €/l"
  ];

  if (data.engineHours !== "") {
    lines.push(
      "Konetunnit: " +
      formatFuelNumber_(Number(data.engineHours), 1) +
      " h"
    );
  }

  lines.push(
    data.fillType === FILL_TYPE.FULL
      ? "Tankki täyteen"
      : "Osatankkaus"
  );

  if (data.notes) {
    lines.push(data.notes);
  }

  return lines.join("\n");
}

function cleanFuelText_(value) {
  return String(value || "").trim();
}

function formatFuelNumber_(value, decimals) {
  return Number(value).toFixed(decimals).replace(".", ",");
}
