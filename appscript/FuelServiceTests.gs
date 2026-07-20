/**
 * Veneloki - FuelServiceTests.gs
 */

function testFuelDuringActiveTrip() {
  if (!isTripActive()) {
    startTrip({
      crew: "Tankkaustesti",
      startNotes: "FuelService aktiivisen matkan testi",
      latitude: 61.0581,
      longitude: 28.3082,
      accuracyM: 8
    });
  }

  const result = addFuelEntry({
    litres: 82.4,
    priceTotal: 162.80,
    engineHours: 445.6,
    fillType: FILL_TYPE.FULL,
    latitude: 61.0581,
    longitude: 28.3082,
    accuracyM: 7,
    placeId: "test_fuel_station",
    placeName: "Testisatama",
    notes: "Aktiivisen matkan tankkaustesti"
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function testFuelWithoutActiveTrip() {
  if (isTripActive()) {
    endTrip({
      endNotes: "Päätetään matka ennen matkan ulkopuolista tankkaustestiä.",
      latitude: 61.0581,
      longitude: 28.3082,
      accuracyM: 7
    });
  }

  const result = addFuelEntry({
    litres: 40.0,
    priceTotal: 79.60,
    engineHours: 446.2,
    fillType: FILL_TYPE.PARTIAL,
    latitude: 61.0600,
    longitude: 28.3100,
    accuracyM: 9,
    placeName: "Testilaituri",
    notes: "Osatankkaus ilman aktiivista matkaa"
  });

  Logger.log(JSON.stringify(result, null, 2));
}
