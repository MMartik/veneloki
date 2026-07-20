/**
 * Veneloki - EngineHourServiceTests.gs
 */

function testAddActualEngineHours() {
  const result = addActualEngineHours({
    hours: 500.0,
    notes: "Konetuntipalvelun testilukema"
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function testGetEstimatedEngineHours() {
  const result = getEstimatedEngineHours();
  Logger.log(JSON.stringify(result, null, 2));
}

function testFuelWithSuggestedEngineHours() {
  const result = addFuelEntry({
    litres: 50.0,
    priceTotal: 100.0,
    fillType: FILL_TYPE.PARTIAL,
    latitude: 61.0581,
    longitude: 28.3082,
    accuracyM: 8,
    placeName: "Konetuntitestin tankkaus",
    notes: "Konetunteja ei syötetty käsin."
  });

  Logger.log(JSON.stringify(result, null, 2));
}
