import { clearLive, defaultLiveText, setLive, setLiveAddr } from "../core/live.js";
import { pinAddr } from "../core/addr.js";
import { LIVE_SOURCES, VIEWS } from "../core/ext.js";
import { openNode, openPin } from "../core/nav.js";
import { APP, curC } from "../core/state.js";
import { fmtNum, h, nowStamp, store } from "../core/util.js";
import { svcJson } from "../core/service.js";
import { btn, chk, emptyState, icon, pageHead, toast } from "../shell/shell.js";

/* =========================================================================
   Online – K&P direkt (CTOS, Port 18090), wie das Service-Tool.
   Liest jeden Parameter der Zentrale über seine Adresse
   (//Modul/Anlage/Gruppe/Objekt/Unterobjekt/Parameter), auch ohne BACnet.
   Anmeldung mit Benutzer/Passwort der Zentrale; das Passwort bleibt nur im
   Dienst (Arbeitsspeicher). Der Dienst laesst ausschliesslich Lesebefehle zu.
   ========================================================================= */
/* Darstellung eines gelesenen Werts in den K&P-Tabellen (Rohantwort { ok, v, pv, unit }).
   In den Datenpunkten/der Wartungsdoku zeigt die Standard-Darstellung die Werte;
   die Einheit kommt dort aus der Sicherung. */
function kpCell(o) {
  if (!o.ok) return defaultLiveText(o);
  if (typeof o.v === "boolean") return { t: o.v ? "EIN" : "AUS", cls: o.v ? "liveon" : "liveoff" };
  if (typeof o.v === "number") return { t: o.unit ? fmtNum(o.v) + " " + o.unit : fmtNum(o.v), cls: "num" };
  if (o.pv != null && o.pv !== "") { const u = o.unit && !String(o.pv).includes(o.unit) ? " " + o.unit : ""; return { t: String(o.pv) + u, cls: "" }; }
  return { t: "\u2014", cls: "muted" };
}
/* Live-Quelle: Ansichten (Programm & Wirkkette …) fordern per want() die Adressen an, die sie zeigen */
LIVE_SOURCES.add({ id: "kp", label: "K&P direkt",
  connected: cid => !!(KP.conn && KP.C && KP.C.cid === cid),
  want: (cid, addrs) => kpWant(cid, addrs) });

function pinTargets(C) {
  if (!C || C.fmt === "ddc3000" || !C.pins) return [];
  const out = [];
  for (const p of C.pins) {
    if (p.kind === "frei") continue;
    const a = pinAddr(C, p); if (a) out.push({ a, nodeId: p.nodeId, name: p.name || p.paraText || "", klemme: p.klemme });
  }
  return out;
}

const KP = { C: null, ip: store.get("kpIp", ""), port: store.get("kpPort", 18090), user: store.get("kpUser", ""), pass: "",
  status: null, conn: null, values: [], stamp: "", busy: null, err: "", auto: false, gen: 0,
  tab: "punkte", exAddr: "//", ex: null, exVals: new Map(), _root: null, _timer: null };

/* ---------- Angeforderte Adressen (aus anderen Ansichten) ---------- */
const WANT = { cur: new Set(), batch: new Set(), timer: null, readAt: new Map(), busy: false };
const FRESH_MS = 30000;
function kpWant(cid, addrs) {
  if (!KP.conn || !KP.C || KP.C.cid !== cid) return;
  for (const a of addrs) WANT.batch.add(a);
  clearTimeout(WANT.timer); WANT.timer = setTimeout(() => flushWant(false), 250);
}
/* Liest die zuletzt angeforderten Adressen; force = auch frisch gelesene erneut (Auto-Abfrage) */
async function flushWant(force) {
  if (!KP.conn || !KP.C) return;
  if (WANT.busy) { clearTimeout(WANT.timer); WANT.timer = setTimeout(() => flushWant(force), 300); return; }
  if (WANT.batch.size) { WANT.cur = WANT.batch; WANT.batch = new Set(); }
  const now = Date.now();
  const list = [...WANT.cur].filter(a => force || !(WANT.readAt.get(a) > now - FRESH_MS));
  if (!list.length) return;
  for (const a of list) WANT.readAt.set(a, now);   // auch bei Fehler nicht sofort erneut
  WANT.busy = true;
  const gen = KP.gen, C = KP.C;
  const r = await kp("lesen", { ip: KP.conn.ip, port: KP.conn.port, adressen: list }, 30000 + list.length * 60);
  WANT.busy = false;
  if (gen !== KP.gen || !r) return;
  if (!r.ok) { if (r.login) { KP.conn = null; KP.err = "Sitzung abgelaufen, bitte neu verbinden."; layout(); } return; }
  setLiveAddr(C.cid, r.values, { source: "kp", ip: KP.conn.ip, stamp: nowStamp() });
}
function wantReset() { clearTimeout(WANT.timer); WANT.cur = new Set(); WANT.batch = new Set(); WANT.readAt = new Map(); WANT.busy = false; }

/* Auto-Abfrage alle 5 s – auch wenn eine andere Ansicht offen ist */
function schedAuto() {
  clearTimeout(KP._timer);
  if (!KP.auto || !KP.conn) return;
  KP._timer = setTimeout(async () => {
    if (!KP.auto || !KP.conn) return;
    if (APP.view === "online-kp" && KP.tab === "punkte") await kpRead(true);
    else { await flushWant(true); schedAuto(); }
  }, 5000);
}

async function kp(path, body, ms) {
  try { const j = await svcJson("/api/kp/" + path, body, ms || 20000); KP.health = "up"; return j; }
  catch (e) { console.warn("Dienst:", e.message || e); KP.health = "down"; return null; }
}

async function kpStatus() {
  const r = await kp("status");
  if (!r) { KP.health = "down"; layout(); return; }
  KP.status = r;
  if (!KP.ip && r.sessions && r.sessions[0]) KP.ip = r.sessions[0].ip;
  layout();
}

async function kpConnect() {
  const ip = (KP.ip || "").trim();
  if (!ip) { toast("Bitte IP-Adresse der Zentrale eingeben.", "warn"); return; }
  if (!KP.pass) { toast("Bitte Passwort der Zentrale eingeben.", "warn"); return; }
  store.set("kpIp", ip); store.set("kpUser", KP.user); store.set("kpPort", KP.port);
  const gen = ++KP.gen;
  KP.busy = "connect"; KP.err = ""; KP.conn = null; KP.values = []; KP.ex = null; KP.exVals = new Map(); wantReset(); layout();
  const r = await kp("verbinden", { ip, port: KP.port, user: KP.user, pass: KP.pass });
  if (gen !== KP.gen) return;
  KP.busy = null; KP.pass = "";
  if (!r) { layout(); return; }
  if (!r.ok) { KP.err = r.err || "Keine Verbindung."; layout(); return; }
  KP.conn = { ip, port: KP.port, host: r.host, language: r.language };
  layout();
  if (KP.tab === "punkte") kpRead();
  else kpBrowse(KP.exAddr);
}

async function kpDisconnect() {
  const was = KP.conn;
  KP.gen++; clearTimeout(KP._timer);
  const ip = KP.conn ? KP.conn.ip : (KP.ip || "").trim(), port = KP.conn ? KP.conn.port : KP.port;
  KP.conn = null; KP.auto = false; KP.values = []; KP.stamp = ""; KP.busy = null; KP.err = ""; KP.ex = null; KP.exVals = new Map(); wantReset();
  if (KP.C) clearLive(KP.C.cid, "kp");
  await kp("trennen", { ip, port });
  if (was) toast("Verbindung getrennt.", "ok");
  layout();
}

async function kpRead(silent) {
  if (!KP.conn || KP.busy) return;
  const C = KP.C, targets = pinTargets(C);
  if (!targets.length) { KP.err = "Zu dieser Sicherung gibt es keine lesbaren Klemmen-Adressen."; layout(); return; }
  const gen = KP.gen;
  KP.busy = "read"; if (!silent) layout();
  const r = await kp("lesen", { ip: KP.conn.ip, port: KP.conn.port, adressen: targets.map(t => t.a) }, 30000 + targets.length * 60);
  if (gen !== KP.gen) return;
  KP.busy = null;
  if (!r || !r.ok) { if (r && r.login) { KP.conn = null; KP.err = "Sitzung abgelaufen, bitte neu verbinden."; } else KP.err = (r && r.err) || "Lesen fehlgeschlagen."; layout(); return; }
  const byAddr = new Map(r.values.map(v => [v.a, v]));
  KP.values = targets.map(t => Object.assign({ nodeId: t.nodeId, name: t.name, klemme: t.klemme }, byAddr.get(t.a) || { ok: false, err: "?" }));
  KP.stamp = nowStamp(); KP.err = "";
  if (C) setLive(C.cid, KP.values.map(v => ({ nodeId: v.nodeId, ok: v.ok,
    value: typeof v.v === "number" || typeof v.v === "boolean" ? v.v : undefined,
    text: v.ok && !(typeof v.v === "number" || typeof v.v === "boolean") ? (v.pv != null ? String(v.pv) : null) : undefined,
    err: v.err })), { source: "kp", ip: KP.conn.ip, stamp: KP.stamp });
  if (C) { const t = Date.now(); for (const v of r.values) WANT.readAt.set(v.a, t); setLiveAddr(C.cid, r.values, { source: "kp", ip: KP.conn.ip, stamp: KP.stamp }); }
  layout();
  if (KP.auto && WANT.cur.size) await flushWant(true);
  schedAuto();
}

async function kpBrowse(addr) {
  if (!KP.conn || KP.busy) return;
  const gen = KP.gen;
  KP.busy = "browse"; KP.exAddr = addr; KP.err = ""; layout();
  const r = await kp("explorer", { ip: KP.conn.ip, port: KP.conn.port, adresse: addr }, 60000);
  if (gen !== KP.gen) return;
  KP.busy = null;
  if (!r || !r.ok) { if (r && r.login) { KP.conn = null; } KP.err = (r && r.err) || "Explorer fehlgeschlagen."; layout(); return; }
  KP.ex = r;
  for (const it of r.items) if (it.pv != null || it.unit) KP.exVals.set((addr === "//" ? "//" : addr) + "/" + it.a, it);
  layout();
}

/* ---------- Aufbau ---------- */
function connBar() {
  const C = KP.C;
  const ipIn = h("input", { class: "in", style: { width: "170px" }, placeholder: "z. B. 192.168.3.200", value: KP.ip, oninput: e => KP.ip = e.target.value, onkeydown: e => { if (e.key === "Enter") kpConnect(); } });
  const userIn = h("input", { class: "in", style: { width: "110px" }, placeholder: "Benutzer", value: KP.user, oninput: e => KP.user = e.target.value });
  const passIn = h("input", { class: "in", type: "password", style: { width: "120px" }, placeholder: "Passwort", value: KP.pass, oninput: e => KP.pass = e.target.value, onkeydown: e => { if (e.key === "Enter") kpConnect(); } });
  return h("div", { class: "card", style: { marginBottom: "14px" } },
    h("div", { class: "row" },
      h("span", { class: "muted" }, "Zentrale:"), ipIn,
      KP.conn ? null : userIn, KP.conn ? null : passIn,
      btn(KP.busy === "connect" ? "Verbinde \u2026" : (KP.conn ? "Neu verbinden" : "Verbinden"), "swap", kpConnect, KP.conn ? "" : "accent"),
      KP.conn ? btn("Trennen", "close", kpDisconnect) : null,
      h("span", { class: "grow" }),
      KP.conn ? h("span", { class: "badge soft", title: "Hostnummer der Zentrale" }, "Host " + KP.conn.host) : null));
}

function layout() {
  const root = KP._root; if (!root || !document.body.contains(root)) return;
  root.innerHTML = "";

  if (KP.health === "down") {
    root.appendChild(h("div", { class: "infobar warn" }, icon("alert"),
      h("div", null, h("b", null, "Der Hintergrunddienst laeuft nicht. "),
        "K&P direkt braucht ", h("code", null, "DDC-Werkbank.exe"), " (mind. v0.3) aus deinem Werkbank-Ordner. Starte es und pruefe erneut.",
        h("div", { class: "row", style: { marginTop: "10px" } }, btn("Erneut pruefen", "clock", () => { KP.health = "unknown"; layout(); kpStatus(); }, "accent")))));
    return;
  }
  if (!KP.status) { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, h("span", { class: "spin" }), "Suche den lokalen Dienst \u2026"))); return; }

  if (!KP.status.salt) {
    root.appendChild(h("div", { class: "infobar warn", style: { marginBottom: "14px" } }, icon("alert"),
      h("div", null, h("b", null, "Schluesseldatei nicht gefunden. "),
        "K&P direkt braucht die Schluesseldatei (Salz) aus dem K&P Service-Tool. Der Dienst sucht sie in ",
        h("code", null, "C:\\Program Files (x86)\\Kieback&Peter\\Service-Tool"), ". ",
        "Ist das Service-Tool woanders installiert, lege die Datei ", h("code", null, "salt*.hg1k"),
        " (aus ", h("code", null, "plugins\\de.hologarage.kup.util_*.jar"), ") in den Ordner ", h("code", null, "daten\\"), " neben der .exe.")));
  }

  root.appendChild(connBar());
  if (KP.err) root.appendChild(h("div", { class: "infobar err", style: { marginBottom: "14px" } }, icon("error"), h("div", null, KP.err)));

  if (!KP.conn) {
    root.appendChild(h("div", { class: "card" }, emptyState("bacnet", "Nicht verbunden",
      "IP, Benutzer und Passwort der Zentrale eingeben und auf \u201eVerbinden\u201c tippen. So liest die Werkbank wie das Service-Tool jeden Wert \u2013 auch ohne BACnet. Es wird nur gelesen.")));
    return;
  }

  /* Reiter */
  const tab = (id, label) => h("button", { class: KP.tab === id ? "on" : "", onclick: () => { KP.tab = id; layout(); if (id === "punkte" && !KP.values.length) kpRead(); if (id === "explorer" && !KP.ex) kpBrowse(KP.exAddr); } }, label);
  root.appendChild(h("div", { class: "seg", style: { marginBottom: "12px" } }, tab("punkte", "Klemmen"), tab("explorer", "Explorer")));

  if (KP.tab === "punkte") renderPunkte(root);
  else renderExplorer(root);
}

function renderPunkte(root) {
  const C = KP.C;
  if (!C) { root.appendChild(h("div", { class: "card" }, emptyState("folder", "Keine Sicherung geladen", "Lade zuerst eine Sicherung; dann liest die Werkbank die Werte zu ihren Klemmen. Ohne Sicherung nutze den Reiter \u201eExplorer\u201c."))); return; }
  const head = h("div", { class: "row", style: { marginBottom: "8px" } },
    h("h3", { style: { margin: "0" } }, icon("bacnet"), "Live-Werte der Klemmen"),
    KP.values.length ? h("span", { class: "muted small" }, KP.values.length + " Klemmen") : null,
    h("span", { class: "grow" }),
    KP.stamp ? h("span", { class: "muted small" }, "Stand " + KP.stamp) : null,
    chk("alle 5 s", KP.auto, v => { KP.auto = v; if (v) kpRead(true); else clearTimeout(KP._timer); }),
    btn(KP.busy === "read" ? "Lese \u2026" : "Aktualisieren", "clock", () => kpRead(false), KP.busy ? "" : "accent"));
  root.appendChild(head);
  if (!KP.values.length && KP.busy === "read") { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, h("span", { class: "spin" }), "Werte werden gelesen \u2026"))); return; }
  if (!KP.values.length) return;
  const okN = KP.values.filter(v => v.ok).length;
  const tbl = h("table", { class: "grid card-t" },
    h("thead", null, h("tr", null, h("th", null, "Klemme"), h("th", null, "Name"), h("th", { class: "num" }, "Wert"), h("th", null, ""))),
    h("tbody", null, KP.values.map(o => {
      const f = kpCell(o), node = C.nodes.get(o.nodeId);
      return h("tr", { class: o.ok ? "" : "dim" },
        h("td", { class: "mono" }, o.klemme),
        h("td", null, o.name),
        h("td", { class: "num " + (f.cls || "") }, f.t),
        h("td", null, node ? h("a", { class: "klink", title: "Zum Datenpunkt springen", onclick: () => jump(C, o.nodeId) }, icon("jump")) : null));
    })));
  root.appendChild(h("div", { class: "muted small", style: { margin: "0 0 6px" } }, okN + " von " + KP.values.length + " Klemmen antworten"));
  root.appendChild(h("div", { class: "card tight" }, h("div", { class: "grid-wrap", style: { maxHeight: "calc(100vh - 380px)" } }, tbl)));
}

function renderExplorer(root) {
  const parts = KP.exAddr === "//" ? [] : KP.exAddr.replace(/^\/\//, "").split("/");
  const crumbs = [h("a", { class: "klink", onclick: () => kpBrowse("//") }, "//")];
  let acc = "/";
  for (const p of parts) { acc += "/" + p; const a = acc; crumbs.push(h("span", { class: "muted" }, " / "), h("a", { class: "klink", onclick: () => kpBrowse(a) }, p)); }
  root.appendChild(h("div", { class: "row", style: { marginBottom: "8px" } },
    h("h3", { style: { margin: "0" } }, icon("list"), "Explorer"), h("span", { class: "mono small" }, ...crumbs),
    h("span", { class: "grow" }),
    btn(KP.busy === "browse" ? "Lade \u2026" : "Aktualisieren", "clock", () => kpBrowse(KP.exAddr), KP.busy ? "" : "")));
  if (KP.busy === "browse" && !KP.ex) { root.appendChild(h("div", { class: "card" }, h("div", { class: "row" }, h("span", { class: "spin" }), "Objekte werden gelesen \u2026"))); return; }
  if (!KP.ex) return;
  const items = KP.ex.items;
  if (!items.length) { root.appendChild(h("div", { class: "card" }, emptyState("list", "Keine Unterobjekte", "Dieses Objekt hat keine Kinder."))); return; }
  const base = KP.exAddr === "//" ? "/" : KP.exAddr;
  const tbl = h("table", { class: "grid card-t" },
    h("thead", null, h("tr", null, h("th", null, "Adresse"), h("th", null, "Typ"), h("th", null, "Text"), h("th", { class: "num" }, "Wert"), h("th", null, ""))),
    h("tbody", null, items.map(it => {
      const full = (base === "/" ? "" : base) + "/" + it.a;
      const f = it.pv != null && it.pv !== "" ? kpCell({ ok: true, pv: it.pv, unit: it.unit }) : { t: "", cls: "" };
      return h("tr", null,
        h("td", { class: "mono" }, it.kids ? h("a", { class: "klink", onclick: () => kpBrowse(full) }, it.a) : it.a),
        h("td", { class: "mono muted" }, it.t || ""),
        h("td", null, it.txt || it.n || ""),
        h("td", { class: "num " + (f.cls || "") }, f.t),
        h("td", null, it.kids ? h("a", { class: "klink", title: "\u00d6ffnen", onclick: () => kpBrowse(full) }, icon("jump")) : null));
    })));
  root.appendChild(h("div", { class: "card tight" }, h("div", { class: "grid-wrap", style: { maxHeight: "calc(100vh - 380px)" } }, tbl)));
}

function jump(C, nodeId) {
  if (APP.cur !== C.cid) APP.cur = C.cid;
  const n = C.nodes.get(nodeId);
  if (n && n.pin) return openPin(C.cid, n.pin.uid);
  return openNode(C.cid, nodeId);
}

VIEWS.add({
  id: "online-kp", label: "K&P direkt", icon: "bacnet", group: 3, order: 320,
  render(root, C) {
    KP.C = C || curC();
    root.appendChild(pageHead("K&P direkt", "Wie das Service-Tool: mit Benutzer/Passwort anmelden und jeden Wert der Zentrale lesen (Port 18090). Rein lesend."));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    KP._root = body;
    if (!KP.status) { KP.health = "unknown"; layout(); kpStatus(); } else layout();
  }
});
