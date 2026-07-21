(() => {
  const APP_VERSION = "0.3.0";
  const OFFLINE_READY_VERSION_KEY = "veneloki.offlineReadyVersion";
  let state = VenelokiStorage.getState();
  let activeView = "log";
  let dialogBusy = false;
  let gpsWatchId = null;
  let syncRunning = false;
  let syncTimer = null;
  // iPadOS voi split screenissä lähettää virheellisiä online-tapahtumia.
  // Offline-tilassa alkanut istunto ei siksi saa vapauttaa verkkolukkoa
  // automaattisesti ennen sovelluksen seuraavaa avausta.
  let automaticSyncPaused = !navigator.onLine;
  let lastSyncError = null;
  let serviceWorkerRegistration = null;
  let serviceWorkerInitialising = false;
  let serviceWorkerControllerListenerAdded = false;

  const gpsState = {
    position: null,
    error: null
  };

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
    mapBaseLayerInput: document.getElementById("mapBaseLayerInput"),
    mmlApiKeyInput: document.getElementById("mmlApiKeyInput"),
    repairStateButton: document.getElementById("repairStateButton"),
    repairStateResult: document.getElementById("repairStateResult"),
    offlineReadiness: document.getElementById("offlineReadiness"),
    prepareOfflineButton: document.getElementById("prepareOfflineButton"),
    dialog: document.getElementById("formDialog"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogFields: document.getElementById("dialogFields"),
    dialogForm: document.getElementById("dialogForm"),
    dialogSubmit: document.getElementById("dialogSubmit"),
    dialogCancel: document.getElementById("dialogCancel"),
    gpsBadge: document.getElementById("gpsBadge"),
    syncBadge: document.getElementById("syncBadge"),
    connectionState: document.getElementById("connectionState")
  };

  function newId() {
    return globalThis.crypto?.randomUUID?.() || `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function setOfflineReadiness(message, status = "") {
    if (!elements.offlineReadiness) return;
    elements.offlineReadiness.textContent = message;
    elements.offlineReadiness.className = `settings-result${status ? ` ${status}` : ""}`;
  }

  function sendServiceWorkerMessage(worker, message, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => {
        channel.port1.close();
        reject(new Error("Offline-tiedostojen tallennus aikakatkaistiin."));
      }, timeoutMs);

      channel.port1.onmessage = event => {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data || {});
      };

      worker.postMessage(message, [channel.port2]);
    });
  }

  async function prepareOfflineUse() {
    if (!("serviceWorker" in navigator)) {
      setOfflineReadiness("Tämä selain ei tue offline-käyttöä.", "error");
      return false;
    }

    if (!navigator.onLine) {
      setOfflineReadiness("Offline-käyttö aktiivinen. Valmistelu jatkuu, kun verkkoyhteys palautuu.", "success");
      return true;
    }

    if (elements.prepareOfflineButton) elements.prepareOfflineButton.disabled = true;
    setOfflineReadiness("Tallennetaan sovellusta offline-käyttöön…");

    try {
      const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready;
      serviceWorkerRegistration = registration;
      const worker = navigator.serviceWorker.controller || registration.active;

      if (!worker) {
        throw new Error("Offline-palvelu ei ole vielä aktivoitunut. Sulje sovellus ja avaa se verkkoyhteydellä uudelleen.");
      }

      const result = await sendServiceWorkerMessage(worker, { type: "CACHE_APP_SHELL" });
      if (!result.ok) throw new Error(result.error || "Offline-tiedostojen tallennus epäonnistui.");

      localStorage.setItem(OFFLINE_READY_VERSION_KEY, APP_VERSION);

      if (!navigator.serviceWorker.controller) {
        setOfflineReadiness(
          "Offline-tiedostot on tallennettu. Sulje sovellus kerran ja avaa se uudelleen verkkoyhteydellä.",
          "success"
        );
      } else {
        setOfflineReadiness("Offline-käyttö valmis.", "success");
      }
      return true;
    } catch (error) {
      console.error(error);
      setOfflineReadiness(error?.message || "Offline-käytön valmistelu epäonnistui.", "error");
      return false;
    } finally {
      if (elements.prepareOfflineButton) elements.prepareOfflineButton.disabled = false;
    }
  }

  function save() {
    try {
      VenelokiStorage.saveState(state);
      setSyncStatus(VenelokiApi.isConfigured() ? "pending" : "local");
      render();
      scheduleSync();
    } catch (error) {
      setSyncStatus("error");
      console.error(error);
      throw new Error("Tallennus epäonnistui. Laitteen paikallinen tallennustila voi olla täynnä.");
    }
  }

  function queueOperation(type, payload) {
    const operation = VenelokiStorage.createOperation(type, payload);
    VenelokiStorage.enqueue(operation);
    return operation;
  }

  function gpsPayload(gps) {
    if (!gps) return {};
    return {
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracyM: gps.accuracy,
      speedMs: gps.speed,
      headingDeg: gps.heading,
      altitudeM: gps.altitude
    };
  }

  function routePointPayload(point) {
    return {
      pointId: point.pointId || newId(),
      recordedAt: point.recordedAt || point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyM: point.accuracyM ?? point.accuracy,
      speedMs: point.speedMs ?? point.speed,
      headingDeg: point.headingDeg ?? point.heading,
      altitudeM: point.altitudeM ?? point.altitude
    };
  }

  function scheduleSync(delay = 300) {
    if (!VenelokiApi.isConfigured()) return;
    if (automaticSyncPaused) {
      setSyncStatus("pending", "Automaattinen synkronointi odottaa toimivaa verkkoyhteyttä. Kirjaukset säilyvät jonossa.");
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus("pending", "Ei verkkoyhteyttä. Kirjaukset säilyvät jonossa.");
      return;
    }
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      syncNow();
    }, delay);
  }

  function mergeRemoteState(remoteState, { force = false } = {}) {
    if (!remoteState || typeof remoteState !== "object") {
      throw new Error("Palvelin palautti virheellisen tilan.");
    }

    const remoteHasData = Boolean(
      remoteState.activeTrip ||
      remoteState.log?.length ||
      remoteState.boatEvents?.length ||
      remoteState.routePoints?.length ||
      remoteState.engineHours !== null && remoteState.engineHours !== undefined
    );
    const localHasData = Boolean(
      state.activeTrip || state.log.length || state.boatEvents.length || state.routePoints?.length || state.engineHours !== null
    );

    if (!force && !remoteHasData && localHasData) {
      VenelokiStorage.backupState(state);
      return false;
    }

    const localLog = new Map(state.log.map(item => [String(item.id), item]));
    const localBoatEvents = new Map(state.boatEvents.map(item => [String(item.id), item]));
    const localRoutePoints = new Map((state.routePoints || []).map(item => [String(item.pointId || ""), item]));
    const mergePhotos = (item, local) => {
      const localItem = local.get(String(item.id));
      const localPhotos = normalisePhotos(localItem?.photos);
      return {
        ...item,
        photos: localPhotos,
        hasPhoto: Boolean(item.hasPhoto || localPhotos.length)
      };
    };

    const mergedRoutePoints = Array.isArray(remoteState.routePoints)
      ? remoteState.routePoints.map(item => ({ ...item, queued: true }))
      : [];
    const remotePointIds = new Set(mergedRoutePoints.map(item => String(item.pointId || "")));
    localRoutePoints.forEach((item, id) => {
      if (id && !remotePointIds.has(id)) mergedRoutePoints.push(item);
    });
    mergedRoutePoints.sort((left, right) => (
      new Date(left.recordedAt || left.timestamp || 0).getTime() -
      new Date(right.recordedAt || right.timestamp || 0).getTime()
    ));

    state = {
      activeTrip: remoteState.activeTrip || null,
      log: Array.isArray(remoteState.log)
        ? remoteState.log.map(item => mergePhotos(item, localLog))
        : [],
      boatEvents: Array.isArray(remoteState.boatEvents)
        ? remoteState.boatEvents.map(item => mergePhotos(item, localBoatEvents))
        : [],
      engineHours: remoteState.engineHours === null || remoteState.engineHours === undefined
        ? null
        : Number(remoteState.engineHours),
      routePoints: mergedRoutePoints,
      places: Array.isArray(remoteState.places) ? remoteState.places : (state.places || []),
      placeVisits: state.placeVisits || {}
    };
    VenelokiStorage.saveState(state);
    render();
    return true;
  }

  function remoteStateHasData(remoteState) {
    return Boolean(
      remoteState?.activeTrip ||
      remoteState?.log?.length ||
      remoteState?.boatEvents?.length ||
      remoteState?.routePoints?.length ||
      remoteState?.engineHours !== null && remoteState?.engineHours !== undefined
    );
  }

  function parseLegacyFuel(item) {
    const lines = String(item.details || "").split(/\r?\n/);
    const numberAt = index => fuelNumber(lines[index]?.match(/[\d.,]+/)?.[0] || "");
    const litres = numberAt(0);
    const total = numberAt(1);
    const unit = numberAt(2);

    if (!(litres > 0) || total === null && unit === null) return null;
    return {
      litres,
      priceTotal: total !== null ? total : litres * unit,
      pricePerLitre: unit !== null ? unit : total / litres,
      fillType: /osatankkaus/i.test(item.details || "") ? "partial" : "full"
    };
  }

  function queueActiveTripSnapshot(sourceState, { includeStart = true, remoteEventIds = new Set() } = {}) {
    if (!sourceState.activeTrip) return 0;

    const trip = sourceState.activeTrip;
    const entries = [...sourceState.log].sort((left, right) => (
      new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime()
    ));
    const startEntry = entries.find(item => item.type === "trip_start");
    const startTime = startEntry?.timestamp || trip.startedAt || new Date().toISOString();
    let queuedCount = 0;

    if (includeStart) {
      queueOperation("trip.start", {
        tripId: trip.id,
        eventId: startEntry?.id || newId(),
        eventTime: startTime,
        crew: trip.crew || "Ei tietoa",
        startNotes: trip.notes || "",
        ...gpsPayload(startEntry?.gps)
      });
      queuedCount += 1;
    }

    entries.forEach(item => {
      if (item.type === "trip_start" || item.type === "trip_end") return;
      if (remoteEventIds.has(String(item.id))) return;

      const common = {
        eventId: item.id,
        eventTime: item.timestamp,
        ...gpsPayload(item.gps)
      };

      if (["departed", "moored", "anchored"].includes(item.type)) {
        queueOperation(`event.${item.type}`, {
          ...common,
          legId: item.type === "departed" ? `leg_${item.id}` : undefined,
          placeName: entryPlace(item),
          text: item.details || ""
        });
        queuedCount += 1;
        return;
      }

      if (["note", "disturbance"].includes(item.type)) {
        queueOperation(`event.${item.type}`, {
          ...common,
          text: item.details || "",
          photoCount: normalisePhotos(item.photos).length
        });
        queuedCount += 1;
        return;
      }

      if (item.type === "automatic_place") {
        queueOperation("event.automaticPlace", {
          ...common,
          placeId: item.matchedPlaceId || "",
          placeName: entryPlace(item) || item.place || item.title || "Paikka",
          enteredAt: item.automaticEnteredAt || item.timestamp,
          exitedAt: item.automaticExitedAt || item.timestamp
        });
        queuedCount += 1;
        return;
      }

      if (item.type === "fuel") {
        const fuel = parseLegacyFuel(item);
        if (!fuel) return;
        const boatEvent = sourceState.boatEvents.find(candidate => (
          candidate.type === "fuel" && candidate.timestamp === item.timestamp
        ));
        queueOperation("fuel.add", {
          ...common,
          ...fuel,
          fuelId: newId(),
          boatEventId: boatEvent?.id || newId(),
          tripId: trip.id,
          fuelTime: item.timestamp,
          placeName: entryPlace(item),
          engineHours: "",
          notes: ""
        });
        queuedCount += 1;
      }
    });

    const routePoints = (sourceState.routePoints || [])
      .filter(point => String(point.tripId || trip.id) === String(trip.id));
    for (let index = 0; index < routePoints.length; index += 200) {
      queueOperation("gps.batch", {
        batchId: `gpsbatch_${newId()}`,
        tripId: trip.id,
        points: routePoints.slice(index, index + 200).map(routePointPayload)
      });
      queuedCount += 1;
    }

    return queuedCount;
  }

  function queueLegacyActiveTrip() {
    if (!state.activeTrip || VenelokiStorage.getQueue().length) return false;
    VenelokiStorage.backupState(state);
    return queueActiveTripSnapshot(state) > 0;
  }

  async function syncNow({ pull = true } = {}) {
    if (syncRunning || !VenelokiApi.isConfigured()) return false;
    if (!navigator.onLine) {
      lastSyncError = new Error("Ei verkkoyhteyttä.");
      setSyncStatus("pending", "Ei verkkoyhteyttä. Kirjaukset säilyvät jonossa.");
      return false;
    }

    syncRunning = true;
    lastSyncError = null;
    setSyncStatus("syncing");

    try {
      let queue = VenelokiStorage.getQueue();

      if (!queue.length && state.activeTrip && pull) {
        const remoteBeforeSync = await VenelokiApi.getState();
        queue = VenelokiStorage.getQueue();

        // Käyttäjä voi tehdä kirjauksen samalla, kun palvelimen tilaa luetaan.
        // Tällöin paikallista reaaliaikaista tilaa ei saa korvata juuri ennen
        // pyyntöä muodostetulla, jo vanhentuneella palvelintilalla.
        if (!queue.length) {
          if (remoteStateHasData(remoteBeforeSync)) {
            mergeRemoteState(remoteBeforeSync);
            setSyncStatus("synced");
            return true;
          }
          queueLegacyActiveTrip();
          queue = VenelokiStorage.getQueue();
        }
      }

      while (queue.length) {
        const operation = queue[0];
        await VenelokiApi.syncOperation(operation);
        VenelokiStorage.removeQueued(operation.id);
        queue = VenelokiStorage.getQueue();
        setSyncStatus(queue.length ? "syncing" : "synced");
      }

      if (pull) {
        const remoteState = await VenelokiApi.getState();

        // state.get-pyynnön aikana syntynyt uusi kirjaus on jo paikallisessa
        // näkymässä ja jonossa. Lähetä se seuraavalla kierroksella ennen kuin
        // palvelimen tila yhdistetään takaisin käyttöliittymään.
        if (VenelokiStorage.getQueue().length) {
          setSyncStatus("pending", "Uusi paikallinen kirjaus odottaa taustasynkronointia.");
          return true;
        }

        const merged = mergeRemoteState(remoteState);
        if (!merged) {
          setSyncStatus("local", "Google Sheets oli tyhjä. Aiemmat paikalliset tiedot säilytettiin laitteella.");
          return true;
        }
      }

      setSyncStatus("synced");
      return true;
    } catch (error) {
      lastSyncError = error;
      console.error(error);
      if (error?.isNetworkError) {
        automaticSyncPaused = true;
        setSyncStatus(
          "pending",
          "Verkkoyhteyttä ei saatu. Uusia automaattisia yhteysyrityksiä ei tehdä ennen yhteyden palautumista tai sovelluksen uudelleenavausta."
        );
      } else {
        setSyncStatus("error", error?.message || "Synkronointi epäonnistui.");
      }
      return false;
    } finally {
      syncRunning = false;

      // Jos käyttäjä kirjasi jotain käynnissä olevan synkronoinnin aikana,
      // aiempi ajastettu kutsu on voinut osua syncRunning-tilaan. Varmista,
      // että uusi jonosisältö saa aina oman taustasynkronointikierroksensa.
      if (
        !lastSyncError &&
        VenelokiStorage.getQueue().length &&
        VenelokiApi.isConfigured() &&
        navigator.onLine &&
        !automaticSyncPaused
      ) {
        scheduleSync(0);
      }
    }
  }

  function isTripScopedOperation(operation) {
    const type = String(operation?.type || "");
    return type.startsWith("trip.") ||
      type.startsWith("event.") ||
      type === "gps.batch" ||
      type === "fuel.add" && Boolean(operation?.payload?.tripId);
  }

  function enqueueFreshOperation(operation) {
    const fresh = VenelokiStorage.createOperation(operation.type, operation.payload || {});
    VenelokiStorage.enqueue(fresh);
    return fresh;
  }

  function queuePendingOperationsForRemote(originalQueue, remoteState, { includeCreates = false } = {}) {
    const remoteTripId = String(remoteState?.activeTrip?.id || "");
    if (!remoteTripId) return 0;

    const remoteEventIds = new Set((remoteState.log || []).map(item => String(item.id)));
    const createTypes = new Set([
      "event.departed",
      "event.moored",
      "event.anchored",
      "event.note",
      "event.disturbance",
      "fuel.add"
    ]);
    let queuedCount = 0;

    originalQueue.forEach(operation => {
      const type = String(operation?.type || "");
      const payload = operation?.payload || {};

      if (type === "trip.start") return;

      if (type === "trip.end") {
        if (String(payload.tripId || "") === remoteTripId) {
          enqueueFreshOperation(operation);
          queuedCount += 1;
        }
        return;
      }

      if (type === "gps.batch") {
        if (String(payload.tripId || "") === remoteTripId) {
          enqueueFreshOperation(operation);
          queuedCount += 1;
        }
        return;
      }

      if (type === "event.update" || type === "event.delete") {
        enqueueFreshOperation(operation);
        queuedCount += 1;
        return;
      }

      if (!includeCreates || !createTypes.has(type)) return;
      if (type === "fuel.add" && String(payload.tripId || "") !== remoteTripId) return;
      if (payload.eventId && remoteEventIds.has(String(payload.eventId))) return;

      enqueueFreshOperation(operation);
      queuedCount += 1;
    });

    return queuedCount;
  }

  function setRepairResult(message, status = "") {
    if (!elements.repairStateResult) return;
    elements.repairStateResult.textContent = message;
    elements.repairStateResult.className = `settings-result${status ? ` ${status}` : ""}`;
  }

  function sameIdSet(left, right) {
    if (left.size !== right.size) return false;
    return [...left].every(id => right.has(id));
  }

  async function repairCurrentTripState() {
    if (!VenelokiApi.isConfigured()) {
      setRepairResult("Anna ensin API-osoite ja API-avain.", "error");
      return;
    }
    if (!navigator.onLine) {
      setRepairResult("Tilan tarkistus tarvitsee verkkoyhteyden.", "error");
      return;
    }

    if (syncRunning) {
      setRepairResult("Odota nykyisen synkronoinnin valmistumista ja yritä uudelleen.", "error");
      return;
    }

    elements.repairStateButton.disabled = true;
    setRepairResult("Tarkistetaan laitteen ja Google Sheetsin tilaa…");

    try {
      const remoteState = await VenelokiApi.getState();
      const localSnapshot = JSON.parse(JSON.stringify(state));
      const originalQueue = VenelokiStorage.getQueue();
      const tripQueue = originalQueue.filter(isTripScopedOperation);
      const globalQueue = originalQueue.filter(operation => !isTripScopedOperation(operation));
      const localTripId = String(localSnapshot.activeTrip?.id || "");
      const remoteTripId = String(remoteState.activeTrip?.id || "");
      const localEventIds = new Set((localSnapshot.log || []).map(item => String(item.id)));
      const remoteEventIds = new Set((remoteState.log || []).map(item => String(item.id)));

      if (localTripId && remoteTripId && localTripId !== remoteTripId) {
        throw new Error(
          "Laitteella ja Sheetsissä on eri aktiiviset matkat. Automaattista ylikirjoitusta ei tehty, jotta kumpikaan matka ei katoa."
        );
      }

      const activeTripsMatch = localTripId === remoteTripId;
      const eventListsMatch = sameIdSet(localEventIds, remoteEventIds);
      if (activeTripsMatch && eventListsMatch && tripQueue.length === 0) {
        mergeRemoteState(remoteState, { force: true });
        setRepairResult("Tila on kunnossa. Korjattavaa ei löytynyt.", "success");
        return;
      }

      let confirmation;
      if (localTripId && !remoteTripId) {
        confirmation =
          `Sheetsistä puuttuu laitteella aktiivinen matka. Matka ja sen ${localSnapshot.log.length} lokikirjausta kirjoitetaan uudelleen Sheetiin.\n\n` +
          "Nykyisestä paikallisesta tilasta ja jonosta tallennetaan ensin varmuuskopio. Jatketaanko?";
      } else if (!localTripId && remoteTripId) {
        confirmation =
          `Sheetsissä on aktiivinen matka, mutta laitteella ei. Sheetin matka palautetaan laitteelle ja ${tripQueue.length} vanhaa matkajonon tapahtumaa tarkistetaan.\n\n` +
          "Nykyisestä paikallisesta tilasta ja jonosta tallennetaan ensin varmuuskopio. Jatketaanko?";
      } else if (!localTripId && !remoteTripId) {
        confirmation =
          `Aktiivista matkaa ei ole laitteella eikä Sheetsissä. ${tripQueue.length} vanhaan matkaan viittaavaa jonotapahtumaa poistetaan aktiivisesta jonosta.\n\n` +
          "Nykyisestä paikallisesta tilasta ja jonosta tallennetaan ensin varmuuskopio. Jatketaanko?";
      } else {
        confirmation =
          `Aktiivinen matka on sama, mutta lokissa tai synkronointijonossa on eroja. Puuttuvat kirjaukset lähetetään uudelleen ja tila luetaan Sheetsistä.\n\n` +
          "Nykyisestä paikallisesta tilasta ja jonosta tallennetaan ensin varmuuskopio. Jatketaanko?";
      }

      if (!window.confirm(confirmation)) {
        setRepairResult("Tarkistus peruttiin. Mitään ei muutettu.");
        return;
      }

      VenelokiStorage.backupForRepair(localSnapshot, originalQueue);
      VenelokiStorage.replaceQueue(globalQueue);

      let rebuiltCount = 0;
      if (localTripId) {
        rebuiltCount += queueActiveTripSnapshot(localSnapshot, {
          includeStart: !remoteTripId,
          remoteEventIds
        });
        rebuiltCount += queuePendingOperationsForRemote(originalQueue, remoteState);
      } else if (remoteTripId) {
        rebuiltCount += queuePendingOperationsForRemote(originalQueue, remoteState, {
          includeCreates: true
        });
      }

      if (VenelokiStorage.getQueue().length) {
        const ok = await syncNow();
        if (!ok) {
          throw lastSyncError || new Error("Korjattujen tietojen synkronointi epäonnistui.");
        }
      } else {
        mergeRemoteState(remoteState, { force: true });
        setSyncStatus("synced");
      }

      if (!localTripId && !remoteTripId) {
        setRepairResult(
          `Tila korjattu. Aktiivista matkaa ei ole ja ${tripQueue.length} vanhaa jonotapahtumaa poistettiin käytöstä.`,
          "success"
        );
      } else if (localTripId && !remoteTripId) {
        setRepairResult(
          `Tila korjattu. Aktiivinen matka kirjoitettiin uudelleen Sheetiin (${rebuiltCount} synkronointitoimintoa).`,
          "success"
        );
      } else {
        setRepairResult("Tila korjattu ja tarkistettu Google Sheetsistä.", "success");
      }
    } catch (error) {
      console.error(error);
      setRepairResult(error?.message || "Tilan korjaus epäonnistui.", "error");
    } finally {
      elements.repairStateButton.disabled = false;
    }
  }

  function switchView(viewName) {
    activeView = viewName;
    elements.tabs.forEach(button => button.classList.toggle("active", button.dataset.view === viewName));
    elements.views.forEach(view => view.classList.toggle("active", view.id === `view-${viewName}`));
    if (viewName === "map") VenelokiMap?.onViewActive?.();
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

  function eventTypeLabel(type) {
    return {
      departed: "Irti",
      moored: "Kiinni",
      anchored: "Ankkurissa",
      note: "Oma kirjaus",
      disturbance: "Häiriö",
      fuel: "Tankkaus",
      automatic_place: "Automaattinen paikka",
      trip_start: "Matka aloitettu",
      trip_end: "Matka päätetty"
    }[type] || "Kirjaus";
  }

  function formatStatusTime(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    const pad = value => String(value).padStart(2, "0");
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatFullTime(value, fallback = "–") {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("fi-FI", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function isUnderway() {
    return state.activeTrip?.vesselStatus === "underway";
  }

  function commandAllowed(type) {
    if (!state.activeTrip) return false;
    if (type === "departed") return !isUnderway();
    if (type === "moored" || type === "anchored") return isUnderway();
    return true;
  }

  function logSummary(item) {
    const details = String(item.details || "").trim();
    if (!details) return "";

    // Tankkauksen kaikki tiedot säilyvät tietonäkymässä, mutta lokilistassa
    // riittää ensimmäinen tietorivi eli litramäärä.
    return item.type === "fuel" ? details.split(/\r?\n/, 1)[0] : details;
  }

  function renderLog() {
    if (!state.log.length) {
      elements.logList.innerHTML = '<div class="empty-state">Ei kirjauksia.</div>';
      return;
    }

    elements.logList.innerHTML = [...state.log].reverse().map(item => {
      const photos = normalisePhotos(item.photos);
      const hasPhoto = photos.length > 0 || item.hasPhoto;
      const summary = logSummary(item);
      return `
        <div class="log-item" data-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Avaa kirjauksen tiedot: ${escapeHtml(item.title)}">
          <div class="log-row">
            <span class="log-dot" style="background:${eventColor(item.type)}"></span>
            <span class="log-time">${escapeHtml(item.time)}</span>
            <span class="log-title">${escapeHtml(item.title)}</span>
            <span class="log-photo-indicator" aria-label="${hasPhoto ? "Sisältää kuvan" : ""}">${hasPhoto ? "📷" : ""}</span>
          </div>
          ${summary ? `<div class="log-summary">${escapeHtml(summary)}</div>` : ""}
        </div>
      `;
    }).join("");

    elements.logList.querySelectorAll(".log-item").forEach(element => {
      const id = element.dataset.id;
      bindPressActions(
        element,
        () => openEntryDetail(id, "log"),
        () => editLogEntry(id)
      );
    });
  }

  function renderBoatEvents() {
    const events = [...state.boatEvents].reverse().slice(0, 5);
    if (!events.length) {
      elements.boatEventList.innerHTML = '<div class="empty-state">Ei tapahtumia.</div>';
      return;
    }

    elements.boatEventList.innerHTML = events.map(item => `
      <div class="log-item boat-event-item" data-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Avaa tapahtuman tiedot: ${escapeHtml(item.title)}">
        <div class="log-row">
          <span class="log-dot" style="background:${eventColor(item.type)}"></span>
          <span class="log-time">${escapeHtml(item.date)}</span>
          <span class="log-title">${escapeHtml(item.title)}</span>
          <span></span>
        </div>
        ${item.details ? `<div class="log-summary">${escapeHtml(item.details)}</div>` : ""}
      </div>
    `).join("");

    elements.boatEventList.querySelectorAll(".log-item").forEach(element => {
      const id = element.dataset.id;
      bindPressActions(
        element,
        () => openEntryDetail(id, "boat"),
        () => editBoatEvent(id)
      );
    });
  }

  function renderActionButtons() {
    const departureButton = document.getElementById("departureButton");
    const arrivalButton = document.getElementById("arrivalButton");
    const anchorButton = document.getElementById("anchorButton");

    if (departureButton) {
      departureButton.disabled = !commandAllowed("departed");
    }
    if (arrivalButton) {
      arrivalButton.disabled = !commandAllowed("moored");
    }
    if (anchorButton) {
      anchorButton.disabled = !commandAllowed("anchored");
    }
  }

  function render() {
    const trip = state.activeTrip;
    elements.startTripButton.classList.toggle("hidden", Boolean(trip));
    elements.activeTripControls.classList.toggle("hidden", !trip);

    if (trip) {
      elements.vesselState.textContent = isUnderway() ? "MATKALLA" : "KIINNITTYNEENÄ";
      elements.tripMeta.textContent = formatStatusTime(trip.lastStatusAt || trip.startedAt);
    } else {
      elements.vesselState.textContent = "EI AKTIIVISTA MATKAA";
      elements.tripMeta.textContent = "Aloita uusi matka.";
    }

    elements.engineHoursValue.textContent = state.engineHours === null
      ? "–"
      : `${Number(state.engineHours).toFixed(1).replace(".", ",")} h`;

    renderLog();
    renderActionButtons();
    renderBoatEvents();
    VenelokiMap?.onState?.(state);
    switchView(activeView);
  }

  function addLog(type, title, details = "", metadata = {}) {
    const now = metadata.timestamp ? new Date(metadata.timestamp) : new Date();
    const gps = Object.prototype.hasOwnProperty.call(metadata, "gps")
      ? metadata.gps
      : latestGpsForEvent();
    const photos = normalisePhotos(metadata.photos);

    const item = {
      id: metadata.id || newId(),
      type,
      title,
      details,
      place: metadata.place || "",
      time: now.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" }),
      timestamp: now.toISOString(),
      gps,
      source: metadata.source || "Manuaalinen kirjaus",
      matchedPlaceId: metadata.matchedPlaceId || "",
      automaticEnteredAt: metadata.automaticEnteredAt || "",
      automaticExitedAt: metadata.automaticExitedAt || "",
      photos,
      hasPhoto: photos.length > 0
    };
    state.log.push(item);
    return item;
  }

  function ensureDialogControls() {
    let actions = elements.dialogForm.querySelector(".dialog-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "dialog-actions";
      elements.dialogForm.append(actions);
    }

    if (!elements.dialogSubmit) {
      elements.dialogSubmit = actions.querySelector('button[type="submit"]:not([formmethod="dialog"])');
    }
    if (!elements.dialogSubmit) {
      elements.dialogSubmit = document.createElement("button");
      elements.dialogSubmit.id = "dialogSubmit";
      elements.dialogSubmit.type = "submit";
      elements.dialogSubmit.className = "primary-button";
      actions.append(elements.dialogSubmit);
    }

    if (!elements.dialogCancel) {
      elements.dialogCancel = actions.querySelector(
        '[data-dialog-cancel], [formmethod="dialog"], button[value="cancel"], .cancel-button'
      );
    }
    if (!elements.dialogCancel) {
      elements.dialogCancel = document.createElement("button");
      elements.dialogCancel.id = "dialogCancel";
      elements.dialogCancel.className = "secondary-button";
      actions.prepend(elements.dialogCancel);
    }

    elements.dialogCancel.type = "button";
    elements.dialogCancel.removeAttribute("formmethod");
    elements.dialogCancel.addEventListener("click", closeDialog);
  }

  function configureDialog({ submitLabel = "Tallenna", cancelLabel = "Peruuta", detail = false } = {}) {
    ensureDialogControls();
    elements.dialogSubmit.hidden = detail;
    elements.dialogSubmit.disabled = false;
    elements.dialogSubmit.textContent = submitLabel;
    elements.dialogCancel.textContent = cancelLabel;
    elements.dialog.classList.toggle("detail-dialog", detail);
  }

  function showDialog() {
    if (elements.dialog.open) elements.dialog.close();
    elements.dialog.showModal();
    requestAnimationFrame(() => {
      elements.dialog.scrollTop = 0;
      elements.dialog.querySelector("input:not([type='hidden']), textarea, select, button")?.focus({ preventScroll: true });
    });
  }

  function closeDialog() {
    dialogBusy = false;
    if (elements.dialogSubmit) elements.dialogSubmit.disabled = false;
    if (elements.dialog.open) elements.dialog.close();
  }

  function formValues(formData) {
    const result = {};
    for (const [key, value] of formData.entries()) {
      if (typeof File !== "undefined" && value instanceof File) continue;
      result[key] = value;
    }
    return result;
  }

  function openForm(title, fields, onSubmit, options = {}) {
    dialogBusy = false;
    elements.dialogTitle.textContent = title;
    elements.dialogFields.innerHTML = fields;
    configureDialog(options);

    elements.dialogForm.onsubmit = async event => {
      event.preventDefault();
      if (dialogBusy) return;

      dialogBusy = true;
      elements.dialogSubmit.disabled = true;
      const originalLabel = elements.dialogSubmit.textContent;
      elements.dialogSubmit.textContent = "Tallennetaan…";

      try {
        const data = new FormData(elements.dialogForm);
        await onSubmit(formValues(data), data);
        closeDialog();
      } catch (error) {
        console.error(error);
        alert(error?.message || "Tallennus epäonnistui.");
        dialogBusy = false;
        elements.dialogSubmit.disabled = false;
        elements.dialogSubmit.textContent = originalLabel;
      }
    };

    showDialog();
  }

  async function startTrip() {
    openForm("Aloita matka", `
      <label>Miehistö<input name="crew" required></label>
      <label>Lisätiedot<textarea name="notes"></textarea></label>
    `, values => {
      const now = new Date();
      const tripId = newId();
      state.activeTrip = {
        id: tripId,
        crew: values.crew,
        notes: values.notes,
        startedAt: now.toISOString(),
        vesselStatus: "moored",
        lastStatusAt: now.toISOString()
      };
      state.log = [];
      state.routePoints = [];
      state.placeVisits = {};
      const logItem = addLog(
        "trip_start",
        "Matka aloitettu",
        `Miehistö: ${values.crew}${values.notes ? `\n${values.notes}` : ""}`
      );
      queueOperation("trip.start", {
        tripId,
        eventId: logItem.id,
        eventTime: logItem.timestamp,
        crew: values.crew,
        startNotes: values.notes,
        ...gpsPayload(logItem.gps)
      });
      save();
    });
  }

  function statusEvent(type, label, vesselStatus) {
    if (!commandAllowed(type)) return;

    openForm(label, `
      <label>Paikka tai lisätieto, vapaaehtoinen<input name="place"></label>
      <label>Lisätieto, vapaaehtoinen<textarea name="text"></textarea></label>
    `, values => {
      if (!commandAllowed(type)) return;
      const place = values.place.trim();
      const title = place ? `${label} – ${place}` : label;
      const logItem = addLog(type, title, values.text, { place });
      state.activeTrip.vesselStatus = vesselStatus;
      state.activeTrip.lastStatusAt = logItem.timestamp;
      VenelokiMap?.flushPending?.();
      queueOperation(`event.${type}`, {
        eventId: logItem.id,
        legId: type === "departed" ? `leg_${logItem.id}` : undefined,
        eventTime: logItem.timestamp,
        placeName: place,
        text: values.text,
        ...gpsPayload(logItem.gps)
      });
      save();
    });
  }

  function textEvent(type, title) {
    if (!state.activeTrip) return;

    openForm(title, `
      <label>Teksti<textarea name="text" required></textarea></label>
      <label>Lisää kuva
        <input name="photos" type="file" accept="image/*" capture="environment" multiple>
        <span class="field-help">Voit liittää enintään viisi kuvaa.</span>
      </label>
    `, async (values, data) => {
      const photos = await filesToPhotos(data.getAll("photos"));
      const logItem = addLog(type, title, values.text, { photos });
      queueOperation(`event.${type}`, {
        eventId: logItem.id,
        eventTime: logItem.timestamp,
        text: values.text,
        photoCount: photos.length,
        ...gpsPayload(logItem.gps)
      });
      save();
    });
  }

  function addAutomaticPlaceEvent({ place, eventTime, enteredAt, exitedAt, gps }) {
    if (!state.activeTrip || !place) return null;
    const displayName = String(place.displayName || place.internalName || "Paikka");
    const logItem = addLog(
      "automatic_place",
      displayName,
      "Automaattinen paikkakirjaus",
      {
        timestamp: eventTime,
        gps,
        place: displayName,
        source: "Automaattinen kirjaus",
        matchedPlaceId: place.placeId,
        automaticEnteredAt: enteredAt,
        automaticExitedAt: exitedAt
      }
    );
    queueOperation("event.automaticPlace", {
      eventId: logItem.id,
      eventTime: logItem.timestamp,
      placeId: place.placeId,
      placeName: displayName,
      enteredAt,
      exitedAt,
      ...gpsPayload(logItem.gps)
    });
    VenelokiStorage.saveState(state);
    render();
    scheduleSync();
    return logItem;
  }

  function endTrip() {
    if (!state.activeTrip) return;
    openForm("Päätä matka", '<label>Loppuhuomautus<textarea name="notes"></textarea></label>', values => {
      VenelokiMap?.finishTrip?.();
      const tripId = state.activeTrip.id;
      const logItem = addLog("trip_end", "Matka päätetty", values.notes);
      queueOperation("trip.end", {
        tripId,
        eventId: logItem.id,
        eventTime: logItem.timestamp,
        endNotes: values.notes,
        engineHours: state.engineHours,
        ...gpsPayload(logItem.gps)
      });
      state.activeTrip = null;
      save();
    });
  }

  function fuelNumber(value) {
    if (typeof value === "string" && !value.trim()) return null;
    const number = Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : null;
  }

  function fuelInputValue(value, decimals) {
    return Number(value).toFixed(decimals);
  }

  function newFuel() {
    let priceSource = "";

    openForm("Uusi tankkaus", `
      <label>Paikka<input name="place"></label>
      <label>Litrat<input name="litres" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>
      <label>Litrahinta €/l<input name="unitPrice" type="number" min="0" step="0.001" inputmode="decimal"></label>
      <label>Kokonaishinta €
        <input name="totalPrice" type="number" min="0" step="0.01" inputmode="decimal">
        <span class="field-help">Syötä litramäärän lisäksi litrahinta tai kokonaishinta. Toinen lasketaan automaattisesti.</span>
      </label>
      <label>Konetunnit<input name="engineHours" type="number" min="0" step="0.1"></label>
      <label>Tankkaustyyppi
        <select name="fillType">
          <option value="full">Täyteen</option>
          <option value="partial">Osatankkaus</option>
        </select>
      </label>
      <label>Lisätiedot<textarea name="notes"></textarea></label>
    `, values => {
      const litres = fuelNumber(values.litres);
      const enteredUnitPrice = fuelNumber(values.unitPrice);
      const enteredTotalPrice = fuelNumber(values.totalPrice);

      if (!(litres > 0)) throw new Error("Anna tankattu litramäärä.");
      if (enteredUnitPrice === null && enteredTotalPrice === null) {
        throw new Error("Anna joko litrahinta tai kokonaishinta.");
      }

      let price;
      let ppu;
      if (priceSource === "unit" && enteredUnitPrice !== null) {
        ppu = enteredUnitPrice;
        price = litres * ppu;
      } else if (priceSource === "total" && enteredTotalPrice !== null) {
        price = enteredTotalPrice;
        ppu = price / litres;
      } else if (enteredTotalPrice !== null) {
        price = enteredTotalPrice;
        ppu = price / litres;
      } else {
        ppu = enteredUnitPrice;
        price = litres * ppu;
      }

      if (price < 0 || ppu < 0) throw new Error("Hinta ei voi olla negatiivinen.");

      const place = values.place.trim();
      const title = place ? `Tankkaus – ${place}` : "Tankkaus";
      const details = [
        `${litres.toFixed(2).replace(".", ",")} l`,
        `${price.toFixed(2).replace(".", ",")} €`,
        `${ppu.toFixed(3).replace(".", ",")} €/l`,
        values.fillType === "full" ? "Täyteen" : "Osatankkaus",
        values.notes
      ].filter(Boolean).join("\n");
      const now = new Date();
      const gps = latestGpsForEvent();
      const fuelId = newId();
      const boatEventId = newId();

      const boatEvent = {
        id: boatEventId,
        type: "fuel",
        title,
        details,
        place,
        date: now.toLocaleDateString("fi-FI"),
        timestamp: now.toISOString(),
        gps,
        source: "Manuaalinen kirjaus"
      };
      state.boatEvents.push(boatEvent);

      if (values.engineHours) state.engineHours = Number(values.engineHours);
      const logItem = state.activeTrip
        ? addLog("fuel", title, details, { place, gps })
        : null;
      queueOperation("fuel.add", {
        fuelId,
        boatEventId,
        eventId: logItem?.id || "",
        tripId: state.activeTrip?.id || "",
        fuelTime: now.toISOString(),
        placeName: place,
        litres,
        priceTotal: price,
        pricePerLitre: ppu,
        engineHours: values.engineHours || "",
        fillType: values.fillType,
        notes: values.notes,
        ...gpsPayload(gps)
      });
      save();
    });

    const litresInput = elements.dialogFields.querySelector('[name="litres"]');
    const unitPriceInput = elements.dialogFields.querySelector('[name="unitPrice"]');
    const totalPriceInput = elements.dialogFields.querySelector('[name="totalPrice"]');

    const updateCalculatedPrice = source => {
      const litres = fuelNumber(litresInput.value);
      if (!(litres > 0)) return;

      if (source === "unit") {
        const unitPrice = fuelNumber(unitPriceInput.value);
        if (unitPrice !== null) totalPriceInput.value = fuelInputValue(litres * unitPrice, 2);
      } else if (source === "total") {
        const totalPrice = fuelNumber(totalPriceInput.value);
        if (totalPrice !== null) unitPriceInput.value = fuelInputValue(totalPrice / litres, 3);
      }
    };

    litresInput.addEventListener("input", () => {
      if (!priceSource) {
        if (unitPriceInput.value && !totalPriceInput.value) priceSource = "unit";
        else if (totalPriceInput.value) priceSource = "total";
      }
      if (priceSource) updateCalculatedPrice(priceSource);
    });

    unitPriceInput.addEventListener("input", () => {
      if (!unitPriceInput.value) {
        if (totalPriceInput.value) priceSource = "total";
        return;
      }
      priceSource = "unit";
      updateCalculatedPrice(priceSource);
    });

    totalPriceInput.addEventListener("input", () => {
      if (!totalPriceInput.value) {
        if (unitPriceInput.value) priceSource = "unit";
        return;
      }
      priceSource = "total";
      updateCalculatedPrice(priceSource);
    });
  }

  function updateEngineHours() {
    openForm("Päivitä konetunnit", `
      <label>Todellinen lukema<input name="hours" type="number" min="0" step="0.1" required></label>
      <label>Lisätieto<textarea name="notes"></textarea></label>
    `, values => {
      const now = new Date();
      state.engineHours = Number(values.hours);
      const boatEvent = {
        id: newId(),
        type: "note",
        title: "Konetunnit päivitetty",
        details: `${Number(values.hours).toFixed(1).replace(".", ",")} h${values.notes ? `\n${values.notes}` : ""}`,
        date: now.toLocaleDateString("fi-FI"),
        timestamp: now.toISOString(),
        gps: latestGpsForEvent(),
        source: "Manuaalinen kirjaus"
      };
      state.boatEvents.push(boatEvent);
      queueOperation("engineHours.add", {
        boatEventId: boatEvent.id,
        eventTime: boatEvent.timestamp,
        hours: Number(values.hours),
        notes: values.notes
      });
      save();
    });
  }

  function bindPressActions(element, onTap, onLongPress) {
    let timer = null;
    let longPressed = false;
    let startX = 0;
    let startY = 0;

    const cancelTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    element.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      longPressed = false;
      cancelTimer();
      timer = window.setTimeout(() => {
        longPressed = true;
        onLongPress();
        navigator.vibrate?.(25);
      }, 550);
    });

    element.addEventListener("pointermove", event => {
      if (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10) cancelTimer();
    });
    element.addEventListener("pointerup", cancelTimer);
    element.addEventListener("pointercancel", cancelTimer);
    element.addEventListener("pointerleave", cancelTimer);
    element.addEventListener("click", event => {
      if (longPressed) {
        event.preventDefault();
        longPressed = false;
        return;
      }
      onTap();
    });
    element.addEventListener("contextmenu", event => event.preventDefault());
    element.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onTap();
      }
    });
  }

  function findEntry(id, collection) {
    const list = collection === "boat" ? state.boatEvents : state.log;
    return list.find(item => String(item.id) === String(id));
  }

  function entryPlace(item) {
    if (item.place) return item.place;
    const marker = " – ";
    return item.title?.includes(marker) ? item.title.split(marker).slice(1).join(marker) : "";
  }

  function gpsDetails(gps) {
    if (!gps || !Number.isFinite(Number(gps.latitude)) || !Number.isFinite(Number(gps.longitude))) {
      return '<span class="detail-muted">Ei saatavilla</span>';
    }
    const latitude = Number(gps.latitude).toFixed(6);
    const longitude = Number(gps.longitude).toFixed(6);
    const accuracy = Number.isFinite(Number(gps.accuracy)) ? ` ±${Math.round(Number(gps.accuracy))} m` : "";
    return `<span class="coordinates">${latitude}, ${longitude}${accuracy}</span>`;
  }

  function normalisePhotos(photos) {
    if (!Array.isArray(photos)) return [];
    return photos.map((photo, index) => {
      if (typeof photo === "string") return { id: `photo-${index}`, dataUrl: photo };
      return photo;
    }).filter(photo => photo && safePhotoUrl(photo.dataUrl));
  }

  function safePhotoUrl(value) {
    return typeof value === "string" && /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(value)
      ? value
      : "";
  }

  function photosMarkup(item) {
    const photos = normalisePhotos(item.photos);
    if (!photos.length) {
      return item.hasPhoto
        ? '<p class="detail-muted">Kuva on merkitty kirjaukseen, mutta kuvatiedostoa ei ole tässä versiossa.</p>'
        : '<p class="detail-muted">Ei kuvia.</p>';
    }
    return `<div class="detail-photos">${photos.map((photo, index) => `
      <a href="${safePhotoUrl(photo.dataUrl)}" target="_blank" rel="noopener" aria-label="Avaa kuva ${index + 1}">
        <img src="${safePhotoUrl(photo.dataUrl)}" alt="Kirjauksen kuva ${index + 1}">
      </a>
    `).join("")}</div>`;
  }

  function openEntryDetail(id, collection) {
    const item = findEntry(id, collection);
    if (!item) return;

    const place = entryPlace(item);
    const timestamp = item.timestamp || item.date || item.time;
    elements.dialogTitle.textContent = collection === "boat" ? "Tapahtuman tiedot" : "Kirjauksen tiedot";
    elements.dialogFields.innerHTML = `
      <dl class="detail-grid">
        <dt>Aika</dt><dd>${escapeHtml(formatFullTime(timestamp, item.date || item.time || "–"))}</dd>
        <dt>Tyyppi</dt><dd>${escapeHtml(eventTypeLabel(item.type))}</dd>
        <dt>Teksti</dt><dd class="detail-text">${escapeHtml(item.details || "–")}</dd>
        <dt>Paikka</dt><dd>${escapeHtml(place || "–")}</dd>
        <dt>GPS</dt><dd>${gpsDetails(item.gps)}</dd>
        <dt>Lähde</dt><dd>${escapeHtml(item.source || "Vanha paikallinen kirjaus")}</dd>
      </dl>
      <section class="detail-section">
        <h3>Kuvat</h3>
        ${photosMarkup(item)}
      </section>
      <div class="detail-actions">
        <button type="button" class="secondary-button" id="editEntryButton">Muokkaa</button>
        <button type="button" class="delete-button" id="deleteEntryButton">Poista</button>
      </div>
    `;
    configureDialog({ cancelLabel: "Sulje", detail: true });
    elements.dialogForm.onsubmit = event => event.preventDefault();
    elements.dialogFields.querySelector("#editEntryButton").addEventListener("click", () => {
      closeDialog();
      if (collection === "boat") editBoatEvent(id);
      else editLogEntry(id);
    });
    elements.dialogFields.querySelector("#deleteEntryButton").addEventListener("click", () => {
      deleteEntry(id, collection);
    });
    showDialog();
  }

  function existingPhotoControls(item) {
    const photos = normalisePhotos(item.photos);
    if (!photos.length) return "";
    return `
      <fieldset class="existing-photos">
        <legend>Nykyiset kuvat</legend>
        ${photos.map((photo, index) => `
          <label class="existing-photo">
            <img src="${safePhotoUrl(photo.dataUrl)}" alt="Nykyinen kuva ${index + 1}">
            <span><input type="checkbox" name="removePhoto" value="${escapeHtml(photo.id)}"> Poista kuva</span>
          </label>
        `).join("")}
      </fieldset>
    `;
  }

  function editLogEntry(id) {
    const item = findEntry(id, "log");
    if (!item) return;
    const place = entryPlace(item);

    openForm("Muokkaa kirjausta", `
      <div class="readonly-meta">${escapeHtml(formatFullTime(item.timestamp, item.time))} · ${escapeHtml(eventTypeLabel(item.type))}</div>
      <label>Paikka<input name="place" value="${escapeHtml(place)}"></label>
      <label>Teksti<textarea name="text">${escapeHtml(item.details || "")}</textarea></label>
      ${existingPhotoControls(item)}
      <label>Lisää kuvia
        <input name="photos" type="file" accept="image/*" capture="environment" multiple>
        <span class="field-help">Voit liittää yhteensä enintään viisi kuvaa.</span>
      </label>
    `, async (values, data) => {
      const removedIds = new Set(data.getAll("removePhoto").map(String));
      const keptPhotos = normalisePhotos(item.photos).filter(photo => !removedIds.has(String(photo.id)));
      const newPhotos = await filesToPhotos(data.getAll("photos"), 5 - keptPhotos.length);
      const nextPhotos = [...keptPhotos, ...newPhotos].slice(0, 5);
      const nextPlace = values.place.trim();

      item.place = nextPlace;
      item.details = values.text;
      item.photos = nextPhotos;
      item.hasPhoto = nextPhotos.length > 0;
      item.editedAt = new Date().toISOString();

      const baseTitle = eventTypeLabel(item.type);
      if (["departed", "moored", "anchored", "fuel"].includes(item.type)) {
        item.title = nextPlace ? `${baseTitle} – ${nextPlace}` : baseTitle;
      }
      queueOperation("event.update", {
        eventId: item.id,
        title: item.title,
        text: item.details,
        photoCount: nextPhotos.length
      });
      save();
    });
  }

  function editBoatEvent(id) {
    const item = findEntry(id, "boat");
    if (!item) return;

    openForm("Muokkaa tapahtumaa", `
      <div class="readonly-meta">${escapeHtml(formatFullTime(item.timestamp, item.date))} · ${escapeHtml(eventTypeLabel(item.type))}</div>
      <label>Otsikko<input name="title" value="${escapeHtml(item.title)}" required></label>
      <label>Lisätiedot<textarea name="text">${escapeHtml(item.details || "")}</textarea></label>
    `, values => {
      item.title = values.title.trim();
      item.details = values.text;
      item.editedAt = new Date().toISOString();
      queueOperation("boatEvent.update", {
        boatEventId: item.id,
        title: item.title,
        text: item.details
      });
      save();
    });
  }

  function deleteEntry(id, collection) {
    const item = findEntry(id, collection);
    if (!item || !confirm(`Poistetaanko “${item.title}” pysyvästi?`)) return;
    const list = collection === "boat" ? state.boatEvents : state.log;
    const index = list.findIndex(entry => String(entry.id) === String(id));
    if (index >= 0) list.splice(index, 1);
    try {
      queueOperation(collection === "boat" ? "boatEvent.delete" : "event.delete", collection === "boat"
        ? { boatEventId: item.id }
        : { eventId: item.id });
      save();
      closeDialog();
    } catch (error) {
      alert(error.message);
    }
  }

  async function filesToPhotos(files, maximum = 5) {
    const imageFiles = [...files].filter(file => file?.size && file.type?.startsWith("image/")).slice(0, Math.max(0, maximum));
    const photos = [];
    for (const file of imageFiles) {
      photos.push({
        id: newId(),
        name: file.name,
        dataUrl: await resizeImage(file)
      });
    }
    return photos;
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        try {
          const maximum = 1280;
          const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(image, 0, 0, width, height);
          URL.revokeObjectURL(objectUrl);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Kuvan ${file.name} lukeminen epäonnistui.`));
      };
      image.src = objectUrl;
    });
  }

  function normalisePosition(position) {
    return {
      latitude: Number(position.coords.latitude),
      longitude: Number(position.coords.longitude),
      accuracy: Number(position.coords.accuracy),
      altitude: position.coords.altitude === null ? null : Number(position.coords.altitude),
      heading: position.coords.heading === null ? null : Number(position.coords.heading),
      speed: position.coords.speed === null ? null : Number(position.coords.speed),
      timestamp: new Date(position.timestamp || Date.now()).toISOString()
    };
  }

  function gpsQuality(gps) {
    if (!gps || !Number.isFinite(Number(gps.accuracy))) return "none";
    if (Number(gps.accuracy) <= 20) return "good";
    if (Number(gps.accuracy) <= 50) return "moderate";
    return "weak";
  }

  function ensureIndicators() {
    const header = document.querySelector(".app-header");
    if (!header) return;
    let group = header.querySelector(".connection-indicators");
    if (!group) {
      group = document.createElement("div");
      group.className = "connection-indicators";
      header.append(group);
    }

    if (!elements.gpsBadge) {
      elements.gpsBadge = document.createElement("div");
      elements.gpsBadge.id = "gpsBadge";
    }
    elements.gpsBadge.classList.add("connection-badge");
    if (elements.gpsBadge.parentElement !== group) group.append(elements.gpsBadge);

    if (!elements.syncBadge) {
      elements.syncBadge = document.createElement("div");
      elements.syncBadge.id = "syncBadge";
    }
    elements.syncBadge.classList.add("connection-badge");
    if (elements.syncBadge.parentElement !== group) group.append(elements.syncBadge);
  }

  function updateGpsIndicator() {
    ensureIndicators();
    if (!elements.gpsBadge) return;
    const quality = gpsQuality(gpsState.position);
    const accuracy = gpsState.position ? Math.round(Number(gpsState.position.accuracy)) : null;
    const labels = {
      good: `GPS hyvä · ±${accuracy} m`,
      moderate: `GPS kohtalainen · ±${accuracy} m`,
      weak: `GPS heikko · ±${accuracy} m`,
      none: "GPS ei yhteyttä"
    };
    elements.gpsBadge.className = `connection-badge gps-${quality}`;
    elements.gpsBadge.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${labels[quality]}</span>`;
    elements.gpsBadge.title = gpsState.error?.message || labels[quality];
  }

  function setSyncStatus(status, detail = "") {
    ensureIndicators();
    if (!elements.syncBadge) return;
    const pendingCount = VenelokiStorage.getQueue().length;
    const labels = {
      local: "Tallennus paikallinen",
      pending: pendingCount ? `Jonossa ${pendingCount}` : "Odottaa synkronointia",
      syncing: pendingCount ? `Synkronoidaan · ${pendingCount}` : "Synkronoidaan",
      synced: "Synkronoitu",
      error: pendingCount ? `Ei synkronoitu · ${pendingCount}` : "Yhteysvirhe"
    };
    elements.syncBadge.className = `connection-badge sync-${status}`;
    elements.syncBadge.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${labels[status] || labels.local}</span>`;
    elements.syncBadge.title = detail || (status === "local"
      ? "Anna Apps Script API -osoite ja API-avain Asetukset-välilehdellä."
      : labels[status]);
    if (elements.connectionState) {
      elements.connectionState.textContent = VenelokiApi.isConfigured()
        ? "Google Sheets -synkronointi"
        : "Paikallinen tila";
    }
  }

  function handleGpsSuccess(position) {
    gpsState.position = normalisePosition(position);
    gpsState.error = null;
    updateGpsIndicator();
    VenelokiMap?.onGps?.(gpsState.position);
  }

  function handleGpsError(error) {
    gpsState.error = error;
    const timestamp = gpsState.position ? new Date(gpsState.position.timestamp).getTime() : 0;
    if (!timestamp || Date.now() - timestamp > 60000) gpsState.position = null;
    updateGpsIndicator();
  }

  function startGpsWatch() {
    ensureIndicators();
    updateGpsIndicator();
    if (!navigator.geolocation) return;
    gpsWatchId = navigator.geolocation.watchPosition(handleGpsSuccess, handleGpsError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000
    });
  }

  function latestGpsForEvent() {
    const timestamp = gpsState.position ? new Date(gpsState.position.timestamp).getTime() : 0;
    if (!timestamp || Date.now() - timestamp > 60000) return null;
    return { ...gpsState.position };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  ensureDialogControls();
  elements.dialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeDialog();
  });

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
  elements.repairStateButton.addEventListener("click", repairCurrentTripState);

  const settings = VenelokiStorage.getSettings();
  elements.apiUrlInput.value = settings.apiUrl;
  elements.apiKeyInput.value = settings.apiKey;
  if (elements.mapBaseLayerInput) elements.mapBaseLayerInput.value = settings.mapBase || "osm";
  if (elements.mmlApiKeyInput) elements.mmlApiKeyInput.value = settings.mmlApiKey || "";

  elements.settingsForm.addEventListener("submit", async event => {
    event.preventDefault();
    VenelokiStorage.saveSettings({
      apiUrl: elements.apiUrlInput.value.trim(),
      apiKey: elements.apiKeyInput.value.trim(),
      mapBase: elements.mapBaseLayerInput?.value || "osm",
      mmlApiKey: elements.mmlApiKeyInput?.value.trim() || ""
    });
    VenelokiMap?.configureOnlineLayers?.();

    if (!VenelokiApi.isConfigured()) {
      setSyncStatus("local");
      alert("Asetukset tallennettiin. Anna sekä API-osoite että API-avain synkronointia varten.");
      return;
    }

    setSyncStatus("syncing");
    const ok = await syncNow();
    alert(ok
      ? "API-yhteys toimii. Uudet kirjaukset synkronoidaan Google Sheetsiin."
      : `Asetukset tallennettiin, mutta yhteys epäonnistui: ${lastSyncError?.message || "tuntematon virhe"}`);
  });

  elements.prepareOfflineButton?.addEventListener("click", () => prepareOfflineUse());

  async function initialiseServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      setOfflineReadiness("Tämä selain ei tue offline-käyttöä.", "error");
      return;
    }

    if (!navigator.onLine || automaticSyncPaused) {
      setOfflineReadiness(
        navigator.serviceWorker.controller
          ? "Offline-käyttö aktiivinen."
          : "Offline-palvelua ei voitu tarkistaa ilman verkkoyhteyttä.",
        navigator.serviceWorker.controller ? "success" : "error"
      );
      return;
    }

    if (serviceWorkerInitialising) return;
    serviceWorkerInitialising = true;

    let reloadingForServiceWorker = false;

    if (!serviceWorkerControllerListenerAdded) {
      serviceWorkerControllerListenerAdded = true;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadingForServiceWorker) return;
        reloadingForServiceWorker = true;
        window.location.reload();
      });
    }

    try {
      const registration = await navigator.serviceWorker.register(`./service-worker.js?v=${APP_VERSION}`, {
        scope: "./",
        updateViaCache: "none"
      });
      serviceWorkerRegistration = registration;
      serviceWorkerRegistration = await navigator.serviceWorker.ready;

      if (localStorage.getItem(OFFLINE_READY_VERSION_KEY) === APP_VERSION && navigator.serviceWorker.controller) {
        setOfflineReadiness("Offline-käyttö valmis.", "success");
      } else {
        await prepareOfflineUse();
      }
    } catch (error) {
      console.error(error);
      serviceWorkerRegistration = null;
      automaticSyncPaused = true;
      setOfflineReadiness("Offline-palvelun käyttöönotto epäonnistui. Avaa sovellus verkkoyhteydellä uudelleen.", "error");
    } finally {
      serviceWorkerInitialising = false;
    }
  }

  window.addEventListener("beforeunload", () => {
    VenelokiMap?.flushPending?.();
    if (gpsWatchId !== null) navigator.geolocation?.clearWatch(gpsWatchId);
  });

  window.addEventListener("online", () => {
    // Älä luota iPadOS:n split screenissä lähettämään online-tapahtumaan.
    // Kun tämä avauskerta on kerran todettu offline-tilaiseksi, verkkopyynnöt
    // pysyvät lukittuina. Oikean yhteyden palattua sovelluksen uudelleenavaus
    // aloittaa uuden istunnon ja synkronoi jonon normaalisti.
    if (automaticSyncPaused) {
      if (VenelokiApi.isConfigured()) {
        setSyncStatus("pending", "Verkko havaittiin. Avaa Veneloki uudelleen verkkoyhteydellä synkronointia varten.");
      }
      return;
    }
    // Split screenissä iPadOS voi ilmoittaa yhteyden palanneen, vaikka
    // internetiä ei oikeasti ole. Älä tee tästä tapahtumasta verkkopyyntöä.
    // Oikean yhteyden palattua sovellus avataan uudelleen, jolloin päivitys
    // ja synkronointi tarkistetaan hallitusti kerran.
    if (VenelokiApi.isConfigured()) {
      setSyncStatus("pending", "Verkko havaittiin. Avaa Veneloki uudelleen verkkoyhteydellä synkronointia varten.");
    }
  });
  window.addEventListener("offline", () => {
    automaticSyncPaused = true;
    if (syncTimer !== null) {
      window.clearTimeout(syncTimer);
      syncTimer = null;
    }
    if (VenelokiApi.isConfigured()) setSyncStatus("pending", "Ei verkkoyhteyttä. Kirjaukset säilyvät jonossa.");
    setOfflineReadiness("Offline-käyttö aktiivinen.", "success");
  });

  setSyncStatus(VenelokiApi.isConfigured()
    ? !navigator.onLine || VenelokiStorage.getQueue().length ? "pending" : "syncing"
    : "local");
  VenelokiMap?.initialise?.({
    getState: () => state,
    getGps: () => gpsState.position,
    queueOperation,
    persistState: () => VenelokiStorage.saveState(state),
    addAutomaticPlaceEvent
  });
  VenelokiMap?.flushPending?.();
  startGpsWatch();
  render();

  // Tee käynnistyksen mahdolliset verkkotyöt peräkkäin. Näin service workerin
  // päivitystarkistus ja API-synkronointi eivät voi nostaa kahta rinnakkaista
  // iPadOS:n yhteysilmoitusta.
  initialiseServiceWorker().then(() => {
    if (VenelokiApi.isConfigured() && navigator.onLine && !automaticSyncPaused) {
      scheduleSync(0);
    }
  });
})();
