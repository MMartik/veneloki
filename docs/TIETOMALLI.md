# Veneloki v1.0 – tietomalli

Tämän tiedoston kentät vastaavat `appscript/DatabaseManager.gs`-tiedoston rakennetta.

## Keskeiset suhteet

- Matka (`tripId`) sisältää legit, lokikirjaukset, GPS-pisteet, kuvat ja mahdolliset tankkaukset.
- Legi alkaa `Irti`-tapahtumasta ja päättyy `Kiinni`- tai `Ankkurissa`-tapahtumaan.
- Jokainen lokikirjaus sisältää todellisen GPS-pisteen.
- Automaattikirjauksen aika on kohteessa oleskelun ajallinen keskipiste.
- Automaattikirjauksen sijainti on veneen todellinen GPS-piste kyseisenä keskihetkenä.
- Raportit muodostetaan aina uudelleen raakadatasta.
