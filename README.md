# Veneloki

Offline-toimiva iPad-venepäiväkirja ja tietokoneen hallintakäyttöliittymä.

## Rakenne

- `app/` – iPadin PWA-käyttöliittymä
- `admin/` – tietokoneen hallintakäyttöliittymä
- `appscript/` – Google Apps Script -taustapalvelu
- `docs/` – määrittelyt ja tietomalli

## Turvallisuus

GitHubiin ei tallenneta Google Sheetin tunnisteita, Drive-kansioiden tunnisteita, API-avaimia, GPS-tietoja, kuvia tai PDF-raportteja. Salaisuudet säilytetään Apps Scriptin Script Properties -asetuksissa.

## Ensimmäinen vaihe

1. Kopioi tämän paketin sisältö paikalliseen `veneloki`-repositoryyn.
2. Tee commit: `Initial project structure`.
3. Lisää `appscript/DatabaseManager.gs` Apps Script -projektiin.
4. Suorita `initializeDatabase()`.
