
(() => {
  const state = VenelokiStorage.getDemoState();
  let activeView = "log";

  const elements = {
    tabs: document.querySelectorAll(".tab-button"),
    views: document.querySelectorAll(".view"),
    vesselState: document.getElementById("vesselState"),
    tripMeta: document.getElementById("tripMeta"),
    startTripButton: document.getElementById("startTripButton"),
    activeTripControls: document.getElementById("activeTripControls"),
    logList: document.getElementById("logList"),
    boatEventList: document.getElementById("boatEventList"),
    engineHoursValue: document.getElementById("engineHoursValue"),
    settingsForm: document.getElementById("settingsForm"),
    apiUrlInput: document.getElementById("apiUrlInput"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    dialog: document.getElementById("formDialog"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogFields: document.getElementById("dialogFields"),
    dialogForm: document.getElementById("dialogForm")
  };

  function save() {
    VenelokiStorage.saveDemoState(state);
    render();
  }

  function switchView(viewName) {
    activeView = viewName;
    elements.tabs.forEach(button => button.classList.toggle("active", button.dataset.view === viewName));
    elements.views.forEach(view => view.classList.toggle("active", view.id === `view-${viewName}`));
  }

  function eventColor(type) {
    return {
      departed: "#22c55e",
      moored: "#22c55e",
      anchored: "#22c55e",
      note: "#3b82f6",
      disturbance: "#ef4444",
      fuel: "#f8fafc",
      automatic_place: "#f59e0b",
      trip_start: "#94a3b8",
      trip_end: "#94a3b8"
    }[type] || "#94a3b8";
  }

  function renderLog() {
    if (!state.log.length) {
      elements.logList.innerHTML = '<div class="empty-state">Ei kirjauksia.</div>';
      return;
    }

    elements.logList.innerHTML = [...state.log].reverse().map(item => `
      <div class="log-item" data-id="${item.id}">
        <div class="log-row">
          <span class="log-dot" style="background:${eventColor(item.type)}"></span>
          <span class="log-time">${item.time}</span>
          <span class="log-title">${escapeHtml(item.title)}</span>
          <span>${item.hasPhoto ? "📷" : ""}</span>
        </div>
        <div class="log-details">${escapeHtml(item.details || "")}</div>
      </div>
    `).join("");

    elements.logList.querySelectorAll(".log-item").forEach(item => {
      item.addEventListener("click", () => item.classList.toggle("expanded"));
    });
  }

  function renderBoatEvents() {
    const events = [...state.boatEvents].reverse().slice(0, 5);
    if (!events.length) {
      elements.boatEventList.innerHTML = '<div class="empty-state">Ei tapahtumia.</div>';
      return;
    }

    elements.boatEventList.innerHTML = events.map(item => `
      <div class="log-item">
        <div class="log-row">
          <span class="log-dot" style="background:${eventColor(item.type)}"></span>
          <span class="log-time">${item.date}</span>
          <span class="log-title">${escapeHtml(item.title)}</span>
          <span></span>
        </div>
        <div class="log-details">${escapeHtml(item.details || "")}</div>
      </div>
    `).join("");

    elements.boatEventList.querySelectorAll(".log-item").forEach(item => {
      item.addEventListener("click", () => item.classList.toggle("expanded"));
    });
  }

  function render() {
    const trip = state.activeTrip;
    elements.startTripButton.classList.toggle("hidden", Boolean(trip));
    elements.activeTripControls.classList.toggle("hidden", !trip);

    if (trip) {
      elements.vesselState.textContent = trip.vesselStatus === "underway" ? "MATKALLA" : "KIINNITTYNEENÄ";
      elements.tripMeta.textContent = trip.lastStatusAt || trip.startedAt;
    } else {
      elements.vesselState.textContent = "EI AKTIIVISTA MATKAA";
      elements.tripMeta.textContent = "Aloita uusi matka.";
    }

    elements.engineHoursValue.textContent = state.engineHours === null ? "–" : `${Number(state.engineHours).toFixed(1).replace(".", ",")} h`;
    renderLog();
    
    const underway = trip && trip.vesselStatus==="underway";
    const ids=["departureButton","arrivalButton","anchorButton"];
    ids.forEach(id=>{const b=document.getElementById(id); if(!b)return; b.disabled=false;});
    if(trip){
      document.getElementById("departureButton").disabled=underway;
      document.getElementById("arrivalButton").disabled=!underway;
      document.getElementById("anchorButton").disabled=!underway;
    }

renderBoatEvents();
  }

  function addLog(type, title, details = "") {
    const now = new Date();
    state.log.push({
      id: crypto.randomUUID(),
      type,
      title,
      details,
      time: now.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" }),
      timestamp: now.toISOString(),
      hasPhoto: false
    });
  }

  function openForm(title, fields, onSubmit) {
    elements.dialogTitle.textContent = title;
    elements.dialogFields.innerHTML = fields;
    elements.dialog.showModal();
    requestAnimationFrame(()=>{elements.dialog.scrollTop=0;});

    elements.dialogForm.onsubmit = event => {
      event.preventDefault();
      const formData = new FormData(elements.dialogForm);
      onSubmit(Object.fromEntries(formData.entries()));
      elements.dialog.close();
    };
  }

  function startTrip() {
    openForm("Aloita matka", `
      <label>Miehistö<input name="crew" required></label>
      <label>Lisätiedot<textarea name="notes"></textarea></label>
    `, values => {
      const now = new Date();
      state.activeTrip = {
        id: crypto.randomUUID(),
        crew: values.crew,
        notes: values.notes,
        startedAt: now.toLocaleString("fi-FI"),
        vesselStatus: "moored",
        lastStatusAt: now.toLocaleDateString("fi-FI",{day:"2-digit",month:"2-digit"})+" "+now.toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"})
      };
      state.log = [];
      addLog("trip_start", "Matka aloitettu", `Miehistö: ${values.crew}${values.notes ? "\n" + values.notes : ""}`);
      save();
    });
  }

  function statusEvent(type, label, vesselStatus) {
    if (!state.activeTrip) return;
    openForm(label, `
      <label>Paikka tai lisätieto, vapaaehtoinen<input name="place"></label>
      <label>Lisätieto, vapaaehtoinen<textarea name="text"></textarea></label>
    `, values => {
      const title = values.place ? `${label} – ${values.place}` : label;
      addLog(type, title, values.text);
      state.activeTrip.vesselStatus = vesselStatus;
      state.activeTrip.lastStatusAt = new Date().toLocaleDateString("fi-FI",{day:"2-digit",month:"2-digit"})+" "+new Date().toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"});
      save();
    });
  }

  function textEvent(type, title) {
    if (!state.activeTrip) return;
    openForm(title, `<label>Teksti<textarea name="text" required></textarea></label>`, values => {
      addLog(type, title, values.text);
      save();
    });
  }

  function endTrip() {
    if (!state.activeTrip) return;
    openForm("Päätä matka", `<label>Loppuhuomautus<textarea name="notes"></textarea></label>`, values => {
      addLog("trip_end", "Matka päätetty", values.notes);
      state.activeTrip = null;
      save();
    });
  }

  function newFuel() {
    openForm("Uusi tankkaus", `
      <label>Paikka<input name="place"></label>
      <label>Litrat<input name="litres" type="number" min="0" step="0.01" required></label>
      <label>Hinta yhteensä €<input name="price" type="number" min="0" step="0.01" required></label>
      <label>Konetunnit<input name="engineHours" type="number" min="0" step="0.1"></label>
      <label>Tankkaustyyppi
        <select name="fillType">
          <option value="full">Täyteen</option>
          <option value="partial">Osatankkaus</option>
        </select>
      </label>
      <label>Lisätiedot<textarea name="notes"></textarea></label>
    `, values => {
      const litres = Number(values.litres);
      const price = Number(values.price);
      const ppu = litres > 0 ? price / litres : 0;
      const title = values.place ? `Tankkaus – ${values.place}` : "Tankkaus";
      const details = `${litres.toFixed(2).replace(".", ",")} l\n${price.toFixed(2).replace(".", ",")} €\n${ppu.toFixed(3).replace(".", ",")} €/l`;

      state.boatEvents.push({
        id: crypto.randomUUID(),
        type: "fuel",
        title,
        details,
        date: new Date().toLocaleDateString("fi-FI")
      });

      if (values.engineHours) state.engineHours = Number(values.engineHours);
      if (state.activeTrip) addLog("fuel", title, details);
      save();
    });
  }

  function updateEngineHours() {
    openForm("Päivitä konetunnit", `
      <label>Todellinen lukema<input name="hours" type="number" min="0" step="0.1" required></label>
      <label>Lisätieto<textarea name="notes"></textarea></label>
    `, values => {
      state.engineHours = Number(values.hours);
      state.boatEvents.push({
        id: crypto.randomUUID(),
        type: "note",
        title: "Konetunnit päivitetty",
        details: `${Number(values.hours).toFixed(1).replace(".", ",")} h${values.notes ? "\n" + values.notes : ""}`,
        date: new Date().toLocaleDateString("fi-FI")
      });
      save();
    });
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  elements.tabs.forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
  elements.startTripButton.addEventListener("click", startTrip);
  document.getElementById("departureButton").addEventListener("click", () => statusEvent("departed", "Irti", "underway"));
  document.getElementById("arrivalButton").addEventListener("click", () => statusEvent("moored", "Kiinni", "moored"));
  document.getElementById("anchorButton").addEventListener("click", () => statusEvent("anchored", "Ankkurissa", "moored"));
  document.getElementById("noteButton").addEventListener("click", () => textEvent("note", "Oma kirjaus"));
  document.getElementById("disturbanceButton").addEventListener("click", () => textEvent("disturbance", "Häiriö"));
  document.getElementById("endTripButton").addEventListener("click", endTrip);
  document.getElementById("newFuelButton").addEventListener("click", newFuel);
  document.getElementById("updateEngineHoursButton").addEventListener("click", updateEngineHours);

  const settings = VenelokiStorage.getSettings();
  elements.apiUrlInput.value = settings.apiUrl;
  elements.apiKeyInput.value = settings.apiKey;

  elements.settingsForm.addEventListener("submit", event => {
    event.preventDefault();
    VenelokiStorage.saveSettings({
      apiUrl: elements.apiUrlInput.value.trim(),
      apiKey: elements.apiKeyInput.value.trim()
    });
    alert("Asetukset tallennettu tälle laitteelle.");
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  }

  render();
})();
