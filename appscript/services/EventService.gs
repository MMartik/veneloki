/**
 * Veneloki - EventService.gs
 *
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
