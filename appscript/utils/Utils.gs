/**
 * Veneloki - Utils.gs
 *
 * Yleiset apufunktiot.
 */

function createId_(prefix) {
  return prefix + "_" + Utilities.getUuid();
}

function nullableNumber_(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error("Virheellinen numeroarvo: " + value);
  }

  return number;
}

function validateCoordinatePair_(latitude, longitude) {
  const latMissing = latitude === null || latitude === undefined || latitude === "";
  const lonMissing = longitude === null || longitude === undefined || longitude === "";

  if (latMissing && lonMissing) {
    return;
  }

  if (latMissing || lonMissing) {
    throw new Error("Sekä leveys- että pituusaste tarvitaan.");
  }

  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Virheellinen leveysaste.");
  }

  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error("Virheellinen pituusaste.");
  }
}
