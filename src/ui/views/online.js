import { clearLive, defaultLiveText, setLive } from "../core/live.js";
import { openNode, openPin } from "../core/nav.js";
import { APP, curC } from "../core/state.js";
import { LIVE_SOURCES, VIEWS } from "../core/ext.js";
import { fmtNum, h, nowStamp, store } from "../core/util.js";
import { svcJson } from "../core/service.js";
import { btn, chk, emptyState, icon, pageHead, selectEl, toast } from "../shell/shell.js";

/* =========================================================================
   Ansicht: Online – Verbindung zur Zentrale über den lokalen Dienst
   Liest per BACnet/IP Live-Werte. Funktioniert nur, wenn das
   Hintergrundprogramm (DDC-Werkbank.exe) läuft. Rein lesend.
   Der Dienst hält keine Verbindung offen (jede Anfrage öffnet und schließt
   ihren eigenen UDP-Socket); „Trennen“ beendet daher die Abfragen hier.
   ========================================================================= */
const OBJT = { 0: "AI", 1: "AO", 2: "AV", 3: "BI", 4: "BO", 5: "BV", 13: "MI", 14: "MO", 19: "MV", 8: "DEV", 17: "SCHED", 6: "CAL", 20: "TR" };
const OBJT_LONG = { 0: "Analog-Eingang", 1: "Analog-Ausgang", 2: "Analog-Wert", 3: "Binär-Eingang", 4: "Binär-Ausgang", 5: "Binär-Wert", 13: "Multistate-Eingang", 14: "Multistate-Ausgang", 19: "Multistate-Wert" };
const READ_TYPES = new Set([0, 1, 2, 3, 4, 5, 13, 14, 19]);

/* Live-Quelle BACnet/IP: Anzeige der gelesenen Present-Values */
function bacnetText(o) {
  if (!o.ok || o.value == null) return defaultLiveText(o);
  const t = o.type;
  if (t === 3 || t === 4 || t === 5) { const on = o.value === true || o.value === 1 || o.value === "1"; return { t: on ? "EIN" : "AUS", cls: on ? "liveon" : "liveoff" }; }
  if (t === 13 || t === 14 || t === 19) return { t: String(o.value), cls: "" };
  if (typeof o.value === "number") return { t: fmtNum(o.value), cls: "num" };
  return { t: String(o.value), cls: "" };
}
LIVE_SOURCES.add({ id: "bacnet", label: "BACnet/IP", format: bacnetText });

const ONLINE = { health: "unknown", cfg: null, ip: store.get("onlineIp", ""), dev: null, objs: null, values: [], stamp: "", busy: null, err: "", auto: false, gen: 0, _root: null, _mounted: 0 };

/* Anfrage an den Dienst; null wenn er nicht antwortet. Lesen vieler Objekte darf länger dauern. */
async function olFetch(path, body, ms) {
  try {
    const j = await svcJson(path, body, ms || 15000);
    ONLINE.health = "up";
    return j;
  } catch (e) {
    console.warn("Dienst:", e.message || e);
    ONLINE.health = "down";
    return null;
  }
}

async function olCheckHealth() {
  const r = await olFetch("/api/health");
  if (r && r.ok) { ONLINE.health = "up"; if (!ONLINE.cfg) await olLoadConfig(); }
  else ONLINE.health = "down";
  olLayout();
}
async function olLoadConfig() {
  const r = await olFetch("/api/config");
  ONLINE.cfg = r && r.centrals ? r : { centrals: [], settings: {} };
  if (!ONLINE.ip && ONLINE.cfg.centrals[0]) ONLINE.ip = ONLINE.cfg.centrals[0].ip;
}

function olBacnetObjects(C) {
  if (!C || !C.bacnet || !C.bacnet.length) return null;
  const seen = new Set(), out = [];
  for (const b of C.bacnet) {
    const t = b.btype, inst = parseInt(b.inst, 10);
    if (!READ_TYPES.has(t) || isNaN(inst)) continue;
    const key = t + ":" + inst; if (seen.has(key)) continue; seen.add(key);
    out.push({ type: t, inst, name: (b.name || "").trim() || ("Objekt " + inst), nodeId: b.nodeId || null });
  }
  return out.length ? out : null;
}

async function olConnect() {
  const ip = (ONLINE.ip || "").trim();
  if (!ip) { toast("Bitte IP-Adresse der Zentrale eingeben.", "warn"); return; }
  store.set("onlineIp", ip);
  clearTimeout(ONLINE._timer);
  const gen = ++ONLINE.gen;
  ONLINE.dev = null; ONLINE.values = []; ONLINE.objs = null; ONLINE.err = ""; ONLINE.stamp = ""; ONLINE.busy = "connect"; olLayout();
  const C = ONLINE.C;
  const known = C && C.meta && C.meta.bacnetDevId ? "&inst=" + encodeURIComponent(C.meta.bacnetDevId) : "";
  const r = await olFetch("/api/identify?ip=" + encodeURIComponent(ip) + known);
  if (gen !== ONLINE.gen) return;   // inzwischen getrennt oder neu verbunden
  ONLINE.busy = null;
  if (!r) { olLayout(); return; }
  if (!r.ok) { ONLINE.err = r.err || "Keine Verbindung."; olLayout(); return; }
  ONLINE.dev = r; olLayout();
  olRefresh();
}

async function olRefresh(silent) {
  if (!ONLINE.dev || ONLINE.busy) return;
  const gen = ONLINE.gen, ip = ONLINE.ip.trim();
  // Objektliste bestimmen (einmalig): aus der Sicherung oder vom Gerät
  if (!ONLINE.objs) {
    const fromBackup = olBacnetObjects(ONLINE.C);
    if (fromBackup) ONLINE.objs = fromBackup;
    else {
      ONLINE.busy = "browse"; if (!silent) olLayout();
      const b = await olFetch("/api/browse?ip=" + encodeURIComponent(ip) + "&inst=" + ONLINE.dev.inst, undefined, 120000);
      if (gen !== ONLINE.gen) return;
      ONLINE.busy = null;
      if (!b || !b.ok) { ONLINE.err = (b && b.err) || "Objektliste nicht lesbar."; olLayout(); return; }
      ONLINE.objs = b.objects.filter(o => READ_TYPES.has(o.type)).map(o => ({ type: o.type, inst: o.inst, name: (o.name || "").trim() || (OBJT[o.type] + " " + o.inst), nodeId: null }));
    }
  }
  ONLINE.busy = "live"; if (!silent) olLayout();
  const payload = { ip, objects: ONLINE.objs.map(o => ({ type: o.type, inst: o.inst })) };
  const r = await olFetch("/api/live", payload, 30000 + payload.objects.length * 200);   // Dienst: 10 parallel, je 1,5 s Zeitlimit
  if (gen !== ONLINE.gen) return;
  ONLINE.busy = null;
  if (!r || !r.ok) { ONLINE.err = (r && r.err) || "Werte konnten nicht gelesen werden."; olLayout(); return; }
  const vmap = new Map(r.values.map(v => [v.type + ":" + v.inst, v]));
  ONLINE.values = ONLINE.objs.map(o => Object.assign({}, o, vmap.get(o.type + ":" + o.inst) || { ok: false, err: "?" }));
  ONLINE.stamp = nowStamp(); ONLINE.err = "";
  if (ONLINE.C) setLive(ONLINE.C.cid, ONLINE.values, { source: "bacnet", ip, stamp: ONLINE.stamp });   // für Datenpunkte, Wartungsdoku …
  olLayout();
  // Auto-Refresh
  clearTimeout(ONLINE._timer);
  if (ONLINE.auto) ONLINE._timer = setTimeout(() => { if (document.body.contains(ONLINE._root) && APP.view === "online") olRefresh(true); }, 5000);
}

/* Verbindung beenden: Auto-Abfrage stoppen, laufende Antworten verwerfen, Live-Werte entfernen */
function olDisconnect() {
  ONLINE.gen++;
  clearTimeout(ONLINE._timer);
  const was = ONLINE.dev || ONLINE.busy;
  ONLINE.auto = false; ONLINE.dev = null; ONLINE.objs = null; ONLINE.values = []; ONLINE.stamp = ""; ONLINE.busy = null; ONLINE.err = "";
  if (ONLINE.C) clearLive(ONLINE.C.cid, "bacnet");
  if (was) toast("Verbindung getrennt.", "ok");
  olLayout();
}

async function olSaveCentral() {
  const ip = (ONLINE.ip || "").trim(); if (!ip) return;
  const dflt = ONLINE.dev && ONLINE.dev.name ? ONLINE.dev.name : "";
  const name = (prompt("Name für diese Zentrale:", dflt) || "").trim();
  if (!name) return;
  if (!ONLINE.cfg) ONLINE.cfg = { centrals: [], settings: {} };
  const ex = ONLINE.cfg.centrals.find(c => c.ip === ip);
  if (ex) ex.name = name; else ONLINE.cfg.centrals.push({ name, ip });
  const r = await olFetch("/api/config", ONLINE.cfg);
  toast(r && r.ok ? "Zentrale gespeichert." : "Speichern fehlgeschlagen.", r && r.ok ? "ok" : "err");
  olLayout();
}

/* ---------- Aufbau ---------- */
function olLayout() {
  const root = ONLINE._root; if (!root || !document.body.contains(root)) return;
  root.innerHTML = "";

  if (ONLINE.health === "down") {
    root.appendChild(h("div", { class: "infobar warn" }, icon("alert"),
      h("div", null,
        h("b", null, "Der Hintergrunddienst läuft nicht. "),
        "Der Online-Modus braucht das Programm ", h("code", null, "DDC-Werkbank.exe"), " aus deinem Werkbank-Ordner. ",
        "Starte es (Doppelklick) und prüfe dann erneut. Alle übrigen Funktionen der Werkbank laufen ohne den Dienst wie gewohnt.",
        h("div", { class: "row", style: { marginTop: "10px" } }, btn("Erneut prüfen", "clock", () => { ONLINE.health = "unknown"; olLayout(); olCheckHealth(); }, "accent")))));
    return;
  }
  if (ONLINE.health === "unknown") { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, spinner(), "Suche den lokalen Dienst …"))); return; }

  /* Verbindungsleiste */
  const ipIn = h("input", { class: "in", style: { width: "180px" }, placeholder: "z. B. 192.168.24.210", value: ONLINE.ip, onkeydown: e => { if (e.key === "Enter") { ONLINE.ip = e.target.value; olConnect(); } }, oninput: e => ONLINE.ip = e.target.value });
  const bar = h("div", { class: "card", style: { marginBottom: "14px" } },
    h("div", { class: "row" },
      h("span", { class: "muted" }, "Zentrale:"),
      ipIn,
      btn(ONLINE.busy === "connect" ? "Verbinde …" : (ONLINE.dev ? "Neu verbinden" : "Verbinden"), "swap", () => olConnect(), ONLINE.dev ? "" : "accent"),
      (ONLINE.dev || ONLINE.busy) ? btn("Trennen", "close", () => olDisconnect()) : null,
      (ONLINE.cfg && ONLINE.cfg.centrals.length)
        ? selectEl([["", "— gespeicherte Zentrale —"]].concat(ONLINE.cfg.centrals.map(c => [c.ip, c.name + " · " + c.ip])), "", v => { if (v) { ONLINE.ip = v; ipIn.value = v; olConnect(); } }, "sm")
        : null,
      h("span", { class: "grow" }),
      ONLINE.dev ? btn("Zentrale speichern", "pin", () => olSaveCentral()) : null));
  root.appendChild(bar);

  if (ONLINE.err && !ONLINE.dev) root.appendChild(h("div", { class: "infobar err", style: { marginBottom: "14px" } }, icon("error"), h("div", null, ONLINE.err)));

  if (!ONLINE.dev) {
    root.appendChild(h("div", { class: "card" }, emptyState("bacnet", "Nicht verbunden",
      "IP-Adresse der Zentrale eingeben und auf „Verbinden“ tippen. Der Dienst schickt ein BACnet Who-Is und liest anschließend die Live-Werte. Es wird nur gelesen.")));
    return;
  }

  /* Geräte-Karte */
  const d = ONLINE.dev, C = ONLINE.C;
  const kv = h("dl", { class: "kv" },
    h("dt", null, "Objektname"), h("dd", null, d.name || "—"),
    h("dt", null, "Modell"), h("dd", null, d.model || "—"),
    h("dt", null, "Firmware"), h("dd", null, d.firmware || "—"),
    h("dt", null, "Software"), h("dd", null, d.software || "—"),
    h("dt", null, "Device-Instanz"), h("dd", null, String(d.inst) + (d.vendor != null ? "  ·  Hersteller-ID " + d.vendor : "")));
  const dcard = h("div", { class: "card", style: { marginBottom: "14px" } }, h("h3", null, icon("station"), "Verbundene Zentrale ", h("span", { class: "badge soft" }, ONLINE.ip)), kv);
  if (C && C.meta && C.meta.bacnetDevId && String(C.meta.bacnetDevId) !== String(d.inst))
    dcard.appendChild(h("div", { class: "infobar warn", style: { marginTop: "10px" } }, icon("alert"), h("div", null, "Die geladene Sicherung gehört zu Device-Instanz ", h("b", null, String(C.meta.bacnetDevId)), ", verbunden ist aber ", h("b", null, String(d.inst)), ". Eventuell eine andere Zentrale.")));
  root.appendChild(dcard);

  /* Live-Werte */
  const src = olBacnetObjects(C) ? "aus der Sicherung" : "vom Gerät gelesen";
  const head = h("div", { class: "row", style: { marginBottom: "8px" } },
    h("h3", { style: { margin: "0" } }, icon("bacnet"), "Live-Werte"),
    ONLINE.values.length ? h("span", { class: "muted small" }, ONLINE.values.length + " Objekte " + src) : null,
    h("span", { class: "grow" }),
    ONLINE.stamp ? h("span", { class: "muted small" }, "Stand " + ONLINE.stamp) : null,
    chk("alle 5 s", ONLINE.auto, v => { ONLINE.auto = v; if (v) olRefresh(true); else clearTimeout(ONLINE._timer); }),
    btn(ONLINE.busy ? "Lese …" : "Aktualisieren", "clock", () => olRefresh(false), ONLINE.busy ? "" : "accent"));
  root.appendChild(head);

  if (ONLINE.busy === "browse") { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, spinner(), "Objektliste wird vom Gerät gelesen …"))); return; }
  if (!ONLINE.values.length && ONLINE.busy === "live") { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, spinner(), "Live-Werte werden gelesen …"))); return; }
  if (ONLINE.err) root.appendChild(h("div", { class: "infobar err", style: { marginBottom: "10px" } }, icon("error"), h("div", null, ONLINE.err)));
  if (!ONLINE.values.length) return;

  const okN = ONLINE.values.filter(v => v.ok).length;
  const tbl = h("table", { class: "grid card-t" },
    h("thead", null, h("tr", null, h("th", null, "Objekt"), h("th", null, "Name"), h("th", { class: "num" }, "Wert"), C ? h("th", null, "") : null)),
    h("tbody", null, ONLINE.values.map(o => {
      const f = bacnetText(o);
      const node = C && o.nodeId ? C.nodes.get(o.nodeId) : null;
      return h("tr", { class: o.ok ? "" : "dim" },
        h("td", { class: "mono" }, h("span", { class: "badge soft", title: OBJT_LONG[o.type] || "" }, OBJT[o.type] || o.type), " " + o.inst),
        h("td", null, o.name),
        h("td", { class: "num " + (f.cls || "") }, f.t),
        C ? h("td", null, node ? h("a", { class: "klink", title: "Zum Datenpunkt springen", onclick: () => olJump(C, o.nodeId) }, icon("jump")) : null) : null);
    })));
  const wrap = h("div", { class: "card tight" }, h("div", { class: "grid-wrap", style: { maxHeight: "calc(100vh - 360px)" } }, tbl));
  root.appendChild(h("div", { class: "muted small", style: { margin: "0 0 6px" } }, okN + " von " + ONLINE.values.length + " Objekten antworten"));
  root.appendChild(wrap);
}

function olJump(C, nodeId) {
  if (APP.cur !== C.cid) APP.cur = C.cid;
  const n = C.nodes.get(nodeId);
  if (n && n.pin) return openPin(C.cid, n.pin.uid);
  return openNode(C.cid, nodeId);
}
function spinner() { const s = h("span", { class: "spin" }); return s; }

VIEWS.add({
  id: "online", label: "Online", icon: "bacnet", group: 3, order: 310,
  render(root, C) {
    ONLINE.C = C || curC();
    root.appendChild(pageHead("Online", "Mit einer Zentrale verbinden und Live-Werte per BACnet/IP lesen – über den lokalen Dienst. Rein lesend."));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    ONLINE._root = body;
    olLayout();
    if (ONLINE.health === "unknown") olCheckHealth();
    else if (ONLINE.health === "up" && !ONLINE.cfg) olLoadConfig().then(olLayout);
  }
});

