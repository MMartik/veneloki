/**
 * Veneloki - LegService.gs
 *
 * Legi alkaa Irti-tapahtumasta ja päättyy Kiinni- tai Ankkurissa-tapahtumaan.
 */

function openLeg_(data) {
  const sheet = getRequiredSheet_("Legit");
  const headers = getHeaderMap_(sheet);
  const now = new Date();
  const legId = createId_("leg");
  const legNumber = getNextLegNumber_(data.tripId);
  const row = buildEmptyRow_(headers);

  setRowValue_(row, headers, "legId", legId);
  setRowValue_(row, headers, "tripId", data.tripId);
  setRowValue_(row, headers, "legNumber", legNumber);
  setRowValue_(row, headers, "startEventId", data.startEventId);
  setRowValue_(row, headers, "startTime", data.startTime);
  setRowValue_(row, headers, "startLat", nullableNumber_(data.startLat));
  setRowValue_(row, headers, "startLon", nullableNumber_(data.startLon));
  setRowValue_(row, headers, "createdAt", now);
  setRowValue_(row, headers, "updatedAt", now);

  appendRow_(sheet, row);

  return {
    legId,
    tripId: data.tripId,
    legNumber
  };
}

function closeLeg_(data) {
  const sheet = getRequiredSheet_("Legit");
  const headers = getHeaderMap_(sheet);
  const leg = findLegById_(data.legId);

  if (!leg) {
    throw new Error("Legiä ei löytynyt: " + data.legId);
  }

  if (leg.endTime) {
    throw new Error("Legi on jo päätetty.");
  }

  const endTime = data.endTime || new Date();
  const startTime = new Date(leg.startTime);
  const durationMin = Math.max(0, (endTime.getTime() - startTime.getTime()) / 60000);
  const row = sheet.getRange(leg.__rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];

  setRowValue_(row, headers, "endEventId", data.endEventId);
  setRowValue_(row, headers, "endTime", endTime);
  setRowValue_(row, headers, "endLat", nullableNumber_(data.endLat));
  setRowValue_(row, headers, "endLon", nullableNumber_(data.endLon));
  setRowValue_(row, headers, "durationMin", durationMin);
  setRowValue_(row, headers, "updatedAt", new Date());

  sheet.getRange(leg.__rowNumber, 1, 1, row.length).setValues([row]);

  return {
    legId: leg.legId,
    tripId: leg.tripId,
    durationMin
  };
}

function getOpenLeg_(tripId) {
  const sheet = getRequiredSheet_("Legit");

  if (sheet.getLastRow() < 2) {
    return null;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const leg = rowToObject_(headers, rows[index]);

    if (leg.tripId === tripId && !leg.endTime) {
      leg.__rowNumber = index + 2;
      return leg;
    }
  }

  return null;
}

function findLegById_(legId) {
  const sheet = getRequiredSheet_("Legit");

  if (sheet.getLastRow() < 2) {
    return null;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const leg = rowToObject_(headers, rows[index]);

    if (leg.legId === legId) {
      leg.__rowNumber = index + 2;
      return leg;
    }
  }

  return null;
}

function getNextLegNumber_(tripId) {
  const sheet = getRequiredSheet_("Legit");

  if (sheet.getLastRow() < 2) {
    return 1;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  let maximum = 0;

  rows.forEach(row => {
    const leg = rowToObject_(headers, row);

    if (leg.tripId === tripId) {
      maximum = Math.max(maximum, Number(leg.legNumber || 0));
    }
  });

  return maximum + 1;
}
