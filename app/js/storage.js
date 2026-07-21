const VenelokiStorage = (() => {
  const KEYS = Object.freeze({
    state: "veneloki.state.v2",
    legacyState: "veneloki.demoState",
    settingsUrl: "veneloki.apiUrl",
    settingsKey: "veneloki.apiKey",
    settingsMapBase: "veneloki.mapBase",
    settingsMmlKey: "veneloki.mmlApiKey",
    settingsMapLayers: "veneloki.mapLayers.v1",
    queue: "veneloki.syncQueue.v1",
    deviceId: "veneloki.deviceId",
    preApiBackup: "veneloki.preApiBackup",
    repairBackup: "veneloki.repairBackup.v1"
  });

  function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("Paikallisen Veneloki-datan lukeminen epäonnistui.", error);
      return fallback;
    }
  }

  function emptyState() {
    return {
      activeTrip: null,
      log: [],
      boatEvents: [],
      engineHours: null,
      routePoints: [],
      places: [],
      placeVisits: {}
    };
  }

  function normaliseState(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      activeTrip: source.activeTrip || null,
      log: Array.isArray(source.log) ? source.log : [],
      boatEvents: Array.isArray(source.boatEvents) ? source.boatEvents : [],
      engineHours: source.engineHours === null || source.engineHours === undefined
        ? null
        : Number(source.engineHours),
      routePoints: Array.isArray(source.routePoints) ? source.routePoints : [],
      places: Array.isArray(source.places) ? source.places : [],
      placeVisits: source.placeVisits && typeof source.placeVisits === "object"
        ? source.placeVisits
        : {}
    };
  }

  function getState() {
    const current = localStorage.getItem(KEYS.state);

    if (current) {
      return normaliseState(parseJson(current, emptyState()));
    }

    const legacy = localStorage.getItem(KEYS.legacyState);
    const state = normaliseState(parseJson(legacy, emptyState()));

    if (legacy) {
      try {
        localStorage.removeItem(KEYS.legacyState);
        localStorage.setItem(KEYS.state, JSON.stringify(state));
      } catch (error) {
        localStorage.setItem(KEYS.legacyState, legacy);
        throw error;
      }
    } else {
      localStorage.setItem(KEYS.state, JSON.stringify(state));
    }

    return state;
  }

  function saveState(state) {
    localStorage.setItem(KEYS.state, JSON.stringify(normaliseState(state)));
  }

  function getQueue() {
    const queue = parseJson(localStorage.getItem(KEYS.queue), []);
    return Array.isArray(queue) ? queue : [];
  }

  function saveQueue(queue) {
    localStorage.setItem(KEYS.queue, JSON.stringify(Array.isArray(queue) ? queue : []));
  }

  function enqueue(operation) {
    const queue = getQueue();

    if (!queue.some(item => item.id === operation.id)) {
      queue.push(operation);
      saveQueue(queue);
    }

    return operation;
  }

  function removeQueued(id) {
    const queue = getQueue();
    const next = queue.filter(operation => operation.id !== id);
    saveQueue(next);
    return next.length;
  }

  function getDeviceId() {
    let id = localStorage.getItem(KEYS.deviceId);

    if (!id) {
      id = globalThis.crypto?.randomUUID?.()
        || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(KEYS.deviceId, id);
    }

    return id;
  }

  return {
    getSettings() {
      return {
        apiUrl: localStorage.getItem(KEYS.settingsUrl) || "",
        apiKey: localStorage.getItem(KEYS.settingsKey) || "",
        mapBase: localStorage.getItem(KEYS.settingsMapBase) || "osm",
        mmlApiKey: localStorage.getItem(KEYS.settingsMmlKey) || ""
      };
    },

    saveSettings(settings) {
      localStorage.setItem(KEYS.settingsUrl, settings.apiUrl || "");
      localStorage.setItem(KEYS.settingsKey, settings.apiKey || "");
      localStorage.setItem(KEYS.settingsMapBase, settings.mapBase || "osm");
      localStorage.setItem(KEYS.settingsMmlKey, settings.mmlApiKey || "");
    },
    getMapLayers() {
      const defaults = { base: true, waterways: true, places: true, events: true };
      return { ...defaults, ...parseJson(localStorage.getItem(KEYS.settingsMapLayers), {}) };
    },
    saveMapLayers(layers) {
      localStorage.setItem(KEYS.settingsMapLayers, JSON.stringify(layers || {}));
    },

    getState,
    saveState,
    backupState(state) {
      if (!localStorage.getItem(KEYS.preApiBackup)) {
        const backup = normaliseState(state);
        backup.log = backup.log.map(item => ({ ...item, photos: [] }));
        backup.boatEvents = backup.boatEvents.map(item => ({ ...item, photos: [] }));
        try {
          localStorage.setItem(KEYS.preApiBackup, JSON.stringify(backup));
        } catch (error) {
          console.warn("Paikallisen varmuuskopion tallennus ei mahtunut selaimen tallennustilaan.", error);
        }
      }
    },
    getQueue,
    enqueue,
    removeQueued,
    replaceQueue(queue) {
      saveQueue(queue);
    },
    backupForRepair(state, queue) {
      const backup = {
        savedAt: new Date().toISOString(),
        state: normaliseState(state),
        queue: Array.isArray(queue) ? queue : []
      };
      try {
        localStorage.setItem(KEYS.repairBackup, JSON.stringify(backup));
      } catch (error) {
        throw new Error("Korjauksen varmuuskopio ei mahtunut laitteen tallennustilaan. Mitään ei muutettu.");
      }
      return backup.savedAt;
    },
    getDeviceId,

    createOperation(type, payload) {
      const id = globalThis.crypto?.randomUUID?.()
        || `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return {
        id,
        type,
        payload,
        deviceId: getDeviceId(),
        createdAt: new Date().toISOString()
      };
    },

    getDemoState: getState,
    saveDemoState: saveState
  };
})();
