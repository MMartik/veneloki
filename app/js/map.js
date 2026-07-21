const VenelokiMap = (() => {
  const DEFAULT_CENTER = [61.2, 28.4];
  const DEFAULT_ZOOM = 8;
  const MAX_LOCAL_POINTS = 20000;
  const MAX_BATCH_POINTS = 200;
  const SAMPLE_MIN_INTERVAL_MS = 10000;
  const SAMPLE_FORCE_INTERVAL_MS = 30000;
  const SAMPLE_MIN_DISTANCE_M = 8;
  const MAX_ACCURACY_M = 100;
  const BATCH_MIN_POINTS = 5;
  const BATCH_INTERVAL_MS = 60000;
  const VAYLA_WMS_URL = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows";
  const VAYLA_WMS_LAYERS = [
    "vesivaylatiedot:vaylaalueet_uusi",
    "vesivaylatiedot:navigointilinjat_uusi",
    "vesivaylatiedot:turvalaitteet_uusi"
  ].join(",");

  let callbacks = {};
  let map = null;
  let state = null;
  let localBaseLayer = null;
  let offlineDataLayer = null;
  let onlineBaseLayer = null;
  let waterwaysLayer = null;
  let routeLayer = null;
  let placesLayer = null;
  let eventsLayer = null;
  let positionLayer = null;
  let accuracyLayer = null;
  let followPosition = true;
  let mapHasInitialExtent = false;
  let lastBatchAt = 0;
  let layerSettings = { base: true, waterways: true, places: true, events: true };

  function initialise(options = {}) {
    callbacks = options;
    state = callbacks.getState?.() || null;
    layerSettings = globalThis.VenelokiStorage?.getMapLayers?.() || layerSettings;
    bindControls();
    updateLayerInputs();
    renderSummary();
  }

  function bindControls() {
    document.getElementById("mapFollowButton")?.addEventListener("click", () => {
      followPosition = !followPosition;
      const button = document.getElementById("mapFollowButton");
      button?.classList.toggle("active", followPosition);
      button?.setAttribute("aria-pressed", String(followPosition));
      if (followPosition) centreOnLatestPosition();
    });

    document.getElementById("mapFitRouteButton")?.addEventListener("click", fitRoute);
    document.getElementById("mapLayersButton")?.addEventListener("click", event => {
      const panel = document.getElementById("mapLayersPanel");
      const hidden = panel?.classList.toggle("hidden") ?? true;
      event.currentTarget.setAttribute("aria-expanded", String(!hidden));
    });

    [
      ["mapBaseLayerToggle", "base"],
      ["mapWaterwaysToggle", "waterways"],
      ["mapPlacesToggle", "places"],
      ["mapEventsToggle", "events"]
    ].forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener("change", event => {
        layerSettings[key] = Boolean(event.target.checked);
        globalThis.VenelokiStorage?.saveMapLayers?.(layerSettings);
        applyLayerVisibility();
      });
    });
  }

  function updateLayerInputs() {
    const ids = {
      mapBaseLayerToggle: "base",
      mapWaterwaysToggle: "waterways",
      mapPlacesToggle: "places",
      mapEventsToggle: "events"
    };
    Object.entries(ids).forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (input) input.checked = layerSettings[key] !== false;
    });
  }

  function ensureMap() {
    if (map || !document.getElementById("tripMap") || !globalThis.L) return map;

    map = L.map("tripMap", {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    localBaseLayer = createLocalGridLayer().addTo(map);
    offlineDataLayer = L.geoJSON(null, {
      interactive: false,
      style: feature => ({
        color: feature?.properties?.kind === "shoreline" ? "#7aa6bd" : "#52758a",
        fillColor: feature?.properties?.kind === "land" ? "#334b3d" : "#17394d",
        fillOpacity: feature?.properties?.kind === "land" ? 0.72 : 0.42,
        weight: 1
      })
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    placesLayer = L.layerGroup().addTo(map);
    eventsLayer = L.layerGroup().addTo(map);
    positionLayer = L.layerGroup().addTo(map);

    map.on("dragstart", () => {
      followPosition = false;
      const button = document.getElementById("mapFollowButton");
      button?.classList.remove("active");
      button?.setAttribute("aria-pressed", "false");
    });

    configureOnlineLayers();
    loadOfflineMap();
    renderMap();
    window.setTimeout(() => map?.invalidateSize(), 0);
    return map;
  }

  async function loadOfflineMap() {
    if (!offlineDataLayer) return;
    try {
      const response = await fetch("./data/offline-map.geojson?v=0.3.0", { cache: "force-cache" });
      if (!response.ok) return;
      const data = await response.json();
      offlineDataLayer.clearLayers();
      offlineDataLayer.addData(data);
    } catch (error) {
      console.warn("Paikallisen yleiskartan lataaminen epäonnistui.", error);
    }
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
        context.strokeStyle = "rgba(143, 191, 219, 0.13)";
        context.lineWidth = 1;
        context.strokeRect(0.5, 0.5, size.x - 1, size.y - 1);
        context.fillStyle = "rgba(223, 239, 248, 0.46)";
        context.font = "11px system-ui, sans-serif";
        context.fillText(`${coords.z}/${coords.x}/${coords.y}`, 10, 20);
        return tile;
      }
    });
    return new Grid({ minZoom: 3, maxZoom: 18, attribution: "Paikallinen yleispohja" });
  }

  function configureOnlineLayers() {
    if (!map) return;
    if (onlineBaseLayer) map.removeLayer(onlineBaseLayer);
    if (waterwaysLayer) map.removeLayer(waterwaysLayer);
    onlineBaseLayer = null;
    waterwaysLayer = null;

    const settings = globalThis.VenelokiStorage?.getSettings?.() || {};
    if (settings.mapBase === "mml" && settings.mmlApiKey) {
      const key = encodeURIComponent(settings.mmlApiKey);
      const url = "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts" +
        "?service=WMTS&request=GetTile&version=1.0.0&layer=taustakartta" +
        "&style=default&tilematrixset=WGS84_Pseudo-Mercator" +
        "&tilematrix={z}&tilerow={y}&tilecol={x}&format=image/png&api-key=" + key;
      onlineBaseLayer = L.tileLayer(url, {
        maxNativeZoom: 16,
        maxZoom: 18,
        crossOrigin: true,
        attribution: "Taustakartta © Maanmittauslaitos"
      });
    } else if (settings.mapBase !== "none") {
      onlineBaseLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        crossOrigin: true,
        attribution: "© OpenStreetMapin tekijät"
      });
    }

    if (onlineBaseLayer) {
      onlineBaseLayer.on("loading", () => setBackgroundState("Ladataan online-karttaa…"));
      onlineBaseLayer.on("load", () => setBackgroundState("Online-kartta"));
      onlineBaseLayer.on("tileerror", () => setBackgroundState("Paikallinen yleispohja"));
    }

    waterwaysLayer = L.tileLayer.wms(VAYLA_WMS_URL, {
      layers: VAYLA_WMS_LAYERS,
      format: "image/png",
      transparent: true,
      version: "1.1.1",
      opacity: 0.78,
      attribution: "Väylätiedot © Väylävirasto · ei navigointiin"
    });
    waterwaysLayer.on("tileerror", () => setBackgroundState("Online-pohja · väylät eivät saatavilla"));
    applyLayerVisibility();
  }

  function applyLayerVisibility() {
    if (!map) return;
    toggleMapLayer(onlineBaseLayer, layerSettings.base && navigator.onLine);
    toggleMapLayer(waterwaysLayer, layerSettings.waterways && navigator.onLine);
    toggleMapLayer(placesLayer, layerSettings.places);
    toggleMapLayer(eventsLayer, layerSettings.events);
    if (!layerSettings.base || !navigator.onLine) setBackgroundState("Paikallinen yleispohja");
  }

  function toggleMapLayer(layer, visible) {
    if (!layer || !map) return;
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
  }

  function setBackgroundState(text) {
    const element = document.getElementById("mapBackgroundState");
    if (element) element.textContent = text;
  }

  function onViewActive() {
    ensureMap();
    window.setTimeout(() => {
      map?.invalidateSize();
      if (!mapHasInitialExtent) fitRoute();
    }, 30);
  }

  function onState(nextState) {
    state = nextState;
    renderSummary();
    if (map) renderMap();
  }

  function renderMap() {
    if (!map || !state) return;
    renderRoute();
    renderPlaces();
    renderEvents();
    renderPosition(callbacks.getGps?.());
    document.getElementById("mapEmptyState")?.classList.toggle(
      "hidden",
      Boolean(state.routePoints?.length || callbacks.getGps?.())
    );
  }

  function renderRoute() {
    if (!routeLayer) return;
    routeLayer.clearLayers();
    const coordinates = normaliseRoutePoints(state?.routePoints).map(point => [point.latitude, point.longitude]);
    if (coordinates.length > 1) {
      L.polyline(coordinates, { color: "#38bdf8", weight: 4, opacity: 0.92 }).addTo(routeLayer);
    } else if (coordinates.length === 1) {
      L.circleMarker(coordinates[0], { radius: 4, color: "#38bdf8", fillOpacity: 1 }).addTo(routeLayer);
    }
  }

  function renderPlaces() {
    if (!placesLayer) return;
    placesLayer.clearLayers();
    (state?.places || []).filter(place => place.enabled !== false).forEach(place => {
      const geometry = parseGeometry(place.geometryJson);
      if (!geometry) return;
      const style = placeStyle(place.placeType);
      let layer = null;

      if (place.geometryType === "circle" && geometry.type === "Point") {
        layer = L.circle([geometry.coordinates[1], geometry.coordinates[0]], {
          radius: Number(place.radiusM) || 100,
          ...style
        });
      } else if (place.geometryType === "line" && geometry.type === "LineString") {
        layer = L.polyline(geometry.coordinates.map(coordinate => [coordinate[1], coordinate[0]]), {
          ...style,
          weight: 6
        });
      } else if (place.geometryType === "polygon" && geometry.type === "Polygon") {
        layer = L.polygon(geometry.coordinates[0].map(coordinate => [coordinate[1], coordinate[0]]), style);
      }

      if (layer) {
        layer.bindPopup(`<strong>${escapeHtml(place.displayName || place.internalName)}</strong><br>${escapeHtml(placeTypeLabel(place.placeType))}`);
        layer.addTo(placesLayer);
      }
    });
  }

  function renderEvents() {
    if (!eventsLayer) return;
    eventsLayer.clearLayers();
    (state?.log || []).forEach(event => {
      const point = normalisePoint(event.gps);
      if (!point) return;
      const color = eventColor(event.type);
      L.circleMarker([point.latitude, point.longitude], {
        radius: 6,
        color: "#0b0f14",
        weight: 2,
        fillColor: color,
        fillOpacity: 1
      })
        .bindPopup(`<strong>${escapeHtml(event.time || "")}</strong> ${escapeHtml(event.title || "Kirjaus")}<br>${escapeHtml(event.details || "")}`)
        .addTo(eventsLayer);
    });
  }

  function renderPosition(position) {
    if (!positionLayer) return;
    positionLayer.clearLayers();
    const point = normalisePoint(position);
    if (!point) return;
    accuracyLayer = L.circle([point.latitude, point.longitude], {
      radius: Math.max(1, Number(point.accuracy) || 0),
      color: "#60a5fa",
      fillColor: "#60a5fa",
      fillOpacity: 0.08,
      weight: 1
    }).addTo(positionLayer);
    L.circleMarker([point.latitude, point.longitude], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 1
    }).bindTooltip("Vene").addTo(positionLayer);
  }

  function onGps(position) {
    const point = normalisePoint(position);
    if (!point) return;
    renderPosition(point);
    if (followPosition && map) map.panTo([point.latitude, point.longitude], { animate: false });
    if (!state?.activeTrip) return;
    const sampled = sampleRoutePoint(point);
    const visitsChanged = evaluatePlaces(point);
    if (sampled || visitsChanged) callbacks.persistState?.();
    if (sampled) {
      renderSummary();
      renderRoute();
      maybeQueueGpsBatch();
    }
  }

  function sampleRoutePoint(point) {
    if ((Number(point.accuracy) || 0) > MAX_ACCURACY_M) return false;
    if (!Array.isArray(state.routePoints)) state.routePoints = [];
    const last = normalisePoint(state.routePoints[state.routePoints.length - 1]);
    const recordedAt = point.timestamp || new Date().toISOString();

    if (last) {
      const elapsed = new Date(recordedAt).getTime() - new Date(last.recordedAt || last.timestamp).getTime();
      const distance = distanceMetres(last, point);
      if (elapsed < SAMPLE_MIN_INTERVAL_MS) return false;
      if (elapsed < SAMPLE_FORCE_INTERVAL_MS && distance < SAMPLE_MIN_DISTANCE_M) return false;
    }

    state.routePoints.push({
      pointId: newId("point"),
      tripId: state.activeTrip.id,
      recordedAt,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyM: nullableNumber(point.accuracy),
      speedMs: nullableNumber(point.speed),
      headingDeg: nullableNumber(point.heading),
      altitudeM: nullableNumber(point.altitude),
      queued: false
    });
    if (state.routePoints.length > MAX_LOCAL_POINTS) {
      state.routePoints.splice(0, state.routePoints.length - MAX_LOCAL_POINTS);
    }
    return true;
  }

  function maybeQueueGpsBatch(force = false) {
    if (!state?.activeTrip || !Array.isArray(state.routePoints)) return 0;
    const unqueued = state.routePoints.filter(point => !point.queued && String(point.tripId) === String(state.activeTrip.id));
    if (!unqueued.length) return 0;
    if (!force && unqueued.length < BATCH_MIN_POINTS && Date.now() - lastBatchAt < BATCH_INTERVAL_MS) return 0;

    const points = unqueued.slice(0, MAX_BATCH_POINTS);
    callbacks.queueOperation?.("gps.batch", {
      batchId: newId("gpsbatch"),
      tripId: state.activeTrip.id,
      points: points.map(toGpsPayload)
    });
    const ids = new Set(points.map(point => point.pointId));
    state.routePoints.forEach(point => {
      if (ids.has(point.pointId)) point.queued = true;
    });
    lastBatchAt = Date.now();
    callbacks.persistState?.();
    return points.length;
  }

  function flushPending() {
    return maybeQueueGpsBatch(true);
  }

  function evaluatePlaces(point) {
    if (!state?.activeTrip) return false;
    if (!state.placeVisits || typeof state.placeVisits !== "object") state.placeVisits = {};
    const now = point.recordedAt || point.timestamp || new Date().toISOString();
    let changed = false;

    (state.places || []).filter(place => place.enabled !== false && place.autoLog !== false).forEach(place => {
      const key = String(place.placeId);
      const visit = state.placeVisits[key];
      const inside = isInsidePlace(point, place);

      if (inside && (!visit || String(visit.tripId) !== String(state.activeTrip.id) || !visit.inside)) {
        state.placeVisits[key] = {
          tripId: state.activeTrip.id,
          inside: true,
          enteredAt: now,
          lastInsideAt: now,
          entryPoint: toGpsPayload(point),
          samples: [toGpsPayload(point)]
        };
        changed = true;
        return;
      }

      if (inside && visit) {
        visit.lastInsideAt = now;
        if (!Array.isArray(visit.samples)) visit.samples = [];
        visit.samples.push(toGpsPayload(point));
        if (visit.samples.length > 1000) visit.samples.splice(0, visit.samples.length - 1000);
        changed = true;
        return;
      }

      if (!inside && visit?.inside && String(visit.tripId) === String(state.activeTrip.id)) {
        finaliseVisit(place, visit, now, point);
        state.placeVisits[key] = {
          tripId: state.activeTrip.id,
          inside: false,
          exitedAt: now
        };
        changed = true;
      }
    });
    return changed;
  }

  function finaliseVisit(place, visit, exitedAt, exitPoint = null) {
    const enteredMs = new Date(visit.enteredAt).getTime();
    const exitedMs = new Date(exitedAt || visit.lastInsideAt).getTime();
    if (!Number.isFinite(enteredMs) || !Number.isFinite(exitedMs)) return false;
    const staySeconds = Math.max(0, (exitedMs - enteredMs) / 1000);
    if (staySeconds < Math.max(0, Number(place.minimumStaySeconds) || 0)) return false;

    const midpointMs = enteredMs + (exitedMs - enteredMs) / 2;
    const visitSamples = Array.isArray(visit.samples) ? [...visit.samples] : [];
    if (exitPoint) visitSamples.push(toGpsPayload(exitPoint));
    const routePoint = nearestPointByTime(visitSamples, midpointMs) || nearestRoutePoint(midpointMs) || visit.entryPoint;
    callbacks.addAutomaticPlaceEvent?.({
      place,
      eventTime: new Date(midpointMs).toISOString(),
      enteredAt: new Date(enteredMs).toISOString(),
      exitedAt: new Date(exitedMs).toISOString(),
      gps: normalisePoint(routePoint)
    });
    return true;
  }

  function finishTrip() {
    if (!state?.activeTrip || !state.placeVisits) return;
    const now = new Date().toISOString();
    (state.places || []).forEach(place => {
      const visit = state.placeVisits[String(place.placeId)];
      if (visit?.inside && String(visit.tripId) === String(state.activeTrip.id)) {
        finaliseVisit(place, visit, now, callbacks.getGps?.());
      }
    });
    flushPending();
    state.placeVisits = {};
    callbacks.persistState?.();
  }

  function nearestRoutePoint(targetMs) {
    return nearestPointByTime(normaliseRoutePoints(state?.routePoints), targetMs);
  }

  function nearestPointByTime(points, targetMs) {
    let nearest = null;
    let nearestDelta = Infinity;
    (points || []).map(normalisePoint).filter(Boolean).forEach(point => {
      const time = new Date(point.recordedAt || point.timestamp).getTime();
      const delta = Math.abs(time - targetMs);
      if (delta < nearestDelta) {
        nearest = point;
        nearestDelta = delta;
      }
    });
    return nearest;
  }

  function isInsidePlace(point, place) {
    const geometry = parseGeometry(place.geometryJson);
    if (!geometry) return false;
    const radius = Math.max(1, Number(place.radiusM) || 100);

    if (place.geometryType === "circle" && geometry.type === "Point") {
      return distanceMetres(point, {
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0]
      }) <= radius;
    }

    if (place.geometryType === "line" && geometry.type === "LineString") {
      return distanceToLineMetres(point, geometry.coordinates) <= radius;
    }

    if (place.geometryType === "polygon" && geometry.type === "Polygon") {
      return pointInPolygon(point, geometry.coordinates[0]);
    }

    return false;
  }

  function fitRoute() {
    ensureMap();
    if (!map) return;
    const points = normaliseRoutePoints(state?.routePoints);
    if (points.length) {
      map.fitBounds(points.map(point => [point.latitude, point.longitude]), { padding: [24, 24], maxZoom: 15 });
      mapHasInitialExtent = true;
      return;
    }
    centreOnLatestPosition();
  }

  function centreOnLatestPosition() {
    const position = normalisePoint(callbacks.getGps?.());
    if (position && map) {
      map.setView([position.latitude, position.longitude], Math.max(map.getZoom(), 14));
      mapHasInitialExtent = true;
    }
  }

  function renderSummary() {
    const points = normaliseRoutePoints(state?.routePoints);
    const count = document.getElementById("mapPointCount");
    const distance = document.getElementById("mapDistance");
    if (count) count.textContent = `${points.length} reittipistettä`;
    if (distance) distance.textContent = `${routeDistanceKm(points).toFixed(1).replace(".", ",")} km`;
  }

  function routeDistanceKm(points) {
    let metres = 0;
    for (let index = 1; index < points.length; index += 1) {
      metres += distanceMetres(points[index - 1], points[index]);
    }
    return metres / 1000;
  }

  function normaliseRoutePoints(points) {
    return (Array.isArray(points) ? points : []).map(normalisePoint).filter(Boolean);
  }

  function normalisePoint(value) {
    if (!value || typeof value !== "object") return null;
    const latitude = Number(value.latitude ?? value.lat);
    const longitude = Number(value.longitude ?? value.lon ?? value.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      ...value,
      latitude,
      longitude,
      recordedAt: value.recordedAt || value.timestamp || new Date().toISOString(),
      timestamp: value.timestamp || value.recordedAt || new Date().toISOString(),
      accuracy: nullableNumber(value.accuracy ?? value.accuracyM),
      speed: nullableNumber(value.speed ?? value.speedMs),
      heading: nullableNumber(value.heading ?? value.headingDeg),
      altitude: nullableNumber(value.altitude ?? value.altitudeM)
    };
  }

  function toGpsPayload(point) {
    const normalised = normalisePoint(point);
    return {
      pointId: point.pointId || newId("point"),
      recordedAt: normalised.recordedAt,
      latitude: normalised.latitude,
      longitude: normalised.longitude,
      accuracyM: nullableNumber(normalised.accuracy),
      speedMs: nullableNumber(normalised.speed),
      headingDeg: nullableNumber(normalised.heading),
      altitudeM: nullableNumber(normalised.altitude)
    };
  }

  function parseGeometry(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function distanceMetres(left, right) {
    const a = normalisePoint(left);
    const b = normalisePoint(right);
    if (!a || !b) return Infinity;
    const radians = degrees => degrees * Math.PI / 180;
    const lat1 = radians(a.latitude);
    const lat2 = radians(b.latitude);
    const deltaLat = radians(b.latitude - a.latitude);
    const deltaLon = radians(b.longitude - a.longitude);
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function distanceToLineMetres(point, coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return Infinity;
    const latitudeScale = 111320;
    const longitudeScale = Math.cos(point.latitude * Math.PI / 180) * 111320;
    const px = point.longitude * longitudeScale;
    const py = point.latitude * latitudeScale;
    let minimum = Infinity;

    for (let index = 1; index < coordinates.length; index += 1) {
      const [lon1, lat1] = coordinates[index - 1];
      const [lon2, lat2] = coordinates[index];
      const x1 = lon1 * longitudeScale;
      const y1 = lat1 * latitudeScale;
      const x2 = lon2 * longitudeScale;
      const y2 = lat2 * latitudeScale;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      const ratio = lengthSquared ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared)) : 0;
      minimum = Math.min(minimum, Math.hypot(px - (x1 + ratio * dx), py - (y1 + ratio * dy)));
    }
    return minimum;
  }

  function pointInPolygon(point, coordinates) {
    let inside = false;
    for (let index = 0, previous = coordinates.length - 1; index < coordinates.length; previous = index++) {
      const xi = Number(coordinates[index][0]);
      const yi = Number(coordinates[index][1]);
      const xj = Number(coordinates[previous][0]);
      const yj = Number(coordinates[previous][1]);
      const intersects = yi > point.latitude !== yj > point.latitude &&
        point.longitude < (xj - xi) * (point.latitude - yi) / ((yj - yi) || Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function eventColor(type) {
    return ({
      departed: "#22c55e",
      moored: "#22c55e",
      anchored: "#22c55e",
      note: "#3b82f6",
      disturbance: "#ef4444",
      fuel: "#f8fafc",
      automatic_place: "#f59e0b"
    })[type] || "#94a3b8";
  }

  function placeStyle(type) {
    const color = ({
      island: "#f59e0b",
      harbour: "#38bdf8",
      canal: "#a78bfa",
      bridge: "#f97316",
      ferry: "#ec4899",
      anchorage: "#22c55e"
    })[type] || "#eab308";
    return { color, fillColor: color, fillOpacity: 0.12, weight: 2 };
  }

  function placeTypeLabel(type) {
    return ({
      island: "Saari",
      harbour: "Satama",
      canal: "Kanava",
      bridge: "Silta",
      ferry: "Lossi",
      anchorage: "Ankkuripaikka",
      other: "Muu paikka"
    })[type] || "Paikka";
  }

  function nullableNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function newId(prefix) {
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${id}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  window.addEventListener("online", applyLayerVisibility);
  window.addEventListener("offline", applyLayerVisibility);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPending();
  });

  return {
    initialise,
    onViewActive,
    onState,
    onGps,
    flushPending,
    finishTrip,
    configureOnlineLayers,
    __test: Object.freeze({
      normalisePoint,
      distanceMetres,
      distanceToLineMetres,
      pointInPolygon,
      isInsidePlace,
      routeDistanceKm
    })
  };
})();
