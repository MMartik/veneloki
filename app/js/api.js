const VenelokiApi = (() => {
  const REQUEST_TIMEOUT_MS = 25000;
  const NETWORK_DIAGNOSTIC_MODE = true;

  function configuration() {
    return VenelokiStorage.getSettings();
  }

  function isConfigured() {
    const settings = configuration();
    return Boolean(settings.apiUrl && settings.apiKey);
  }

  async function request(action, additional = {}) {
    if (NETWORK_DIAGNOSTIC_MODE) {
      const error = new Error("Verkkoyhteydet on poistettu käytöstä testitilassa.");
      error.isNetworkSuppressed = true;
      throw error;
    }

    const settings = configuration();

    if (!settings.apiUrl || !settings.apiKey) {
      throw new Error("Apps Script API -osoite tai API-avain puuttuu.");
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(settings.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action,
          apiKey: settings.apiKey,
          ...additional
        }),
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`API-yhteys epäonnistui (${response.status}).`);
      }

      const text = await response.text();
      let result;

      try {
        result = JSON.parse(text);
      } catch (error) {
        throw new Error("API ei palauttanut kelvollista JSON-vastausta. Tarkista web app -osoite ja käyttöoikeudet.");
      }

      if (!result.ok) {
        throw new Error(result.error?.message || "API-pyyntö epäonnistui.");
      }

      return result.data;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("API-yhteys aikakatkaistiin.");
        timeoutError.isNetworkError = true;
        throw timeoutError;
      }
      if (error instanceof TypeError) {
        const networkError = new Error("Verkkoyhteyttä ei ole käytettävissä.");
        networkError.isNetworkError = true;
        throw networkError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return {
    isConfigured,
    ping: () => request("ping"),
    getState: () => request("state.get"),
    syncOperation: operation => request("sync", { operation })
  };
})();
