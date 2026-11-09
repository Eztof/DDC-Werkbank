import { FORMATS } from "../core/ext.js";
import { store } from "../core/util.js";
import { fixCp850 } from "../p90/backup.js";

/* =========================================================================
   DDC3000 – Vorlagen der Schnellparametrierung (PS4000 → system\makro.sp).
   Sie nennen je Gerätetyp und Menü die Parameter mit Art (AX/AI/DS/DM/V …),
   Einheit und Standardtext. Damit werden P90-/EZR-Sicherungen OHNE
   mitgesicherte Definitionen genauer (Art, Einheit, Name der Parameter).

   Die Dateien gehören Kieback&Peter und kommen NICHT ins Repo: der Benutzer
   zieht den Ordner makro.sp (oder ein ZIP davon) einmal in die Werkbank,
   die Auszüge bleiben im Browser gespeichert (store "d3makro").
   ========================================================================= */
const KEY = "d3makro";
let TABLE = null;            // { files: { "DDC3200/GPLüftung": { "5100": [kind, unit, name] } }, stamp }

export function makroTable() {
  if (!TABLE) TABLE = store.get(KEY, null) || { files: {}, stamp: "" };
  return TABLE;
}
export const makroCount = () => Object.keys(makroTable().files).length;
export function clearMakro() { TABLE = { files: {}, stamp: "" }; store.set(KEY, TABLE); }

/* Eine Vorlage lesen → { base: [kind, unit, name] } */
export function parseMakro(text) {
  const defs = {};
  const out = {};
  let cur = null;
  const clean = s => s.replace(/!.*$/, "").trim();
  const nameOf = k => {
    let s = String(k || "").trim();
    if (s.startsWith("!")) s = s.slice(1);
    s = s.replace(/_[A-Z][A-Z0-9]*/g, t => (t === "_ANL" || t === "_RK") ? "" : (defs[t] != null ? defs[t] : ""));
    return s.replace(/\s+/g, " ").trim();
  };
  for (const raw of text.split(/\r?\n/)) {
    let m;
    if ((m = raw.match(/^#def\s+(_\w+)\s+(.*)$/))) { defs[m[1]] = clean(m[2]); continue; }
    if ((m = raw.match(/^(AX|AI|DS|DM|TX|V|T|L)\s+P=\s*([^\s;/]+)/))) {
      cur = { kind: m[1], base: m[2], unit: "", name: "" };
      if (!out[cur.base]) out[cur.base] = cur;
      else cur = { ...cur };                       // doppelter Eintrag: erster gewinnt
    } else if (/^\S/.test(raw)) { cur = null; continue; }
    if (!cur) continue;
    const km = raw.match(/;\s*K=(.*)$/) || raw.match(/^\s*K=(.*)$/);
    if (km && !cur.name) cur.name = nameOf(km[1]);
    const em = raw.match(/(?:^|[\s;])E=([^;]*)/);
    if (em && !cur.unit) cur.unit = clean(em[1]);
  }
  const res = {};
  for (const [b, c] of Object.entries(out)) res[b] = [c.kind, c.unit, c.name];
  return res;
}

/* Datei → Schlüssel "DDC3200/GPLüftung" (Ordner unter makro.sp + Dateiname ohne .mak) */
function keyOf(path, name) {
  const parts = String(path || name).split(/[\\/]/).filter(Boolean);
  const file = (parts.pop() || name).replace(/\.mak$/i, "");
  return (parts.pop() || "") + "/" + file;
}

/* Kandidaten in Suchreihenfolge für einen Gerätetyp (Name aus devtypes, z. B. "DDC3200", "LÜFTUNG", "EZR31", "FBR01/02") */
function candidates(typ) {
  const T = String(typ || "").toUpperCase();
  const d3000 = /^EZR|^DDC303|^DDC3035/.test(T);
  const folder = d3000 ? "DDC3000" : "DDC3200";
  const own = [];
  if (T === "LÜFTUNG") own.push("GPLüftung");
  else if (T === "HEIZUNG") own.push("GPHeizung");
  else if (T === "FESTWERT") own.push("GPFestwert");
  else if (/^EZR\d\d$/.test(T)) own.push(T.slice(0, 4) + "0");
  else if (/^DDC30\d\d/.test(T) && !d3000) own.push("DDC3200");
  else own.push(typ.replace("/", "-"), typ.replace("/", "_"), typ.replace(/\/.*$/, ""));
  if (d3000 && /^DDC/.test(T)) own.unshift("DDC3035");
  return { folder, own: own.map(f => folder + "/" + f) };
}

/* Nachschlagen: Gerätetyp + Parameter → { kind, unit, name } | null */
export function makroDef(typ, base) {
  const F = makroTable().files;
  if (!Object.keys(F).length) return null;
  const { folder, own } = candidates(typ);
  for (const k of own) { const e = F[k] && F[k][base]; if (e) return { kind: e[0], unit: e[1], name: e[2] }; }
  for (const [k, tab] of Object.entries(F)) if (k.startsWith(folder + "/M") || k.startsWith(folder + "/00")) {
    const e = tab[base]; if (e) return { kind: e[0], unit: e[1], name: e[2] };
  }
  return null;
}

/* ---------- Als „Dateiformat“ anmelden: Dateien aus makro.sp übernehmen ---------- */
let note = null;
FORMATS.add({
  id: "d3makro", order: 5, icon: "list", label: "Schnellparametrierung (Vorlagen)",
  desc: "Ordner makro.sp aus PS4000 (system\\makro.sp) – Namen und Arten der DDC3000-Parameter, wenn eine Sicherung ohne Definitionen ist.",
  exts: ["mak"],
  sniff: (name, head, text, path) => (/\.mak$/i.test(name) || /(^|[\\/])makro\.sp[\\/]/i.test(path || "")) && /^(AX|AI|DS|DM|V|K|B|M|N)\s+(P|NR)=/m.test(text),
  open(text, f) {
    const key = keyOf(f.path, f.name);
    if (!/^DDC3(000|200)\//i.test(key)) return null;          // DDC100/MRP … nicht nötig
    const T = makroTable();
    T.files[key] = parseMakro(/[äöüÄÖÜß°]/.test(text) ? text : fixCp850(text));   // Vorlagen sind DOS-Text (CP850)
    T.stamp = new Date().toLocaleString("de-DE");
    clearTimeout(note);
    note = setTimeout(() => {
      store.set(KEY, T);
      import("../shell/shell.js").then(s => s.toast("Schnellparametrierung: " + makroCount() + " Vorlagen übernommen. DDC3000-Sicherungen (.p90/.EZR) ohne Definitionen bitte neu öffnen.", "ok", 8000));
    }, 300);
    return null;
  }
});
