/**
 * Veneloki - TripServiceTests.gs
 *
 * Manuaaliset testifunktiot Apps Script -editoriin.
 */

function testStartTrip() {
  const result = startTrip({
    crew: "Testimiehistö",
    startNotes: "TripService testimatka",
    latitude: 61.0581,
    longitude: 28.3082,
    accuracyM: 8,
    engineHours: 100.0
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function testGetCurrentTrip() {
  const result = getCurrentTrip();
  Logger.log(JSON.stringify(result, null, 2));
}

function testEndTrip() {
  const result = endTrip({
    endNotes: "Testimatka päätetty",
    latitude: 61.0600,
    longitude: 28.3100,
    accuracyM: 7,
    engineHours: 100.5
  });

  Logger.log(JSON.stringify(result, null, 2));
}
