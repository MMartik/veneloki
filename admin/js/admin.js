(() => {
  const DEFAULT_CENTER = [61.2, 28.4];
  const DEFAULT_ZOOM = 8;
  const VAYLA_WMS_URL = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows";
  const VAYLA_WMS_LAYERS = [
    "vesivaylatiedot:vaylaalueet_uusi",
    "vesivaylatiedot:navigointilinjat_uusi",
    "vesivaylatiedot:turvalaitteet_uusi"
  ].join(",");

  const elements = {
    connectionStatus: document.getElementById("connectionStatus"),
    connectionForm: document.getElementById("connectionForm"),
    apiUrlInput: document.getElementById("apiUrlInput"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    mapBaseInput: document.getElementById("mapBaseInput"),
    mmlKeyInput: document.getElementById("mmlKeyInput"),
    waterwaysToggle: document.getElementById("waterwaysToggle"),
    placeSearch: document.getElementById("placeSearch"),
    placeList: document.getElementById("placeList"),
    placeCount: document.getElementById("placeCount"),
    placeForm: document.getElementById("placeForm"),
    placeIdInput: document.getElementById("placeIdInput"),
    displayNameInput: document.getElementById("displayNameInput"),
    internalNameInput: document.getElementById("internalNameInput"),
    placeTypeInput: document.getElementById("placeTypeInput"),
    geometryTypeInput: document.getElementById("geometryTypeInput"),
    radiusInput: document.getElementById("radiusInput"),
    radiusField: document.getElementById("radiusField"),
    radiusHelp: document.getElementById("radiusHelp"),
    minimumStayInput: document.getElementById("minimumStayInput"),
    descriptionInput: document.getElementById("descriptionInput"),
    autoLogInput: document.getElementById("autoLogInput"),
    showOnMapInput: document.getElementById("showOnMapInput"),
    enabledInput: document.getElementById("enabledInput"),
    geometryJsonInput: document.getElementById("geometryJsonInput"),
    geometryState: document.getElementById("geometryState"),
    editorTitle: document.getElementById("editorTitle"),
    deleteButton: document.getElementById("deleteButton"),
    duplicateButton: document.getElementById("duplicateButton"),
    clearEditorButton: document.getElementById("clearEditorButton"),
    newCircleButton: document.getElementById("newCircleButton"),
    newLineButton: document.getElementById("newLineButton"),
    newPolygonButton: document.getElementById("newPolygonButton"),
    undoPointButton: document.getElementById("undoPointButton"),
    fitPlacesButton: document.getElementById("fitPlacesButton"),
    drawHint: document.getElementById("drawHint"),
    coordinateStatus: document.getElementById("coordinateStatus"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput")
  };

  let map;
  let localBaseLayer;
  let onlineBaseLayer;
  let waterwaysLayer;
  let placesLayer;
  let editorLayer;
  let editorMarkers;
  let places = [];
  let geometry = null;
  let drawing = false;
  let selectedPlaceId = "";

  function initialise() {
    const settings = VenelokiStorage.getSettings();
    elements.apiUrlInput.value = settings.apiUrl;
    elements.apiKeyInput.value = settings.apiKey;
    elements.mapBaseInput.value = settings.mapBase || "osm";
    elements.mmlKeyInput.value = settings.mmlApiKey || "";
    initialiseMap();
    bindEvents();
    resetEditor("circle");
    if (VenelokiApi.isConfigured()) loadPlaces();
  }

  function initialiseMap() {
    map = L.map("adminMap", { preferCanvas: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    localBaseLayer = createLocalGridLayer().addTo(map);
    placesLayer = L.layerGroup().addTo(map);
    editorLayer = L.layerGroup().addTo(map);
    editorMarkers = L.layerGroup().addTo(map);
    configureMapLayers();

    map.on("mousemove", event => {
      elements.coordinateStatus.textContent = `${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`;
    });
    map.on("click", event => {
      if (!drawing) return;
      addGeometryPoint(event.latlng);
    });
    map.on("dblclick", event => {
      if (!drawing || elements.geometryTypeInput.value === "circle") return;
      L.DomEvent.preventDefault(event.originalEvent);
      drawing = false;
      updateDrawHint();
      updateToolbarState();
    });
    map.on("zoomend", () => {
      renderPlaces();
      renderEditorGeometry();
    });
  }

  function createLocalGridLayer() {
    const Grid = L.GridLayer.extend({
      createTile(coords) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        const context = tile.getContext("2d");
        context.fillStyle = "#10283a";
        context.fillRect(0, 0, size.x, size.y);
        context.strokeStyle = "rgba(143,191,219,.13)";
        context.strokeRect(.5, .5, size.x - 1, size.y - 1);
        context.fillStyle = "rgba(223,239,248,.45)";
        context.font = "11px system-ui";
        context.fillText(`${coords.z}/${coords.x}/${coords.y}`, 10, 20);
        return tile;
      }
    });
    return new Grid({ minZoom: 3, maxZoom: 18, attribution: "Paikallinen yleispohja" });
  }

  function configureMapLayers() {
    if (onlineBaseLayer) map.removeLayer(onlineBaseLayer);
    if (waterwaysLayer) map.removeLayer(waterwaysLayer);
    onlineBaseLayer = null;
    waterwaysLayer = null;

    const settings = VenelokiStorage.getSettings();
    if (settings.mapBase === "mml" && settings.mmlApiKey) {
      const key = encodeURIComponent(settings.mmlApiKey);
      onlineBaseLayer = L.tileLayer(
        "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts" +
        "?service=WMTS&request=GetTile&version=1.0.0&layer=taustakartta" +
        "&style=default&tilematrixset=WGS84_Pseudo-Mercator" +
        "&tilematrix={z}&tilerow={y}&tilecol={x}&format=image/png&api-key=" + key,
        { maxNativeZoom: 16, maxZoom: 18, crossOrigin: true, attribution: "Taustakartta © Maanmittauslaitos" }
      ).addTo(map);
    } else if (settings.mapBase !== "none") {
      onlineBaseLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        crossOrigin: true,
        attribution: "© OpenStreetMapin tekijät"
      }).addTo(map);
    }

    waterwaysLayer = L.tileLayer.wms(VAYLA_WMS_URL, {
      layers: VAYLA_WMS_LAYERS,
      format: "image/png",
      transparent: true,
      version: "1.1.1",
      opacity: .78,
      attribution: "Väylätiedot © Väylävirasto · ei navigointiin"
    });
    if (elements.waterwaysToggle.checked && navigator.onLine) waterwaysLayer.addTo(map);
  }

  function bindEvents() {
    elements.connectionForm.addEventListener("submit", async event => {
      event.preventDefault();
      VenelokiStorage.saveSettings({
        apiUrl: elements.apiUrlInput.value.trim(),
        apiKey: elements.apiKeyInput.value.trim(),
        mapBase: elements.mapBaseInput.value,
        mmlApiKey: elements.mmlKeyInput.value.trim()
      });
      configureMapLayers();
      await loadPlaces();
    });

    elements.waterwaysToggle.addEventListener("change", () => {
      if (elements.waterwaysToggle.checked && navigator.onLine) waterwaysLayer?.addTo(map);
      else if (waterwaysLayer && map.hasLayer(waterwaysLayer)) map.removeLayer(waterwaysLayer);
    });
    elements.placeSearch.addEventListener("input", renderPlaceList);
    elements.placeForm.addEventListener("submit", savePlace);
    elements.geometryTypeInput.addEventListener("change", () => {
      geometry = null;
      drawing = true;
      updateGeometryUi();
      renderEditorGeometry();
      updateDrawHint();
    });
    elements.radiusInput.addEventListener("input", renderEditorGeometry);
    elements.placeTypeInput.addEventListener("change", () => {
      renderEditorGeometry();
      renderPlaces();
    });
    elements.newCircleButton.addEventListener("click", () => resetEditor("circle", true));
    elements.newLineButton.addEventListener("click", () => resetEditor("line", true));
    elements.newPolygonButton.addEventListener("click", () => resetEditor("polygon", true));
    elements.undoPointButton.addEventListener("click", undoGeometryPoint);
    elements.fitPlacesButton.addEventListener("click", fitPlaces);
    elements.clearEditorButton.addEventListener("click", () => resetEditor("circle"));
    elements.deleteButton.addEventListener("click", deleteSelectedPlace);
    elements.duplicateButton.addEventListener("click", duplicateSelectedPlace);
    elements.exportButton.addEventListener("click", exportGeoJson);
    elements.importInput.addEventListener("change", importJsonFile);
    window.addEventListener("online", () => elements.waterwaysToggle.checked && waterwaysLayer?.addTo(map));
    window.addEventListener("offline", () => waterwaysLayer && map.hasLayer(waterwaysLayer) && map.removeLayer(waterwaysLayer));
  }

  async function loadPlaces() {
    if (!VenelokiApi.isConfigured()) {
      setConnectionStatus("API-asetukset puuttuvat", "error");
      return false;
    }
    setConnectionStatus("Ladataan…");
    try {
      const result = await VenelokiApi.listPlaces();
      places = Array.isArray(result?.places) ? result.places : [];
      setConnectionStatus("Yhdistetty", "ok");
      renderPlaces();
      renderPlaceList();
      return true;
    } catch (error) {
      console.error(error);
      setConnectionStatus(error?.message || "Yhteys epäonnistui", "error");
      return false;
    }
  }

  function setConnectionStatus(text, state = "") {
    elements.connectionStatus.textContent = text;
    elements.connectionStatus.className = `connection-status${state ? ` ${state}` : ""}`;
  }

  function renderPlaces() {
    placesLayer.clearLayers();
    places.forEach(place => {
      if (String(place.placeId) === String(selectedPlaceId)) return;
      const layer = placeToLayer(place, false);
      if (!layer) return;
      layer.on("click", event => {
        L.DomEvent.stopPropagation(event);
        selectPlace(place.placeId);
      });
      layer.addTo(placesLayer);
    });
  }

  function renderPlaceList() {
    const query = elements.placeSearch.value.trim().toLocaleLowerCase("fi");
    const filtered = places.filter(place => {
      const haystack = `${place.displayName} ${place.internalName} ${placeTypeLabel(place.placeType)}`.toLocaleLowerCase("fi");
      return !query || haystack.includes(query);
    });
    elements.placeCount.textContent = query ? `${filtered.length}/${places.length}` : String(places.length);
    if (!filtered.length) {
      elements.placeList.innerHTML = '<div class="empty">Ei hakua vastaavia paikkoja.</div>';
      return;
    }
    elements.placeList.innerHTML = filtered.map(place => `
      <button type="button" class="place-row${place.enabled ? "" : " disabled"}${String(place.placeId) === String(selectedPlaceId) ? " active" : ""}" data-place-id="${escapeHtml(place.placeId)}">
        <span class="place-dot" style="background:${placeColor(place.placeType)}"></span>
        <span class="place-name">${escapeHtml(place.displayName)}</span>
        <span class="place-type">${escapeHtml(placeTypeLabel(place.placeType))}</span>
      </button>
    `).join("");
    elements.placeList.querySelectorAll("[data-place-id]").forEach(button => {
      button.addEventListener("click", () => selectPlace(button.dataset.placeId));
    });
  }

  function selectPlace(placeId) {
    const place = places.find(item => String(item.placeId) === String(placeId));
    if (!place) return;
    selectedPlaceId = String(place.placeId);
    drawing = false;
    elements.placeIdInput.value = place.placeId;
    elements.displayNameInput.value = place.displayName || "";
    elements.internalNameInput.value = place.internalName || "";
    elements.placeTypeInput.value = place.placeType || "other";
    elements.geometryTypeInput.value = place.geometryType || "circle";
    elements.radiusInput.value = Number(place.radiusM || 100);
    elements.minimumStayInput.value = Number(place.minimumStaySeconds || 0);
    elements.descriptionInput.value = place.description || "";
    elements.autoLogInput.checked = place.autoLog !== false;
    elements.showOnMapInput.checked = place.showOnMap !== false;
    elements.enabledInput.checked = place.enabled !== false;
    geometry = cloneGeometry(place.geometryJson);
    elements.editorTitle.textContent = place.displayName || "Muokkaa paikkaa";
    elements.deleteButton.disabled = false;
    elements.duplicateButton.disabled = false;
    updateGeometryUi();
    renderEditorGeometry();
    renderPlaces();
    renderPlaceList();
    updateDrawHint();
    const bounds = placeBounds(place);
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  function resetEditor(geometryType = "circle", startDrawing = false) {
    selectedPlaceId = "";
    geometry = null;
    drawing = startDrawing;
    elements.placeForm.reset();
    elements.placeIdInput.value = "";
    elements.geometryTypeInput.value = geometryType;
    elements.radiusInput.value = "150";
    elements.minimumStayInput.value = "0";
    elements.autoLogInput.checked = true;
    elements.showOnMapInput.checked = true;
    elements.enabledInput.checked = true;
    elements.editorTitle.textContent = "Uusi paikka";
    elements.deleteButton.disabled = true;
    elements.duplicateButton.disabled = true;
    updateGeometryUi();
    renderEditorGeometry();
    renderPlaces();
    renderPlaceList();
    updateDrawHint();
  }

  function updateGeometryUi() {
    const type = elements.geometryTypeInput.value;
    elements.radiusField.firstChild.textContent = type === "circle" ? "Tunnistussäde metreinä" : "Viivan tunnistusetäisyys metreinä";
    elements.radiusField.classList.toggle("hidden", type === "polygon");
    elements.radiusHelp.textContent = type === "circle"
      ? "Etäisyys keskipisteestä ympyrän reunaan."
      : "Varjostettu tunnistuskäytävä ulottuu tämän verran viivan kummallekin puolelle.";
    updateToolbarState();
  }

  function updateToolbarState() {
    const type = elements.geometryTypeInput.value;
    [
      [elements.newCircleButton, "circle"],
      [elements.newLineButton, "line"],
      [elements.newPolygonButton, "polygon"]
    ].forEach(([button, value]) => button.classList.toggle("active", drawing && type === value));
    elements.undoPointButton.disabled = geometryPointCount() === 0;
  }

  function updateDrawHint() {
    if (!drawing) {
      elements.drawHint.classList.add("hidden");
      return;
    }
    const type = elements.geometryTypeInput.value;
    elements.drawHint.textContent = type === "circle"
      ? "Klikkaa karttaa ja aseta ympyrän keskipiste."
      : type === "line"
        ? "Klikkaa viivan pisteet. Lopeta kaksoisklikkauksella."
        : "Klikkaa alueen kulmapisteet. Lopeta kaksoisklikkauksella.";
    elements.drawHint.classList.remove("hidden");
  }

  function addGeometryPoint(latlng) {
    const type = elements.geometryTypeInput.value;
    if (type === "circle") {
      geometry = { type: "Point", coordinates: [latlng.lng, latlng.lat] };
      drawing = false;
    } else if (type === "line") {
      if (!geometry || geometry.type !== "LineString") geometry = { type: "LineString", coordinates: [] };
      geometry.coordinates.push([latlng.lng, latlng.lat]);
    } else {
      const points = polygonVertices();
      points.push([latlng.lng, latlng.lat]);
      geometry = polygonFromVertices(points);
    }
    renderEditorGeometry();
    updateDrawHint();
    updateToolbarState();
  }

  function undoGeometryPoint() {
    const type = elements.geometryTypeInput.value;
    if (!geometry) return;
    if (type === "circle") geometry = null;
    else if (type === "line") {
      geometry.coordinates.pop();
      if (!geometry.coordinates.length) geometry = null;
    } else {
      const points = polygonVertices();
      points.pop();
      geometry = points.length ? polygonFromVertices(points) : null;
    }
    renderEditorGeometry();
    updateToolbarState();
  }

  function renderEditorGeometry() {
    editorLayer.clearLayers();
    editorMarkers.clearLayers();
    elements.geometryJsonInput.value = geometry ? JSON.stringify(geometry) : "";
    const validation = validateGeometry(false);
    elements.geometryState.textContent = validation.message;
    elements.geometryState.className = `geometry-state full ${validation.ok ? "ok" : geometry ? "error" : ""}`;

    if (!geometry) return;
    const type = elements.geometryTypeInput.value;
    const color = placeColor(elements.placeTypeInput.value);
    if (type === "circle" && geometry.type === "Point") {
      L.circle([geometry.coordinates[1], geometry.coordinates[0]], {
        radius: Math.max(1, Number(elements.radiusInput.value) || 100),
        color,
        fillColor: color,
        fillOpacity: .16,
        weight: 3
      }).addTo(editorLayer);
      addVertexMarker(geometry.coordinates, coordinate => {
        geometry.coordinates = coordinate;
      });
      return;
    }

    const vertices = type === "polygon" ? polygonVertices() : geometry.coordinates;
    if (type === "line" && vertices.length > 1) {
      createLineDetectionLayer(vertices, color, elements.radiusInput.value, 6).addTo(editorLayer);
    }
    if (type === "polygon" && vertices.length > 2) {
      L.polygon(vertices.map(toLatLng), { color, fillColor: color, fillOpacity: .16, weight: 3 }).addTo(editorLayer);
    }
    vertices.forEach((coordinate, index) => addVertexMarker(coordinate, next => {
      vertices[index] = next;
      geometry = type === "polygon" ? polygonFromVertices(vertices) : { type: "LineString", coordinates: vertices };
    }));
  }

  function addVertexMarker(coordinate, onMove) {
    const marker = L.circleMarker(toLatLng(coordinate), {
      radius: 7,
      color: "#fff",
      weight: 2,
      fillColor: "#2563eb",
      fillOpacity: 1,
      draggable: false
    }).addTo(editorMarkers);

    const handle = L.marker(toLatLng(coordinate), {
      draggable: true,
      opacity: 0,
      keyboard: true
    }).addTo(editorMarkers);
    handle.on("drag", event => {
      const latlng = event.target.getLatLng();
      onMove([latlng.lng, latlng.lat]);
      marker.setLatLng(latlng);
      elements.geometryJsonInput.value = JSON.stringify(geometry);
      renderEditorShapeOnly();
    });
    handle.on("dragend", renderEditorGeometry);
  }

  function renderEditorShapeOnly() {
    editorLayer.clearLayers();
    if (!geometry) return;
    const type = elements.geometryTypeInput.value;
    const color = placeColor(elements.placeTypeInput.value);
    if (type === "circle") {
      L.circle(toLatLng(geometry.coordinates), {
        radius: Math.max(1, Number(elements.radiusInput.value) || 100),
        color,
        fillColor: color,
        fillOpacity: .16,
        weight: 3
      }).addTo(editorLayer);
    } else if (type === "line") {
      createLineDetectionLayer(geometry.coordinates, color, elements.radiusInput.value, 6).addTo(editorLayer);
    } else {
      L.polygon(polygonVertices().map(toLatLng), { color, fillColor: color, fillOpacity: .16, weight: 3 }).addTo(editorLayer);
    }
  }

  async function savePlace(event) {
    event.preventDefault();
    if (!VenelokiApi.isConfigured()) {
      alert("Tallenna ensin API-yhteys.");
      return;
    }
    const validation = validateGeometry(true);
    if (!validation.ok) {
      alert(validation.message);
      return;
    }
    const place = formPlace();
    const saveButton = document.getElementById("saveButton");
    saveButton.disabled = true;
    saveButton.textContent = "Tallennetaan…";
    try {
      const result = await VenelokiApi.savePlace(place);
      await loadPlaces();
      selectPlace(result.place.placeId);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Paikan tallennus epäonnistui.");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Tallenna paikka";
    }
  }

  function formPlace() {
    const displayName = elements.displayNameInput.value.trim();
    const internalName = elements.internalNameInput.value.trim() || normaliseInternalName(displayName);
    elements.internalNameInput.value = internalName;
    return {
      placeId: elements.placeIdInput.value || newId("place"),
      displayName,
      internalName,
      placeType: elements.placeTypeInput.value,
      geometryType: elements.geometryTypeInput.value,
      geometryJson: cloneGeometry(geometry),
      radiusM: Math.max(1, Number(elements.radiusInput.value) || 100),
      minimumStaySeconds: Math.max(0, Number(elements.minimumStayInput.value) || 0),
      description: elements.descriptionInput.value.trim(),
      autoLog: elements.autoLogInput.checked,
      oncePerVisit: true,
      showOnMap: elements.showOnMapInput.checked,
      showInReport: true,
      enabled: elements.enabledInput.checked,
      source: "manual"
    };
  }

  async function deleteSelectedPlace() {
    const placeId = elements.placeIdInput.value;
    if (!placeId) return;
    const place = places.find(item => String(item.placeId) === String(placeId));
    if (!confirm(`Poistetaanko paikka “${place?.displayName || placeId}”?`)) return;
    elements.deleteButton.disabled = true;
    try {
      await VenelokiApi.deletePlace(placeId);
      resetEditor("circle");
      await loadPlaces();
    } catch (error) {
      alert(error?.message || "Paikan poistaminen epäonnistui.");
      elements.deleteButton.disabled = false;
    }
  }

  function duplicateSelectedPlace() {
    if (!elements.placeIdInput.value) return;
    selectedPlaceId = "";
    elements.placeIdInput.value = "";
    elements.displayNameInput.value = `${elements.displayNameInput.value} – kopio`;
    elements.internalNameInput.value = "";
    elements.editorTitle.textContent = "Uusi paikka kopiona";
    elements.deleteButton.disabled = true;
    elements.duplicateButton.disabled = true;
    drawing = false;
    renderPlaces();
    renderPlaceList();
  }

  function validateGeometry(strict) {
    const type = elements.geometryTypeInput.value;
    if (!geometry) return { ok: false, message: "Piirrä geometria kartalle." };
    if (type === "circle" && geometry.type === "Point") return { ok: true, message: "Keskipiste on asetettu." };
    if (type === "line" && geometry.type === "LineString") {
      const count = geometry.coordinates.length;
      const radius = Math.max(1, Number(elements.radiusInput.value) || 100);
      return { ok: count >= 2, message: count >= 2 ? `Viivassa on ${count} pistettä. Tunnistus ${radius} m viivan molemmin puolin.` : "Viiva tarvitsee vähintään kaksi pistettä." };
    }
    if (type === "polygon" && geometry.type === "Polygon") {
      const count = polygonVertices().length;
      return { ok: count >= 3, message: count >= 3 ? `Alueessa on ${count} kulmapistettä.` : "Alue tarvitsee vähintään kolme kulmapistettä." };
    }
    return { ok: false, message: strict ? "Geometriatyyppi ja piirros eivät vastaa toisiaan." : "Piirrä geometria uudelleen." };
  }

  function placeToLayer(place) {
    const itemGeometry = cloneGeometry(place.geometryJson);
    if (!itemGeometry) return null;
    const color = placeColor(place.placeType);
    const style = { color, fillColor: color, fillOpacity: .12, weight: 2 };
    let layer;
    if (place.geometryType === "circle" && itemGeometry.type === "Point") {
      layer = L.circle(toLatLng(itemGeometry.coordinates), { ...style, radius: Number(place.radiusM || 100) });
    } else if (place.geometryType === "line" && itemGeometry.type === "LineString") {
      layer = createLineDetectionLayer(itemGeometry.coordinates, color, place.radiusM, 5);
    } else if (place.geometryType === "polygon" && itemGeometry.type === "Polygon") {
      layer = L.polygon(itemGeometry.coordinates[0].map(toLatLng), style);
    }
    if (layer) layer.bindTooltip(place.displayName || place.internalName);
    return layer || null;
  }

  function fitPlaces() {
    const bounds = L.latLngBounds([]);
    places.forEach(place => {
      const itemBounds = placeBounds(place);
      if (itemBounds?.isValid()) bounds.extend(itemBounds);
    });
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }

  function placeBounds(place) {
    const itemGeometry = cloneGeometry(place?.geometryJson);
    if (!itemGeometry) return null;

    if (place.geometryType === "circle" && itemGeometry.type === "Point") {
      const center = L.latLng(toLatLng(itemGeometry.coordinates));
      const diameterM = Math.max(1, Number(place.radiusM) || 100) * 2;
      return center.toBounds(diameterM);
    }

    if (place.geometryType === "line" && itemGeometry.type === "LineString") {
      const radiusM = Math.max(1, Number(place.radiusM) || 100);
      const bounds = L.latLngBounds([]);
      itemGeometry.coordinates.forEach(coordinate => {
        bounds.extend(L.latLng(toLatLng(coordinate)).toBounds(radiusM * 2));
      });
      return bounds;
    }

    if (place.geometryType === "polygon" && itemGeometry.type === "Polygon") {
      return L.latLngBounds((itemGeometry.coordinates[0] || []).map(toLatLng));
    }

    return null;
  }

  function exportGeoJson() {
    const collection = {
      type: "FeatureCollection",
      generatedAt: new Date().toISOString(),
      features: places.map(place => ({
        type: "Feature",
        id: place.placeId,
        geometry: cloneGeometry(place.geometryJson),
        properties: { ...place, geometryJson: undefined }
      }))
    };
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `veneloki-paikat-${new Date().toISOString().slice(0, 10)}.geojson`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importJsonFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const content = JSON.parse(await file.text());
      const imported = Array.isArray(content)
        ? content
        : content.type === "FeatureCollection"
          ? content.features.map(featureToPlace)
          : [];
      if (!imported.length) throw new Error("Tiedostossa ei ole tuotavia paikkoja.");
      if (!confirm(`Tuodaanko ${imported.length} paikkaa? Samat placeId-tunnisteet päivitetään.`)) return;
      setConnectionStatus("Tuodaan…");
      const result = await VenelokiApi.importPlaces(imported);
      await loadPlaces();
      alert(`Tuonti valmis: ${result.created} uutta, ${result.updated} päivitettyä paikkaa.`);
    } catch (error) {
      console.error(error);
      setConnectionStatus("Tuonti epäonnistui", "error");
      alert(error?.message || "Paikkojen tuonti epäonnistui.");
    }
  }

  function featureToPlace(feature) {
    const properties = feature?.properties || {};
    const geometryType = feature?.geometry?.type === "Point"
      ? "circle"
      : feature?.geometry?.type === "LineString"
        ? "line"
        : "polygon";
    return {
      ...properties,
      placeId: properties.placeId || feature.id || newId("place"),
      displayName: properties.displayName || properties.name || "Nimetön paikka",
      internalName: properties.internalName || normaliseInternalName(properties.displayName || properties.name || "nimeton-paikka"),
      geometryType: properties.geometryType || geometryType,
      geometryJson: feature.geometry,
      radiusM: Number(properties.radiusM || 100),
      enabled: properties.enabled !== false,
      source: properties.source || "import"
    };
  }

  function geometryPointCount() {
    if (!geometry) return 0;
    if (geometry.type === "Point") return 1;
    if (geometry.type === "LineString") return geometry.coordinates.length;
    if (geometry.type === "Polygon") return polygonVertices().length;
    return 0;
  }

  function polygonVertices() {
    if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates?.[0])) return [];
    const coordinates = geometry.coordinates[0].map(coordinate => [...coordinate]);
    if (coordinates.length > 1 && sameCoordinate(coordinates[0], coordinates[coordinates.length - 1])) coordinates.pop();
    return coordinates;
  }

  function polygonFromVertices(vertices) {
    const coordinates = vertices.map(coordinate => [...coordinate]);
    if (coordinates.length) coordinates.push([...coordinates[0]]);
    return { type: "Polygon", coordinates: [coordinates] };
  }

  function sameCoordinate(left, right) {
    return Number(left?.[0]) === Number(right?.[0]) && Number(left?.[1]) === Number(right?.[1]);
  }

  function cloneGeometry(value) {
    if (!value) return null;
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch (error) { return null; }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function toLatLng(coordinate) {
    return [Number(coordinate[1]), Number(coordinate[0])];
  }

  function createLineDetectionLayer(coordinates, color, radiusM, centerWeight = 5) {
    const latLngs = coordinates.map(toLatLng);
    const reference = coordinates[Math.floor(coordinates.length / 2)] || coordinates[0];
    const diameterPixels = metresToPixels(Math.max(1, Number(radiusM) || 100) * 2, reference);
    const corridor = L.polyline(latLngs, {
      color,
      weight: Math.max(centerWeight + 4, diameterPixels),
      opacity: .18,
      interactive: false
    });
    const centreLine = L.polyline(latLngs, {
      color,
      weight: centerWeight,
      opacity: .95
    });
    return L.featureGroup([corridor, centreLine]);
  }

  function metresToPixels(metres, coordinate) {
    if (!map || !coordinate) return 1;
    const latitude = Number(coordinate[1]);
    const longitude = Number(coordinate[0]);
    const cosine = Math.max(.01, Math.cos(latitude * Math.PI / 180));
    const longitudeDelta = Number(metres) / (111320 * cosine);
    const start = map.project([latitude, longitude], map.getZoom());
    const end = map.project([latitude, longitude + longitudeDelta], map.getZoom());
    return Math.max(1, Math.abs(end.x - start.x));
  }

  function normaliseInternalName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fi")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "paikka";
  }

  function newId(prefix) {
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${id}`;
  }

  function placeColor(type) {
    return ({ island: "#f59e0b", harbour: "#38bdf8", canal: "#a78bfa", bridge: "#f97316", ferry: "#ec4899", anchorage: "#22c55e" })[type] || "#eab308";
  }

  function placeTypeLabel(type) {
    return ({ island: "Saari", harbour: "Satama", canal: "Kanava", bridge: "Silta", ferry: "Lossi", anchorage: "Ankkuripaikka", other: "Muu" })[type] || "Muu";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  initialise();
})();
