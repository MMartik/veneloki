/**
 * Veneloki - SheetUtils.gs
 *
 * Google Sheets -apufunktiot.
 */

function getRequiredSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Välilehteä ei löytynyt: " + sheetName);
  }

  return sheet;
}

function getHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {
    throw new Error("Välilehdellä ei ole otsikkoriviä: " + sheet.getName());
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const map = {};

  headers.forEach((header, index) => {
    if (header) {
      map[header] = index;
    }
  });

  return map;
}

function buildEmptyRow_(headerMap) {
  const indices = Object.values(headerMap);

  if (indices.length === 0) {
    return [];
  }

  const length = Math.max.apply(null, indices) + 1;
  return new Array(length).fill("");
}

function setRowValue_(row, headerMap, fieldName, value) {
  if (!(fieldName in headerMap)) {
    throw new Error("Tuntematon sarake: " + fieldName);
  }

  row[headerMap[fieldName]] = value === undefined ? "" : value;
}

function appendRow_(sheet, row) {
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function rowToObject_(headers, row) {
  const result = {};

  headers.forEach((header, index) => {
    if (header) {
      result[header] = row[index];
    }
  });

  return result;
}
