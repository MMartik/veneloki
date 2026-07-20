/**
 * Veneloki - DatabaseManager.gs
 *
 * Luo Google Sheets -tietokannan tyhjään tai testikäyttöön tarkoitettuun taulukkoon.
 *
 * VAROITUS:
 * initializeDatabase() poistaa kaikki nykyiset välilehdet ja niiden tiedot.
 * Käytä sitä vain tyhjään tai tarkoituksella nollattavaan taulukkoon.
 */

const DATABASE_VERSION = "1.0.0";

const DATABASE_SCHEMA = Object.freeze({
  "Matkat": [
    "tripId",
    "status",
    "startTime",
    "endTime",
    "crew",
    "startNotes",
    "endNotes",
    "startLat",
    "startLon",
    "endLat",
    "endLon",
    "distanceKm",
    "totalDurationMin",
    "drivingDurationMin",
    "engineHoursStart",
    "engineHoursEnd",
    "pdfFileId",
    "pdfUrl",
    "pdfGeneratedAt",
    "dataUpdatedAt",
    "createdAt",
    "updatedAt"
  ],

  "Legit": [
    "legId",
    "tripId",
    "legNumber",
    "startEventId",
    "endEventId",
    "startTime",
    "endTime",
    "startLat",
    "startLon",
    "endLat",
    "endLon",
    "distanceKm",
    "durationMin",
    "createdAt",
    "updatedAt"
  ],

  "Lokikirjaukset": [
    "eventId",
    "tripId",
    "legId",
    "eventTime",
    "eventType",
    "source",
    "status",
    "title",
    "text",
    "latitude",
    "longitude",
    "accuracyM",
    "speedMs",
    "headingDeg",
    "automaticEnteredAt",
    "automaticExitedAt",
    "matchedPlaceId",
    "photoCount",
    "isDeleted",
    "createdAt",
    "updatedAt"
  ],

  "GPS-pisteet": [
    "pointId",
    "tripId",
    "recordedAt",
    "latitude",
    "longitude",
    "accuracyM",
    "speedMs",
    "headingDeg",
    "altitudeM",
    "batchId",
    "createdAt"
  ],

  "Paikat": [
    "placeId",
    "internalName",
    "displayName",
    "placeType",
    "geometryType",
    "geometryJson",
    "radiusM",
    "autoLog",
    "oncePerVisit",
    "minimumStaySeconds",
    "enabled",
    "createdAt",
    "updatedAt"
  ],

  "Tankkaukset": [
    "fuelId",
    "tripId",
    "eventId",
    "fuelTime",
    "latitude",
    "longitude",
    "litres",
    "priceTotal",
    "pricePerLitre",
    "engineHours",
    "fillType",
    "notes",
    "createdAt",
    "updatedAt"
  ],

  "Vene": [
    "boatEventId",
    "eventTime",
    "eventType",
    "value",
    "unit",
    "notes",
    "createdAt",
    "updatedAt"
  ],

  "Kuvat": [
    "photoId",
    "tripId",
    "eventId",
    "driveFileId",
    "driveUrl",
    "fileName",
    "mimeType",
    "capturedAt",
    "latitude",
    "longitude",
    "caption",
    "createdAt",
    "updatedAt"
  ],

  "Raportit": [
    "reportId",
    "reportType",
    "tripId",
    "reportYear",
    "driveFileId",
    "driveUrl",
    "fileName",
    "generatedAt",
    "sourceUpdatedAt",
    "status",
    "createdAt",
    "updatedAt"
  ],

  "Synkronointipaketit": [
    "batchId",
    "batchType",
    "receivedAt",
    "itemCount",
    "status",
    "errorMessage"
  ],

  "Asetukset": [
    "key",
    "value",
    "description",
    "updatedAt"
  ]
});

const DEFAULT_SETTINGS = Object.freeze([
  ["databaseVersion", DATABASE_VERSION, "Tietokantarakenteen versio"],
  ["timezone", "Europe/Helsinki", "Aikavyöhyke"],
  ["boatName", "", "Veneen nimi"],
  ["homePort", "", "Kotisatama"],
  ["reportFolderId", "", "Google Drive -raporttikansion ID"],
  ["photoFolderId", "", "Google Drive -kuvakansion ID"],
  ["reportTemplateId", "", "Google Docs -matkaraporttipohjan ID"],
  ["annualReportTemplateId", "", "Google Docs -vuosiraporttipohjan ID"]
]);

/**
 * Tyhjentää nykyisen tiedoston ja luo Venelokin tietokantarakenteen.
 *
 * VAROITUS: poistaa kaikki nykyiset välilehdet.
 */
function initializeDatabase() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("Aktiivista Google Sheets -tiedostoa ei löytynyt.");
  }

  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    "Alusta Veneloki-tietokanta",
    "Tämä poistaa kaikki nykyiset välilehdet ja niiden tiedot. Jatketaanko?",
    ui.ButtonSet.YES_NO
  );

  if (answer !== ui.Button.YES) {
    ui.alert("Alustus peruutettiin.");
    return;
  }

  const temporarySheetName = "__VENELOKI_TEMP__";
  let temporarySheet = spreadsheet.getSheetByName(temporarySheetName);

  if (!temporarySheet) {
    temporarySheet = spreadsheet.insertSheet(temporarySheetName);
  }

  spreadsheet.getSheets().forEach(sheet => {
    if (sheet.getName() !== temporarySheetName) {
      spreadsheet.deleteSheet(sheet);
    }
  });

  Object.entries(DATABASE_SCHEMA).forEach(([sheetName, headers]) => {
    const sheet = spreadsheet.insertSheet(sheetName);
    setupSheet_(sheet, headers);
  });

  writeDefaultSettings_(spreadsheet.getSheetByName("Asetukset"));

  spreadsheet.deleteSheet(temporarySheet);
  spreadsheet.setActiveSheet(spreadsheet.getSheetByName("Matkat"));
  SpreadsheetApp.flush();

  ui.alert(
    "Valmis",
    "Venelokin tietokanta alustettiin versioon " + DATABASE_VERSION + ".",
    ui.ButtonSet.OK
  );
}

/**
 * Tarkistaa, että kaikki välilehdet ja otsikot ovat oikein.
 */
function verifyDatabase() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const problems = [];

  Object.entries(DATABASE_SCHEMA).forEach(([sheetName, expectedHeaders]) => {
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      problems.push("Puuttuva välilehti: " + sheetName);
      return;
    }

    const actualHeaders = sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .getDisplayValues()[0];

    expectedHeaders.forEach((header, index) => {
      if (actualHeaders[index] !== header) {
        problems.push(
          sheetName +
          ": sarakkeen " +
          (index + 1) +
          " pitäisi olla '" +
          header +
          "', mutta se on '" +
          actualHeaders[index] +
          "'."
        );
      }
    });
  });

  const result = {
    ok: problems.length === 0,
    version: DATABASE_VERSION,
    problems
  };

  Logger.log(JSON.stringify(result, null, 2));

  SpreadsheetApp.getUi().alert(
    result.ok ? "Tietokanta kunnossa" : "Tietokannassa havaittiin ongelmia",
    result.ok
      ? "Kaikki välilehdet ja otsikot ovat oikein."
      : problems.join("\n"),
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return result;
}

/**
 * Palauttaa tietokantaversion.
 */
function getDatabaseVersion() {
  return DATABASE_VERSION;
}

function setupSheet_(sheet, headers) {
  const requiredColumns = headers.length;

  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumns - sheet.getMaxColumns()
    );
  }

  const headerRange = sheet.getRange(1, 1, 1, requiredColumns);
  headerRange
    .setValues([headers])
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#1f2937")
    .setHorizontalAlignment("left");

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }

  sheet.getRange(1, 1, sheet.getMaxRows(), requiredColumns).createFilter();
  sheet.autoResizeColumns(1, requiredColumns);

  for (let column = 1; column <= requiredColumns; column += 1) {
    const currentWidth = sheet.getColumnWidth(column);
    sheet.setColumnWidth(column, Math.max(currentWidth, 110));
  }
}

function writeDefaultSettings_(sheet) {
  if (!sheet) {
    throw new Error("Asetukset-välilehteä ei löytynyt.");
  }

  const now = new Date();
  const rows = DEFAULT_SETTINGS.map(setting => [
    setting[0],
    setting[1],
    setting[2],
    now
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }
}
