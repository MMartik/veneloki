/**
 * Veneloki - EventServiceTests.gs
 *
 * Testaa tapahtumat aktiivisella matkalla.
 * Aloita ensin uusi testimatka, jos aktiivista matkaa ei ole.
 */

function testEventFlow() {
  if (!isTripActive()) {
    startTrip({
      crew: "Testimiehistö",
      startNotes: "EventService-testimatka",
      latitude: 61.0581,
      longitude: 28.3082,
      accuracyM: 8
    });
  }

  const departure = addDeparture({
    latitude: 61.0581,
    longitude: 28.3082,
    accuracyM: 8,
    placeId: "test_home",
    placeName: "Testilaituri",
    text: "Lähdetään testiajolle."
  });
  Logger.log("Irti: " + JSON.stringify(departure, null, 2));

  const note = addNote({
    latitude: 61.0600,
    longitude: 28.3150,
    accuracyM: 7,
    text: "Testin oma kirjaus."
  });
  Logger.log("Oma kirjaus: " + JSON.stringify(note, null, 2));

  const disturbance = addDisturbance({
    latitude: 61.0610,
    longitude: 28.3200,
    accuracyM: 9,
    text: "Testihäiriö."
  });
  Logger.log("Häiriö: " + JSON.stringify(disturbance, null, 2));

  const arrival = addArrival({
    latitude: 61.0650,
    longitude: 28.3250,
    accuracyM: 6,
    placeId: "test_destination",
    placeName: "Testisatama",
    text: "Kiinnityttiin testisatamaan."
  });
  Logger.log("Kiinni: " + JSON.stringify(arrival, null, 2));
}

function testSecondLegWithAnchor() {
  if (!isTripActive()) {
    throw new Error("Aloita ensin aktiivinen matka.");
  }

  const departure = addDeparture({
    latitude: 61.0650,
    longitude: 28.3250,
    accuracyM: 6,
    placeName: "Testisatama"
  });
  Logger.log("Irti: " + JSON.stringify(departure, null, 2));

  const anchor = addAnchor({
    latitude: 61.0700,
    longitude: 28.3400,
    accuracyM: 7,
    placeName: "Testilahti",
    text: "Ankkuriin."
  });
  Logger.log("Ankkurissa: " + JSON.stringify(anchor, null, 2));
}
