import { $, h, store } from "./util.js";
import { TYPE_NAMES, nodePlace } from "../model/model.js";
import { SEV } from "../model/findings.js";
import { APP, icon, kindTag, openNode, openPin, renderAll, selectEl } from "../shell/shell.js";
import { lkAks, lkCanon, lkInvalidate } from "../wartung/link.js";
import { ONLINE_BASE } from "../views/online.js";

/* =========================================================================
   Merkliste der Werkbank
   Was nicht in die Wartungsdoku gehört, aber beim nächsten Start wieder da
   sein soll: abgehakte Befunde, Entscheidungen der Verknüpfung, Einstellungen.
   Läuft der Dienst (DDC-Werkbank.exe), liegt alles im Werkbank-Ordner unter
   „daten\<name>.json“. Der Browser hält eine Kopie – so geht es auch ohne
   Dienst; beim nächsten Start mit Dienst werden beide Stände zusammengeführt
   (je Eintrag gewinnt der neuere).
   ========================================================================= */
export const PERSIST = { svc: false, old: false, gen: 1, data: {}, timer: {}, lastTry: 0 };
const PERSIST_FILES = ["befunde", "verknuepfung", "einstellungen"];

function pfile(name) {
  let d = PERSIST.data[name];
  if (!d) {
    d = store.get("p." + name, null);
    if (!d || typeof d !== "object" || !d.entries) d = { entries: {} };
    PERSIST.data[name] = d;
  }
  return d;
}
export const pentry = (name, key) => pfile(name).entries[key] || null;
export function pput(name, key, v, extra) { pfile(name).entries[key] = Object.assign({ v, t: Date.now() }, extra || {}); psave(name); }
function pmerge(a, b) {
  const out = { entries: Object.assign({}, (a && a.entries) || {}) };
  for (const [k, e] of Object.entries((b && b.entries) || {})) { const c = out.entries[k]; if (!c || (e && (e.t || 0) > (c.t || 0))) out.entries[k] = e; }
  return out;
}
function psave(name) {
  store.set("p." + name, pfile(name));
  if (!PERSIST.svc) return;
  clearTimeout(PERSIST.timer[name]);
  PERSIST.timer[name] = setTimeout(() => psync(name), 400);
}
async function psync(name) {
  try {
    const r = await fetch(ONLINE_BASE + "/api/data/" + name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pfile(name)) });
    const j = await r.json();
    if (j && j.ok && j.data) { PERSIST.data[name] = pmerge(pfile(name), j.data); store.set("p." + name, PERSIST.data[name]); }
  } catch (e) { PERSIST.svc = false; }
}
/* Beim Start: Dienst fragen, zusammenführen, zurückschreiben */
export async function persistInit() {
  PERSIST.lastTry = Date.now();
  persistMigrate();
  let h = null;
  try { h = await (await fetch(ONLINE_BASE + "/api/health")).json(); } catch (e) { h = null; }
  if (!h || !h.ok) { PERSIST.svc = false; return; }
  if (!h.data) { PERSIST.old = true; PERSIST.svc = false; return; }        // Dienst zu alt (ohne Merkliste)
  let changed = false;
  for (const name of PERSIST_FILES) {
    try {
      const j = await (await fetch(ONLINE_BASE + "/api/data/" + name)).json();
      const local = pfile(name), merged = pmerge(local, j && j.data);
      if (JSON.stringify(merged) !== JSON.stringify(local)) changed = true;
      PERSIST.data[name] = merged; store.set("p." + name, merged);
      if (JSON.stringify(merged) !== JSON.stringify((j && j.data) || { entries: {} })) {
        await fetch(ONLINE_BASE + "/api/data/" + name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(merged) });
      }
    } catch (e) { return; }
  }
  PERSIST.svc = true; PERSIST.old = false;
  PERSIST.gen++; lkInvalidate();
  for (const C of APP.centrals) refreshSev(C);
  if (changed || $("#content")) renderAll();
}
/* Altbestand aus früheren Versionen (nur im Browser) übernehmen */
function persistMigrate() {
  const old = store.get("lkDecisions", null);
  if (old && typeof old === "object") {
    for (const [k, v] of Object.entries(old)) if (!pentry("verknuepfung", k)) pfile("verknuepfung").entries[k] = { v, t: 1 };
    store.set("p.verknuepfung", pfile("verknuepfung"));
  }
  for (const k of ["wdPruefer", "lkInfoMode", "airTypes"]) {
    const v = store.get(k, undefined);
    if (v !== undefined && !pentry("einstellungen", k)) pfile("einstellungen").entries[k] = { v, t: 1 };
  }
  store.set("p.einstellungen", pfile("einstellungen"));
}
/* Dienst später gestartet? Beim Zurückkehren ins Fenster erneut versuchen */
window.addEventListener("focus", () => { if (!PERSIST.svc && Date.now() - PERSIST.lastTry > 15000) persistInit(); });
export const persistWhere = () => PERSIST.svc ? "im Werkbank-Ordner (daten\\…)" : "nur in diesem Browser";

/* ---------- Einstellungen ---------- */
export function pref(key, dflt) { const e = pentry("einstellungen", key); return e ? e.v : store.get(key, dflt); }
export function setPref(key, v) { pput("einstellungen", key, v); store.set(key, v); }

/* ---------- Abgehakte Befunde ---------- */
/* Station wiedererkennen – auch nach dem Neuladen einer neueren Sicherung */
function stationKey(C) {
  if (C._skey) return C._skey;
  const cnt = new Map();
  for (const p of C.pins) { const a = lkAks(p.name); if (!a) continue; const hd = lkCanon(a).split("_")[0]; cnt.set(hd, (cnt.get(hd) || 0) + 1); }
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
  return (C._skey = [C.format, C.meta.name, C.meta.centralAddr, C.meta.bacnetDevId, top ? top[0] : ""].join("|"));
}
const ignKey = (C, f) => stationKey(C) + "||" + f.cat + "|" + f.title;
export function isIgnored(C, f) { const e = pentry("befunde", ignKey(C, f)); return !!(e && e.v); }
export function setIgnored(C, fs, v) {
  const now = Date.now(), E = pfile("befunde").entries;
  for (const f of fs) E[ignKey(C, f)] = { v: v ? 1 : 0, t: now, s: C.meta.name, x: f.title };
  psave("befunde");
  refreshSev(C);
}
export const activeFindings = C => C.findings.filter(f => !isIgnored(C, f));
/* Markierungen an Klemmen/Bausteinen nur aus nicht abgehakten Befunden */
export function refreshSev(C) {
  if (!C || !C.findings) return;
  const m = new Map();
  for (const f of C.findings) {
    if (isIgnored(C, f)) continue;
    const id = f.ref && (f.ref.node || f.ref.pin);
    if (id && SEV[f.sev] > (SEV[m.get(id)] || 0)) m.set(id, f.sev);
  }
  C.nodeSev = m;
  for (const p of C.pins) p.sev = m.get(p.nodeId) || null;
}
/* Worauf zeigt ein Befund? Klemme, Baustein oder mehrere */
export function findingWhere(C, f) {
  const r = f.ref; if (!r) return null;
  let p = r.pin ? C.pins.find(x => x.uid === r.pin) : null;
  const n = r.node ? C.nodes.get(r.node) : null;
  if (!p && n && n.pin) p = n.pin;
  if (p) return { pin: p };
  if (n) return { node: n };
  if (r.nodes && r.nodes.length) return { nodes: r.nodes };
  return null;
}
export function whereLine(C, f) {
  const w = findingWhere(C, f);
  if (!w) return null;
  if (w.pin) return h("span", { class: "where" }, kindTag(w.pin.kind), " ", h("a", { class: "klink", title: "In der Datenpunktliste zeigen", onclick: e => { e.stopPropagation(); openPin(C.cid, w.pin.uid); } }, icon("jump"), "Klemme " + w.pin.klemme), " ", h("span", { class: "muted" }, w.pin.name || w.pin.paraText || ""));
  if (w.node) return h("span", { class: "where" }, h("a", { class: "klink", title: "Im Programm zeigen", onclick: e => { e.stopPropagation(); openNode(C.cid, w.node.id); } }, icon("flow"), (w.node.name || TYPE_NAMES[w.node.type] || w.node.type) + " · " + w.node.addr), " ", h("span", { class: "muted" }, nodePlace(C, w.node)));
  return h("span", { class: "where muted" }, w.nodes.length + " Bausteine betroffen");
}
/* Schalter „Abhaken“ */
export function ignButton(C, fs, after) {
  const on = fs.every(f => isIgnored(C, f));
  return h("button", { class: "btn sm ign" + (on ? " on" : ""), title: on ? "Wieder als offenen Befund zeigen" : "Kann ignoriert werden – in „Befunde“ und „Befunde als Mängel“ ausblenden", onclick: e => { e.stopPropagation(); setIgnored(C, fs, !on); (after || renderAll)(); } },
    icon(on ? "check" : "eyeoff"), on ? "Abgehakt" : "Abhaken");
}
/* Auswahl „Abgehakte …“ (gemeinsam für beide Ansichten) */
export function ignFilterEl() {
  return selectEl([["aus", "Abgehakte ausblenden"], ["an", "Abgehakte anzeigen"], ["nur", "Nur abgehakte"]], APP.ignView || "aus", v => { APP.ignView = v; renderAll(); }, "sm");
}
export const ignPass = (C, f) => { const i = isIgnored(C, f), v = APP.ignView || "aus"; return v === "an" || (v === "nur" ? i : !i); };

