import { clearLive, defaultLiveText, setLive, setLiveAddr } from "../core/live.js";
import { pinAddr } from "../core/addr.js";
import { LIVE_SOURCES, VIEWS } from "../core/ext.js";
import { on } from "../core/events.js";
import { openNode, openPin } from "../core/nav.js";
import { APP, byCid, curC } from "../core/state.js";
import { fmtNum, h, nowStamp, store } from "../core/util.js";
import { svcJson } from "../core/service.js";
import { btn, chk, emptyState, icon, pageHead, toast } from "../shell/shell.js";

/* =========================================================================
   Online – K&P direkt (CTOS, Port 18090), wie das Service-Tool.
   Liest jeden Parameter der Zentrale über seine Adresse
   (//Modul/Anlage/Gruppe/Objekt/Unterobjekt/Parameter), auch ohne BACnet.
   Mehrere Zentralen gleichzeitig: Liste aller geladenen Sicherungen mit der
   IP aus der Sicherung (SY_Network), eine, mehrere oder alle verbinden.
   Anmeldung mit Benutzer/Passwort der Zentrale; das Passwort bleibt nur im
   Dienst (Arbeitsspeicher). Der Dienst lässt ausschließlich Lesebefehle zu.
   ========================================================================= */
const DEFAULT_PASS = "2460";
const FRESH_MS = 30000;
const PARALLEL = 4;   // gleichzeitige Anmeldungen bei „alle verbinden“

/* Darstellung eines gelesenen Werts in den K&P-Tabellen (Rohantwort { ok, v, pv, unit }) */
function kpCell(o) {
  if (!o.ok) return defaultLiveText(o);
  if (typeof o.v === "boolean") return { t: o.v ? "EIN" : "AUS", cls: o.v ? "liveon" : "liveoff" };
  if (typeof o.v === "number") return { t: o.unit ? fmtNum(o.v) + " " + o.unit : fmtNum(o.v), cls: "num" };
  if (o.pv != null && o.pv !== "") { const u = o.unit && !String(o.pv).includes(o.unit) ? " " + o.unit : ""; return { t: String(o.pv) + u, cls: "" }; }
  return { t: "\u2014", cls: "muted" };
}

/* Live-Quelle: Ansichten (Programm & Wirkkette …) fordern per want() die Adressen an, die sie zeigen */
LIVE_SOURCES.add({ id: "kp", label: "K&P direkt",
  connected: cid => { const c = KP.conns.get(cid); return !!(c && c.on); },
  want: (cid, addrs) => kpWant(cid, addrs) });

function pinTargets(C) {
  if (!C || C.format === "DDC3000" || !C.pins) return [];
  const out = [];
  for (const p of C.pins) {
    if (p.kind === "frei") continue;
    const a = pinAddr(C, p); if (a) out.push({ a, nodeId: p.nodeId, name: p.name || p.paraText || "", klemme: p.klemme });
  }
  return out;
}

const iv = () => Math.max(1, Math.min(3600, parseInt(KP.interval, 10) || 5));
const KP = {
  port: store.get("kpPort", 18090), user: store.get("kpUser", ""), pass: DEFAULT_PASS,
  interval: store.get("kpInterval", 5), auto: false,
  status: null, health: "unknown",
  conns: new Map(),          // Schlüssel (cid oder "ip:…") → Verbindung
  pick: new Set(),           // angehakte Zeilen
  sel: null,                 // Verbindung, deren Klemmen/Explorer unten gezeigt werden
  manIp: store.get("kpIp", ""),
  tab: "punkte", _root: null, _timer: null
};

/* ---------- Zentralen aus den Sicherungen ---------- */
const ipKey = C => "kpip|" + (C.meta.centralAddr || "") + "|" + (C.meta.name || C.label || "");
function ipOf(C) { const o = store.get("kpIps", {}); return (o[ipKey(C)] || C.meta.ip || "").trim(); }
function setIpOf(C, ip) { const o = store.get("kpIps", {}); if (ip && ip !== C.meta.ip) o[ipKey(C)] = ip; else delete o[ipKey(C)]; store.set("kpIps", o); }
const kpCentrals = () => APP.centrals.filter(C => C.format !== "DDC3000");
const nameOf = C => C.meta.name || C.label || C.fileName || C.cid;

/* Verbindung: { key, cid, ip, port, on, host, busy, err, values, stamp, gen, want } */
function conn(key) {
  if (!KP.conns.has(key)) KP.conns.set(key, { key, cid: byCid(key) ? key : null, ip: "", port: KP.port, on: false, host: null, busy: null, err: "",
    values: [], stamp: "", gen: 0, ex: null, exAddr: "//", want: { cur: new Set(), batch: new Set(), timer: null, readAt: new Map(), busy: false } });
  return KP.conns.get(key);
}
const connected = () => [...KP.conns.values()].filter(c => c.on);
const selConn = () => KP.sel && KP.conns.get(KP.sel) || null;

/* ---------- Dienst ---------- */
async function kp(path, body, ms) {
  try { const j = await svcJson("/api/kp/" + path, body, ms || 20000); KP.health = "up"; return j; }
  catch (e) { console.warn("Dienst:", e.message || e); KP.health = "down"; return null; }
}
async function kpStatus() {
  const r = await kp("status");
  if (!r) { KP.health = "down"; layout(); return; }
  KP.status = r;
  layout();
}

/* ---------- Verbinden / Trennen ---------- */
async function connect(key, ip, quiet) {
  ip = (ip || "").trim();
  if (!ip) { if (!quiet) toast("Bitte IP-Adresse eingeben.", "warn"); return false; }
  if (!KP.pass) { if (!quiet) toast("Bitte Passwort der Zentrale eingeben.", "warn"); return false; }
  store.set("kpUser", KP.user); store.set("kpPort", KP.port);
  const c = conn(key);
  if (c.on) await kp("trennen", { ip: c.ip, port: c.port });
  const gen = ++c.gen;
  Object.assign(c, { ip, port: KP.port, on: false, host: null, busy: "connect", err: "", values: [], stamp: "", ex: null });
  wantReset(c);
  if (!KP.sel) KP.sel = key;
  layout();
  const r = await kp("verbinden", { ip, port: c.port, user: KP.user, pass: KP.pass });
  if (gen !== c.gen) return false;
  c.busy = null;
  if (!r || !r.ok) { c.err = r ? (r.err || "Keine Verbindung.") : "Dienst antwortet nicht."; layout(); return false; }
  Object.assign(c, { on: true, host: r.host, language: r.language });
  layout();
  if (c.cid) await readPins(c, true);
  else if (KP.sel === key && KP.tab === "explorer") browse(c, c.exAddr);
  schedAuto();
  return true;
}
async function disconnect(c, quiet) {
  if (!c) return;
  c.gen++;
  const was = c.on || c.busy;
  Object.assign(c, { on: false, busy: null, err: "", values: [], stamp: "", ex: null, host: null });
  wantReset(c);
  if (c.cid) clearLive(c.cid, "kp");
  if (c.ip) await kp("trennen", { ip: c.ip, port: c.port });
  if (!c.cid) KP.conns.delete(c.key);
  if (!connected().length) { KP.auto = false; clearTimeout(KP._timer); }
  if (was && !quiet) toast("Verbindung getrennt.", "ok");
  layout();
}
/* Mehrere: höchstens PARALLEL Anmeldungen gleichzeitig */
async function connectMany(list) {
  const todo = list.filter(C => ipOf(C));
  const skipped = list.length - todo.length;
  if (skipped) toast(skipped + " Zentrale(n) ohne IP-Adresse übersprungen.", "warn");
  let i = 0, ok = 0;
  const worker = async () => { while (i < todo.length) { const C = todo[i++]; if (await connect(C.cid, ipOf(C), true)) ok++; } };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  if (todo.length) toast(ok + " von " + todo.length + " Zentralen verbunden.", ok === todo.length ? "ok" : "warn");
}
async function disconnectAll() {
  const list = [...KP.conns.values()].filter(c => c.on || c.busy);
  await Promise.all(list.map(c => disconnect(c, true)));
  if (list.length) toast("Alle Verbindungen getrennt.", "ok");
}

/* ---------- Lesen ---------- */
function sessionLost(c, r) {
  if (r && r.login) { c.on = false; c.err = "Sitzung abgelaufen, bitte neu verbinden."; if (c.cid) clearLive(c.cid, "kp"); return true; }
  return false;
}
async function readPins(c, silent) {
  if (!c.on || c.busy || !c.cid) return;
  const C = byCid(c.cid), targets = pinTargets(C);
  if (!targets.length) { c.err = "Zu dieser Sicherung gibt es keine lesbaren Klemmen-Adressen."; layout(); return; }
  const gen = c.gen;
  c.busy = "read"; if (!silent) layout();
  const r = await kp("lesen", { ip: c.ip, port: c.port, adressen: targets.map(t => t.a) }, 30000 + targets.length * 60);
  if (gen !== c.gen) return;
  c.busy = null;
  if (!r || !r.ok) { if (!sessionLost(c, r)) c.err = (r && r.err) || "Lesen fehlgeschlagen."; layout(); return; }
  const byAddr = new Map(r.values.map(v => [v.a, v]));
  c.values = targets.map(t => Object.assign({ nodeId: t.nodeId, name: t.name, klemme: t.klemme }, byAddr.get(t.a) || { ok: false, err: "?" }));
  c.stamp = nowStamp(); c.err = "";
  setLive(c.cid, c.values.map(v => ({ nodeId: v.nodeId, ok: v.ok,
    value: typeof v.v === "number" || typeof v.v === "boolean" ? v.v : undefined,
    text: v.ok && !(typeof v.v === "number" || typeof v.v === "boolean") ? (v.pv != null ? String(v.pv) : null) : undefined,
    err: v.err })), { source: "kp", ip: c.ip, stamp: c.stamp });
  const t = Date.now(); for (const v of r.values) c.want.readAt.set(v.a, t);
  setLiveAddr(c.cid, r.values, { source: "kp", ip: c.ip, stamp: c.stamp });
  if (silent) softLayout(); else layout();
}
async function browse(c, addr) {
  if (!c || !c.on || c.busy) return;
  const gen = c.gen;
  c.busy = "browse"; c.exAddr = addr; c.err = ""; layout();
  const r = await kp("explorer", { ip: c.ip, port: c.port, adresse: addr }, 60000);
  if (gen !== c.gen) return;
  c.busy = null;
  if (!r || !r.ok) { if (!sessionLost(c, r)) c.err = (r && r.err) || "Explorer fehlgeschlagen."; layout(); return; }
  c.ex = r;
  layout();
}

/* ---------- Angeforderte Adressen (aus anderen Ansichten) ---------- */
function kpWant(cid, addrs) {
  const c = KP.conns.get(cid); if (!c || !c.on) return;
  for (const a of addrs) c.want.batch.add(a);
  clearTimeout(c.want.timer); c.want.timer = setTimeout(() => flushWant(c, false), 250);
}
/* Liest die zuletzt angeforderten Adressen; force = auch frisch gelesene erneut (Auto-Abfrage) */
async function flushWant(c, force) {
  const W = c.want;
  if (!c.on || !c.cid) return;
  if (W.busy) { clearTimeout(W.timer); W.timer = setTimeout(() => flushWant(c, force), 300); return; }
  if (W.batch.size) { W.cur = W.batch; W.batch = new Set(); }
  const now = Date.now();
  const list = [...W.cur].filter(a => force || !(W.readAt.get(a) > now - FRESH_MS));
  if (!list.length) return;
  for (const a of list) W.readAt.set(a, now);   // auch bei Fehler nicht sofort erneut
  W.busy = true;
  const gen = c.gen;
  const r = await kp("lesen", { ip: c.ip, port: c.port, adressen: list }, 30000 + list.length * 60);
  W.busy = false;
  if (gen !== c.gen || !r) return;
  if (!r.ok) { if (sessionLost(c, r)) layout(); return; }
  setLiveAddr(c.cid, r.values, { source: "kp", ip: c.ip, stamp: nowStamp() });
}
function wantReset(c) { const W = c.want; clearTimeout(W.timer); W.cur = new Set(); W.batch = new Set(); W.readAt = new Map(); W.busy = false; }

/* ---------- Auto-Abfrage im eingestellten Takt – auch in anderen Ansichten ----------
   In „K&P direkt“: Klemmen aller verbundenen Zentralen. Sonst nur die aktuelle
   Zentrale: in Programm & Wirkkette die angezeigten Adressen, sonst ihre Klemmen. */
function schedAuto() {
  clearTimeout(KP._timer);
  if (!KP.auto || !connected().length) return;
  KP._timer = setTimeout(async () => {
    if (!KP.auto) return;
    const C = curC(), here = APP.view === "online-kp";
    const jobs = connected().map(c => {
      if (here) return readPins(c, true);
      if (!C || c.cid !== C.cid) return null;
      return APP.view === "program" ? flushWant(c, true) : Promise.all([readPins(c, true), c.want.cur.size ? flushWant(c, true) : null]);
    });
    await Promise.all(jobs);
    schedAuto();
  }, iv() * 1000);
}

/* ---------- Aufbau ---------- */
function loginCard() {
  const userIn = h("input", { class: "in", style: { width: "110px" }, placeholder: "Benutzer", value: KP.user, oninput: e => KP.user = e.target.value });
  const passIn = h("input", { class: "in", type: "password", style: { width: "110px" }, placeholder: "Passwort", value: KP.pass, oninput: e => KP.pass = e.target.value });
  const portIn = h("input", { class: "in", style: { width: "70px" }, title: "TCP-Port (Standard 18090)", value: String(KP.port), oninput: e => KP.port = parseInt(e.target.value, 10) || 18090 });
  const ivIn = h("input", { class: "in", type: "number", min: "1", max: "3600", style: { width: "64px" }, title: "Abfrage-Intervall in Sekunden", value: String(KP.interval),
    onchange: e => { KP.interval = e.target.value; KP.interval = iv(); e.target.value = String(KP.interval); store.set("kpInterval", KP.interval); schedAuto(); } });
  const manIn = h("input", { class: "in", style: { width: "150px" }, placeholder: "andere IP …", value: KP.manIp, oninput: e => KP.manIp = e.target.value,
    onkeydown: e => { if (e.key === "Enter") connectManual(); } });
  return h("div", { class: "card", style: { marginBottom: "14px" } },
    h("div", { class: "row" },
      h("span", { class: "muted" }, "Anmeldung:"), userIn, passIn,
      h("span", { class: "muted" }, "Port"), portIn,
      h("span", { class: "grow" }),
      chk("automatisch alle", KP.auto, v => { KP.auto = v; if (v) schedAuto(); else clearTimeout(KP._timer); layout(); }),
      ivIn, h("span", { class: "muted" }, "s")),
    h("div", { class: "row", style: { marginTop: "8px" } },
      h("span", { class: "muted" }, "Ohne Sicherung:"), manIn,
      btn("Verbinden", "swap", connectManual),
      h("span", { class: "muted small" }, "nur Explorer")));
}
function connectManual() {
  const ip = (KP.manIp || "").trim(); if (!ip) return toast("Bitte IP-Adresse eingeben.", "warn");
  store.set("kpIp", ip);
  const C = kpCentrals().find(x => ipOf(x) === ip);
  if (C) { KP.sel = C.cid; return connect(C.cid, ip); }
  KP.sel = "ip:" + ip; KP.tab = "explorer";
  connect("ip:" + ip, ip);
}

function statusCell(c, C) {
  if (!c) return h("span", { class: "muted" }, "\u2014");
  if (c.busy === "connect") return h("span", { class: "row" }, h("span", { class: "spin" }), "verbinde \u2026");
  if (c.on) {
    const wrong = C && C.meta.centralAddr && c.host != null && parseInt(C.meta.centralAddr, 10) !== c.host;
    const okN = c.values.filter(v => v.ok).length;
    return h("span", null, h("span", { class: "badge ok" }, "verbunden"), " ",
      h("span", { class: "muted small" }, "Host " + c.host + (c.values.length ? " \u00b7 " + okN + "/" + c.values.length + " Klemmen" : c.busy === "read" ? " \u00b7 lese \u2026" : "")),
      wrong ? h("div", { class: "small", style: { color: "var(--warn)" } }, "Hostnummer passt nicht zur Sicherung (Zentrale " + C.meta.centralAddr + ")") : null);
  }
  if (c.err) return h("span", { class: "small", style: { color: "var(--err)" } }, c.err);
  return h("span", { class: "muted" }, "\u2014");
}

function centralsCard() {
  const list = kpCentrals();
  const card = h("div", { class: "card", style: { marginBottom: "14px" } });
  const nOn = connected().length;
  const picked = list.filter(C => KP.pick.has(C.cid));
  card.appendChild(h("div", { class: "row", style: { marginBottom: "8px" } },
    h("h3", { style: { margin: "0" } }, icon("station"), "Zentralen"),
    h("span", { class: "muted small" }, list.length + " aus den Sicherungen" + (nOn ? " \u00b7 " + nOn + " verbunden" : "")),
    h("span", { class: "grow" }),
    btn("Ausgewählte verbinden" + (picked.length ? " (" + picked.length + ")" : ""), "swap", () => picked.length ? connectMany(picked) : toast("Erst Zentralen anhaken.", "inf")),
    btn("Alle verbinden", "swap", () => connectMany(list), list.length ? "accent" : ""),
    nOn ? btn("Alle trennen", "close", disconnectAll) : null));
  if (!list.length) {
    card.appendChild(emptyState("folder", "Keine Sicherung geladen", "Lade die Datensicherungen deiner Zentralen – die IP-Adressen stehen darin. Oder unten eine IP direkt eingeben (nur Explorer)."));
    return card;
  }
  const allBox = h("input", { type: "checkbox", checked: list.every(C => KP.pick.has(C.cid)), title: "Alle anhaken",
    onchange: e => { list.forEach(C => e.target.checked ? KP.pick.add(C.cid) : KP.pick.delete(C.cid)); layout(); } });
  const rows = list.map(C => {
    const c = KP.conns.get(C.cid);
    const ipIn = h("input", { class: "in mono", style: { width: "140px" }, placeholder: "IP fehlt", value: ipOf(C),
      onchange: e => { setIpOf(C, e.target.value.trim()); } });
    const box = h("input", { type: "checkbox", checked: KP.pick.has(C.cid), onchange: e => { e.target.checked ? KP.pick.add(C.cid) : KP.pick.delete(C.cid); layout(); } });
    return h("tr", { class: (KP.sel === C.cid ? "on" : ""), "data-cid": C.cid },
      h("td", null, box),
      h("td", null, h("a", { class: "klink", title: "Klemmen/Explorer dieser Zentrale unten zeigen", onclick: () => { KP.sel = C.cid; layout(); } }, nameOf(C)),
        C.cid === APP.cur ? h("span", { class: "muted small" }, "  \u00b7 aktuell") : null),
      h("td", { class: "mono" }, C.meta.centralAddr || ""),
      h("td", null, ipIn),
      h("td", null, statusCell(c, C)),
      h("td", { class: "nowrap" }, c && (c.on || c.busy) ? btn("Trennen", "close", () => disconnect(c), "sm") : btn("Verbinden", "swap", () => { KP.sel = C.cid; connect(C.cid, ipIn.value); }, "sm")));
  });
  card.appendChild(h("div", { class: "grid-wrap", style: { maxHeight: "40vh" } }, h("table", { class: "grid card-t kp-list" },
    h("thead", null, h("tr", null, h("th", null, allBox), h("th", null, "Sicherung"), h("th", null, "Zentrale"), h("th", null, "IP-Adresse"), h("th", null, "Status"), h("th", null, ""))),
    h("tbody", null, rows))));
  return card;
}

/* Auto-Abfrage: nicht neu aufbauen, während jemand in ein Feld tippt – nach dem Verlassen nachholen */
function softLayout() {
  const a = document.activeElement, root = KP._root;
  if (root && a && root.contains(a) && a.tagName === "INPUT" && a.type !== "checkbox") {
    if (!KP._dirty) { KP._dirty = true; a.addEventListener("blur", () => { if (KP._dirty) layout(); }, { once: true }); }
    return;
  }
  layout();
}
function layout() {
  KP._dirty = false;
  const root = KP._root; if (!root || !document.body.contains(root)) return;
  root.innerHTML = "";

  if (KP.health === "down") {
    root.appendChild(h("div", { class: "infobar warn" }, icon("alert"),
      h("div", null, h("b", null, "Der Hintergrunddienst läuft nicht. "),
        "K&P direkt braucht ", h("code", null, "DDC-Werkbank.exe"), " (mind. v0.3) aus deinem Werkbank-Ordner. Starte es und prüfe erneut.",
        h("div", { class: "row", style: { marginTop: "10px" } }, btn("Erneut prüfen", "clock", () => { KP.health = "unknown"; layout(); kpStatus(); }, "accent")))));
    return;
  }
  if (!KP.status) { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, h("span", { class: "spin" }), "Suche den lokalen Dienst \u2026"))); return; }

  if (!KP.status.salt) {
    root.appendChild(h("div", { class: "infobar warn", style: { marginBottom: "14px" } }, icon("alert"),
      h("div", null, h("b", null, "Schlüsseldatei nicht gefunden. "),
        "K&P direkt braucht die Schlüsseldatei (Salz) aus dem K&P Service-Tool. Der Dienst sucht sie in ",
        h("code", null, "C:\\Program Files (x86)\\Kieback&Peter\\Service-Tool"), ". ",
        "Ist das Service-Tool woanders installiert, lege die Datei ", h("code", null, "salt*.hg1k"),
        " (aus ", h("code", null, "plugins\\de.hologarage.kup.util_*.jar"), ") in den Ordner ", h("code", null, "daten\\"), " neben der .exe.")));
  }

  root.appendChild(loginCard());
  root.appendChild(centralsCard());

  const c = selConn();
  if (!c || !(c.on || c.busy)) {
    if (!connected().length) root.appendChild(h("div", { class: "card" }, emptyState("bacnet", "Nicht verbunden",
      "Zentralen anhaken und „Ausgewählte verbinden“ – oder „Alle verbinden“. Danach liest die Werkbank wie das Service-Tool jeden Wert, auch ohne BACnet. Es wird nur gelesen.")));
    else root.appendChild(h("div", { class: "muted small" }, "Zentrale in der Liste anklicken, um ihre Klemmen oder den Explorer zu sehen."));
    if (c && c.err && !c.cid) root.appendChild(h("div", { class: "infobar err", style: { marginTop: "10px" } }, icon("error"), h("div", null, c.err)));
    return;
  }

  const C = c.cid ? byCid(c.cid) : null;
  const title = C ? nameOf(C) : c.ip;
  const tab = (id, label) => h("button", { class: KP.tab === id ? "on" : "", onclick: () => { KP.tab = id; layout(); if (id === "punkte" && !c.values.length) readPins(c); if (id === "explorer" && !c.ex) browse(c, c.exAddr); } }, label);
  root.appendChild(h("div", { class: "row", style: { marginBottom: "12px" } },
    h("div", { class: "seg" }, C ? tab("punkte", "Klemmen") : null, tab("explorer", "Explorer")),
    h("b", null, title), h("span", { class: "muted small" }, c.ip)));
  if (c.err && c.on) root.appendChild(h("div", { class: "infobar err", style: { marginBottom: "10px" } }, icon("error"), h("div", null, c.err)));

  if (KP.tab === "punkte" && C) renderPunkte(root, c, C);
  else renderExplorer(root, c);
}

function renderPunkte(root, c, C) {
  root.appendChild(h("div", { class: "row", style: { marginBottom: "8px" } },
    h("h3", { style: { margin: "0" } }, icon("bacnet"), "Live-Werte der Klemmen"),
    c.values.length ? h("span", { class: "muted small" }, c.values.length + " Klemmen") : null,
    h("span", { class: "grow" }),
    c.stamp ? h("span", { class: "muted small" }, "Stand " + c.stamp) : null,
    btn(c.busy === "read" ? "Lese \u2026" : "Aktualisieren", "clock", () => readPins(c, false), c.busy ? "" : "accent")));
  if (!c.values.length && c.busy) { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, h("span", { class: "spin" }), "Werte werden gelesen \u2026"))); return; }
  if (!c.values.length) return;
  const okN = c.values.filter(v => v.ok).length;
  const tbl = h("table", { class: "grid card-t" },
    h("thead", null, h("tr", null, h("th", null, "Klemme"), h("th", null, "Name"), h("th", { class: "num" }, "Wert"), h("th", null, ""))),
    h("tbody", null, c.values.map(o => {
      const f = kpCell(o), node = C.nodes.get(o.nodeId);
      return h("tr", { class: o.ok ? "" : "dim" },
        h("td", { class: "mono" }, o.klemme),
        h("td", null, o.name),
        h("td", { class: "num " + (f.cls || "") }, f.t),
        h("td", null, node ? h("a", { class: "klink", title: "Zum Datenpunkt springen", onclick: () => jump(C, o.nodeId) }, icon("jump")) : null));
    })));
  root.appendChild(h("div", { class: "muted small", style: { margin: "0 0 6px" } }, okN + " von " + c.values.length + " Klemmen antworten"));
  root.appendChild(h("div", { class: "card tight" }, h("div", { class: "grid-wrap", style: { maxHeight: "calc(100vh - 380px)" } }, tbl)));
}

function renderExplorer(root, c) {
  const addr = c.exAddr || "//";
  const parts = addr === "//" ? [] : addr.replace(/^\/\//, "").split("/");
  const crumbs = [h("a", { class: "klink", onclick: () => browse(c, "//") }, "//")];
  let acc = "/";
  for (const p of parts) { acc += "/" + p; const a = acc; crumbs.push(h("span", { class: "muted" }, " / "), h("a", { class: "klink", onclick: () => browse(c, a) }, p)); }
  root.appendChild(h("div", { class: "row", style: { marginBottom: "8px" } },
    h("h3", { style: { margin: "0" } }, icon("list"), "Explorer"), h("span", { class: "mono small" }, ...crumbs),
    h("span", { class: "grow" }),
    btn(c.busy === "browse" ? "Lade \u2026" : "Aktualisieren", "clock", () => browse(c, addr))));
  if (c.busy && !c.ex) { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, h("span", { class: "spin" }), "Objekte werden gelesen \u2026"))); return; }
  if (!c.ex) return;
  const items = c.ex.items;
  if (!items.length) { root.appendChild(h("div", { class: "card" }, emptyState("list", "Keine Unterobjekte", "Dieses Objekt hat keine Kinder."))); return; }
  const base = addr === "//" ? "/" : addr;
  const tbl = h("table", { class: "grid card-t" },
    h("thead", null, h("tr", null, h("th", null, "Adresse"), h("th", null, "Typ"), h("th", null, "Text"), h("th", { class: "num" }, "Wert"), h("th", null, ""))),
    h("tbody", null, items.map(it => {
      const full = (base === "/" ? "" : base) + "/" + it.a;
      const f = it.pv != null && it.pv !== "" ? kpCell({ ok: true, pv: it.pv, unit: it.unit }) : { t: "", cls: "" };
      return h("tr", null,
        h("td", { class: "mono" }, it.kids ? h("a", { class: "klink", onclick: () => browse(c, full) }, it.a) : it.a),
        h("td", { class: "mono muted" }, it.t || ""),
        h("td", null, it.txt || it.n || ""),
        h("td", { class: "num " + (f.cls || "") }, f.t),
        h("td", null, it.kids ? h("a", { class: "klink", title: "\u00d6ffnen", onclick: () => browse(c, full) }, icon("jump")) : null));
    })));
  root.appendChild(h("div", { class: "card tight" }, h("div", { class: "grid-wrap", style: { maxHeight: "calc(100vh - 380px)" } }, tbl)));
}

function jump(C, nodeId) {
  if (APP.cur !== C.cid) APP.cur = C.cid;
  const n = C.nodes.get(nodeId);
  if (n && n.pin) return openPin(C.cid, n.pin.uid);
  return openNode(C.cid, nodeId);
}

/* Sicherung entfernt → ihre Verbindung trennen */
on("zentralen", ({ centrals }) => {
  const keep = new Set(centrals.map(c => c.cid));
  for (const c of [...KP.conns.values()]) if (c.cid && !keep.has(c.cid)) { disconnect(c, true); KP.conns.delete(c.key); KP.pick.delete(c.cid); }
});

VIEWS.add({
  id: "online-kp", label: "K&P direkt", icon: "bacnet", group: 3, order: 320,
  render(root, C) {
    const cur = C || curC();
    if (!KP.sel && cur) KP.sel = cur.cid;
    root.appendChild(pageHead("K&P direkt", "Wie das Service-Tool: anmelden und jeden Wert lesen (Port 18090) – eine, mehrere oder alle Zentralen der geladenen Sicherungen. Rein lesend."));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    KP._root = body;
    if (!KP.status) { KP.health = "unknown"; layout(); kpStatus(); } else layout();
  }
});
