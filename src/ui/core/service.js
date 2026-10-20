/* =========================================================================
   Verbindung zum lokalen Dienst (DDC-Werkbank.exe, http://localhost:47902).
   Aus der Datei (file://) heraus über localhost, sonst über dieselbe Adresse.
   Jede Anfrage hat ein Zeitlimit – ein hängender Dienst blockiert nichts.
   ========================================================================= */
export const SERVICE_BASE = location.protocol === "file:" ? "http://localhost:47902" : "";

/* JSON holen/senden. body (Objekt) → POST. Wirft bei Netzwerkfehler oder Zeitüberschreitung. */
export async function svcJson(path, body, ms) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms || 8000) : null;
  try {
    const opts = { signal: ctl ? ctl.signal : undefined };
    if (body !== undefined) Object.assign(opts, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const r = await fetch(SERVICE_BASE + path, opts);
    return await r.json();
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("Zeitüberschreitung (" + path + ")");
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}
