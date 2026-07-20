/**
 * Veneloki - EngineHourService.gs
 *
 * Konetuntien käsittely:
 * - todellisen mittarilukeman tallennus
 * - viimeisimmän todellisen lukeman haku
 * - nykyisen laskennallisen lukeman muodostus
 *
 * Laskenta:
 * viimeisin todellinen lukema
 * + sen jälkeen päättyneiden legien ajoajat
 */

const BOAT_EVENT_TYPE_ENGINE_HOURS_ACTUAL = "engine_hours_actual";

function addActualEngineHours(payload) {
  validateActualEngineHoursPayload_(payload);

  const eventTime = payload.eventTime
    ? new Date(payload.eventTime)
    : new Date();

  if (Number.isNaN(eventTime.getTime())) {
    throw new Error("Virheellinen konetuntien päivämäärä tai aika.");
  }

  const hours = Number(payload.hours);
  const notes = String(payload.notes || "").trim();
  const sheet = getRequiredSheet_("Vene");
  const headers = getHeaderMap_(sheet);
  const now = new Date();
  const boatEventId = createId_("boat");
  const row = buildEmptyRow_(headers);

  setRowValue_(row, headers, "boatEventId", boatEventId);
  setRowValue_(row, headers, "eventTime", eventTime);
  setRowValue_(row, headers, "eventType", BOAT_EVENT_TYPE_ENGINE_HOURS_ACTUAL);
  setRowValue_(row, headers, "value", hours);
  setRowValue_(row, headers, "unit", "h");
  setRowValue_(row, headers, "notes", notes);
  setRowValue_(row, headers, "createdAt", now);
  setRowValue_(row, headers, "updatedAt", now);

  appendRow_(sheet, row);

  return {
    ok: true,
    boatEventId,
    eventTime: eventTime.toISOString(),
    hours
  };
}

function getLatestActualEngineHours() {
  const sheet = getRequiredSheet_("Vene");

  if (sheet.getLastRow() < 2) {
    return null;
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];

  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues();

  let latest = null;

  rows.forEach((row, index) => {
    const event = rowToObject_(headers, row);

    if (event.eventType !== BOAT_EVENT_TYPE_ENGINE_HOURS_ACTUAL) {
      return;
    }

    const eventTime = new Date(event.eventTime);
    const hours = Number(event.value);

    if (Number.isNaN(eventTime.getTime()) || !Number.isFinite(hours)) {
      return;
    }

    if (!latest || eventTime.getTime() > latest.eventTime.getTime()) {
      latest = {
        boatEventId: event.boatEventId,
        eventTime,
        hours,
        notes: event.notes || "",
        __rowNumber: index + 2
      };
    }
  });

  return latest;
}

function getEstimatedEngineHours(referenceTime) {
  const latestActual = getLatestActualEngineHours();

  if (!latestActual) {
    return {
      ok: true,
      available: false,
      estimatedHours: null,
      actualHours: null,
      actualAt: null,
      accumulatedDrivingHours: 0
    };
  }

  const until = referenceTime ? new Date(referenceTime) : new Date();

  if (Number.isNaN(until.getTime())) {
    throw new Error("Virheellinen konetuntiarvion ajankohta.");
  }

  const accumulatedDrivingHours = calculateLegHoursBetween_(
    latestActual.eventTime,
    until
  );

  return {
    ok: true,
    available: true,
    estimatedHours: latestActual.hours + accumulatedDrivingHours,
    actualHours: latestActual.hours,
    actualAt: latestActual.eventTime.toISOString(),
    accumulatedDrivingHours
  };
}

function getSuggestedEngineHours(referenceTime) {
  const estimate = getEstimatedEngineHours(referenceTime);
  return estimate.available ? estimate.estimatedHours : null;
}

function calculateLegHoursBetween_(startTime, endTime) {
  const sheet = getRequiredSheet_("Legit");

  if (sheet.getLastRow() < 2) {
    return 0;
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];

  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues();

  let minutes = 0;

  rows.forEach(row => {
    const leg = rowToObject_(headers, row);

    if (!leg.startTime || !leg.endTime) {
      return;
    }

    const legStart = new Date(leg.startTime);
    const legEnd = new Date(leg.endTime);

    if (
      Number.isNaN(legStart.getTime()) ||
      Number.isNaN(legEnd.getTime())
    ) {
      return;
    }

    const overlapStart = Math.max(legStart.getTime(), startTime.getTime());
    const overlapEnd = Math.min(legEnd.getTime(), endTime.getTime());

    if (overlapEnd > overlapStart) {
      minutes += (overlapEnd - overlapStart) / 60000;
    }
  });

  return minutes / 60;
}

function validateActualEngineHoursPayload_(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Konetuntien tiedot puuttuvat.");
  }

  const hours = Number(payload.hours);

  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("Konetuntien pitää olla vähintään 0.");
  }
}
