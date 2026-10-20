import { natCmp } from "../core/util.js";
import { CHECKS } from "../core/ext.js";
import { store } from "../core/util.js";
import "./checks/handeingriffe.js";
import "./checks/station.js";
import "./checks/dreipunkt.js";
import "./checks/ddc3000.js";
import "./checks/klemmen.js";
import "./checks/logik.js";

/* =========================================================================
   Befunde: automatische Prüfungen auf das Modell.
   Die einzelnen Prüfungen liegen in model/checks/ und tragen sich in
   CHECKS ein (core/ext.js). Eine neue Prüfung = eine neue Datei dort.
   ========================================================================= */
export const SEV = { err: 3, warn: 2, info: 1 };
export const SEV_LABEL = { err: "Fehler", warn: "Warnung", info: "Hinweis" };

/* Abgeschaltete Prüfungen (Einstellung in der Ansicht „Befunde“) */
export const checksOff = () => new Set(store.get("checksOff", []));
export function setCheckOff(id, off) {
  const s = checksOff(); off ? s.add(id) : s.delete(id);
  store.set("checksOff", [...s]);
}
export const checksFor = C => CHECKS.list(K => !K.formats || K.formats.includes(C.format));

export function runFindings(C) {
  const F = [], off = checksOff();
  C.checkErrors = [];
  for (const K of checksFor(C)) {
    if (off.has(K.id)) continue;
    const add = (sev, cat, title, detail, ref) => F.push({ sev: SEV[sev] ? sev : "info", cat: cat || K.cat || K.label, title: String(title ?? ""), detail: detail || "", ref: ref || null, check: K.id });
    const t0 = performance.now();
    try { K.run(C, add); }
    catch (e) {
      console.error("Prüfung " + K.id + ":", e);
      C.checkErrors.push(K.id);
      F.push({ sev: "info", cat: "Werkbank", title: "Prüfung „" + (K.label || K.id) + "“ konnte nicht vollständig laufen", detail: String(e && e.message || e), ref: null, check: K.id });
    }
    const ms = performance.now() - t0;
    if (ms > 500) console.warn("Prüfung " + K.id + " braucht " + Math.round(ms) + " ms");
  }
  F.sort((a, b) => SEV[b.sev] - SEV[a.sev] || natCmp(a.cat, b.cat) || natCmp(a.title, b.title));
  F.forEach((f, i) => f.id = i);
  C.findings = F;
  C._sidx = null;            // Suchindex neu aufbauen
  C.nodeSev = new Map();
  for (const f of F) {
    const id = f.ref && (f.ref.node || f.ref.pin);
    if (id && SEV[f.sev] > (SEV[C.nodeSev.get(id)] || 0)) C.nodeSev.set(id, f.sev);
  }
  for (const p of C.pins) p.sev = C.nodeSev.get(p.nodeId) || null;
  return F;
}
