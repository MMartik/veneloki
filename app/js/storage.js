
const VenelokiStorage = {
  getSettings() {
    return {
      apiUrl: localStorage.getItem("veneloki.apiUrl") || "",
      apiKey: localStorage.getItem("veneloki.apiKey") || ""
    };
  },

  saveSettings(settings) {
    localStorage.setItem("veneloki.apiUrl", settings.apiUrl || "");
    localStorage.setItem("veneloki.apiKey", settings.apiKey || "");
  },

  getDemoState() {
    const raw = localStorage.getItem("veneloki.demoState");
    return raw ? JSON.parse(raw) : { activeTrip: null, log: [], boatEvents: [], engineHours: null };
  },

  saveDemoState(state) {
    localStorage.setItem("veneloki.demoState", JSON.stringify(state));
  }
};
