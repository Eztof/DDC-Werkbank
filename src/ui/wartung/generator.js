import { natCmp, unitLabel, xesc } from "../core/util.js";
import { KIND_INFO } from "../model/model.js";
import { APP } from "../shell/shell.js";
import { nameGroups, regroupPlants } from "./anlagen.js";

/* =========================================================================
   Ansicht: Wartungsdoku (WTGML) – Logik aus dem Wartungsdoku-Generator
   ========================================================================= */
export const WTG_NS = "http://wtg.domain.core.wtg.kup";
const STATION_JOBS = [
  ["false", "true", "Aktualisierung und Pflege der Systemsoftware"],
  ["true", "true", "Änderungen der Zugriffsberechtigungen"],
  ["false", "false", "Anschlussverbindungen auf elektrische/mechanische Funktion prüfen, ggf. nachziehen"],
  ["false", "false", "Auf fach- und funktionsgerechte Installation und Umgebungsbedingungen prüfen"],
  ["false", "false", "Auf Verschmutzung, Beschädigung, Korrosion und Befestigung prüfen"],
  ["true", "true", "Aufbewahrung der zuletzt erstellten Programm- und Datenkopien"],
  ["false", "false", "Be- und Entlüftung (Luftweg, Kühler) auf Verschmutzung prüfen"],
  ["false", "false", "Be- und Entlüftung (Luftweg, Kühler) reinigen"],
  ["false", "false", "Eigenspannungsversorgung (z.B. Pufferbatterie) austauschen"],
  ["false", "true", "Eigenspannungsversorgung (z.B. Pufferbatterie) prüfen"],
  ["true", "true", "Einstellwerte (Parameter) sichern und dokumentieren"],
  ["false", "false", "Elektrische/elektronische/pneumatische Eingangssignale (z.B. Fühler, Ferneinsteller, Führungsgröße) prüfen"],
  ["false", "false", "Filter der Be- und Entlüftung prüfen und reinigen und ggf. auswechseln"],
  ["false", "false", "Funktionselemente (z.B. Bedien- und Anzeigeeinrichtungen) einstellen, justieren, ggf. nachziehen"],
  ["false", "false", "Funktionselemente (z.B. Bedien- und Anzeigeein-richtungen) prüfen"],
  ["false", "false", "Funktionserhaltendes Reinigen"],
  ["false", "true", "Funktionsprüfung mit Hilfe von Testprogrammen durchführen"],
  ["false", "false", "Netzausfall und -wiederkehrverhalten prüfen"],
  ["true", "true", "Regelkreis/Modulfunktion/Optimierungsfunktion gemäß Einstellparameter unter Berücksichtigung aller Zusatzfunktionen korrigieren/nachstellen Optimierungsfunktionen ggf. an veränderte Parameter anpassen"],
  ["true", "true", "Regelkreis/Modulfunktion/Optimierungsfunktion gemäß Einstellparameter unter Berücksichtigung aller Zusatzfunktionen prüfen"],
  ["false", "false", "Sicherung der anlagenspezifischen Daten (Parameter, Graphiken, Konfigurationsdateien etc.) durchführen"],
  ["false", "true", "Signale abgleichen"],
  ["false", "true", "Überprüfung der Zugriffsberechtigungen"],
  ["false", "true", "Verifizierung der Datensicherung"]
];
const STATION_PROPS = [["BUS Systemadresse", "Text"], ["letzter Batteriewechsel", "Datum"], ["Softwareversion", "Text"], ["nächster Batteriewechsel", "Datum"], ["Netzwerkparameter", "Text"]];
const PRODUKT_DOC = { DDC4200: "2.60-10.200-01-DE-DDC4200.pdf", DDC4200E: "2.60-10-210-01-DE-DDC4200e-2017-04-13.pdf" };
let GID = 1;
export const newGid = () => "g" + (GID++);

/* ---------- Gruppierung ---------- */
const tok = v => String(v || "").trim().split(/\s+/).filter(Boolean);
export function dominantPrefix(names) {
  const lists = names.map(tok).filter(t => t.length > 1);
  if (lists.length < 3) return [];
  const pre = []; let pool = lists;
  for (let d = 0; d < 3; d++) {
    const cnt = new Map();
    pool.forEach(t => { const w = t[d]; if (w !== undefined && t.length > d + 1) cnt.set(w, (cnt.get(w) || 0) + 1); });
    if (!cnt.size) break;
    let best = null, bn = 0;
    cnt.forEach((n, w) => { if (n > bn) { bn = n; best = w; } });
    if (bn < Math.max(3, lists.length * 0.8)) break;
    pre.push(best); pool = pool.filter(t => t[d] === best);
  }
  return pre;
}
function stripPrefix(tokens, prefix) { let n = 0; while (n < prefix.length && n < tokens.length - 1 && tokens[n] === prefix[n]) n++; return tokens.slice(n); }
export function autoGroup(pins, maxSize, prefix) {
  prefix = prefix || [];
  const named = pins.filter(p => p.name.trim() !== ""), unnamed = pins.filter(p => p.name.trim() === "");
  const root = { ch: new Map(), items: [], count: 0 };
  named.forEach(p => {
    let n = root; n.count++;
    for (const w of tok(p.name)) { if (!n.ch.has(w)) n.ch.set(w, { ch: new Map(), items: [], count: 0 }); n = n.ch.get(w); n.count++; }
    n.items.push(p);
  });
  let out = [];
  const flat = n => { const a = [...n.items]; n.ch.forEach(c => a.push(...flat(c))); return a; };
  (function walk(node, path) {
    if (node.count === 0) return;
    if (node.count <= maxSize || node.ch.size === 0) { out.push({ path, pins: flat(node) }); return; }
    if (node.ch.size === 1 && node.items.length === 0) { const [w, c] = [...node.ch][0]; walk(c, path.concat(w)); return; }
    if (node.items.length) out.push({ path, pins: node.items.slice() });
    node.ch.forEach((c, w) => walk(c, path.concat(w)));
  })(root, []);
  const common = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  const floor = prefix.length;
  for (let pass = 0; pass < 6; pass++) {
    let done = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i].pins.length > 2) continue;
      let best = -1, bl = 0;
      [i - 1, i + 1].forEach(j => {
        if (j < 0 || j >= out.length) return;
        const l = common(out[i].path, out[j].path);
        if (l > floor && l >= bl && out[i].pins.length + out[j].pins.length <= maxSize) { bl = l; best = j; }
      });
      if (best < 0) continue;
      const keep = Math.min(i, best), drop = Math.max(i, best);
      out[keep] = { path: out[keep].path.slice(0, bl), pins: out[keep].pins.concat(out[drop].pins) };
      out.splice(drop, 1); done = false; break;
    }
    if (done) break;
  }
  out.forEach(g => { g.name = stripPrefix(g.path, prefix).join(" ") || g.path.join(" ") || "Allgemein"; });
  const byName = new Map();
  out.forEach(g => { if (!byName.has(g.name)) byName.set(g.name, []); byName.get(g.name).push(g); });
  const merged = [], gone = new Set();
  out.forEach(g => {
    if (gone.has(g)) return;
    const same = byName.get(g.name);
    if (same.length > 1) { same.forEach(x => gone.add(x)); merged.push({ name: g.name, pins: same.reduce((a, x) => a.concat(x.pins), []) }); }
    else merged.push(g);
  });
  out = merged;
  if (unnamed.length) out.push({ name: "Ohne Bezeichnung", pins: unnamed });
  return out.filter(g => g.pins.length);
}
export function applyGroups(W, list) {
  W.groups = list.map(g => ({ gid: newGid(), name: g.name }));
  list.forEach((g, i) => g.pins.forEach(p => p.gid = W.groups[i].gid));
  W.pins.filter(p => !p.gid || !W.groups.some(g => g.gid === p.gid)).forEach(p => p.gid = W.groups.length ? W.groups[0].gid : null);
}
function regroupAuto(W, maxSize) { applyGroups(W, autoGroup(W.pins.filter(p => p.include), maxSize, W.prefix)); }
function regroupModule(W, C) {
  const map = new Map();
  W.pins.filter(p => p.include).forEach(p => { if (!map.has(p.module)) map.set(p.module, []); map.get(p.module).push(p); });
  const nm = (mod, pins) => C.format === "DDC3000" ? (mod === "0" ? "Grundgerät" : "Kreis " + mod) + " · " + (pins[0].moduleType || "") : "Modul " + mod + " · " + (pins[0].moduleType || "Modul");
  applyGroups(W, [...map].sort((a, b) => natCmp(a[0], b[0])).map(([mod, pins]) => ({ name: nm(mod, pins), pins })));
}
function regroupOne(W) { applyGroups(W, [{ name: "MSR-Datenpunkte", pins: W.pins.filter(p => p.include) }]); }
export function setKlartext(W, mode) {
  W.opt.klartext = mode;
  W.pins.forEach(p => {
    if (!p.name.trim() || mode === "voll") { p.klartext = p.name; return; }
    if (mode === "zentrale") { p.klartext = stripPrefix(tok(p.name), W.prefix).join(" ") || p.name; return; }
    const g = W.groups.find(x => x.gid === p.gid);
    if (g && g.name) { const i = p.name.indexOf(g.name); if (i >= 0) { p.klartext = p.name.slice(i + g.name.length).trim() || p.name; return; } }
    p.klartext = stripPrefix(tok(p.name), W.prefix).join(" ") || p.name;
  });
}
export function wdModel(C) {
  if (APP.wd[C.cid]) return APP.wd[C.cid];
  const m = C.meta;
  const pins = C.pins.map(p => {
    const v = p.value.stored;
    const ul = v ? unitLabel(v.unit) : "";
    return { uid: p.uid, module: p.module, moduleType: p.moduleType, addr: p.addr, klemme: p.klemme, name: (p.name || p.paraText || "").trim(), kind: p.kind,
      raw: v ? v.text : null, unitLbl: /^\[/.test(ul) ? "" : ul, include: p.kind !== "frei", klartext: "", gid: null };
  });
  const prefix = dominantPrefix(pins.filter(p => p.include && p.name).map(p => p.name));
  const W = {
    cid: C.cid, pins, groups: [], prefix, use: true,
    stationType: (m.stationType || (C.format === "DDC3000" ? "DDC3000" : "DDC")).toUpperCase(), centralAddr: m.centralAddr, bacnetDevId: m.bacnetDevId, applRev: m.applRev, build: m.build,
    isp: { bez: m.name, station: true, facName: "ISP " + m.name, artBez: "Automationsstation mit Bedienfunktion", produktDoc: PRODUKT_DOC[(m.stationType || "").toUpperCase()] || PRODUKT_DOC[m.stationType] || "", fillProps: true },
    opt: { info: "klemme", sortKind: false, klartext: "zentrale", grpMax: 12, mode: "anlage", splitAt: 0 }
  };
  W.C = C;
  regroupBy(W); setKlartext(W, W.opt.klartext);
  APP.wd[C.cid] = W;
  return W;
}

/* ---------- XML ---------- */
function wtag(ind, name, val) { return ind + "<" + name + ">" + xesc(val) + "</" + name + ">\n"; }
function propBlock(ind, desc, value, type) {
  let x = ind + "<articleProperties>\n" + wtag(ind + "    ", "description", desc);
  if (value != null && value !== "") x += wtag(ind + "    ", "value", value);
  return x + wtag(ind + "    ", "length", "0") + wtag(ind + "    ", "type", type || "Text") + wtag(ind + "    ", "checked", "true") + ind + "</articleProperties>\n";
}
function jobBlock(ind, rm, team, desc) {
  return ind + '<job remoteMaintenanceActivitie="' + rm + '" teamActivitie="' + team + '">\n' + wtag(ind + "    ", "jobDescription", desc) + wtag(ind + "    ", "targetTime", "0") + ind + "</job>\n";
}
export function infoValue(W, p) {
  if (W.opt.info === "leer") return "";
  if (W.opt.info === "klemme") return "Klemme " + p.klemme;
  const v = p.raw != null && p.raw !== "" ? (p.raw === "true" ? "EIN" : p.raw === "false" ? "AUS" : p.raw + (p.unitLbl ? " " + p.unitLbl : "")) : "";
  return "Klemme " + p.klemme + (v ? " · " + v : "");
}
function stationArtikel(W, sortId, ind) {
  const I = ind, I1 = I + "    ", I2 = I1 + "    ";
  let x = I + '<Artikel active="true" sortId="' + sortId + '">\n' + wtag(I1, "nummer", W.stationType) + I1 + "<installationClass>\n";
  x += wtag(I2, "description", "6.1 Anlagen-Automationseinrichtungen (AAE)") + wtag(I2, "shortkey", "54");
  STATION_PROPS.forEach(([d, t]) => {
    let v = "";
    if (W.isp.fillProps) {
      if (d === "BUS Systemadresse") v = "Zentrale " + W.centralAddr + (W.bacnetDevId ? " · BACnet Device " + W.bacnetDevId : "");
      if (d === "Softwareversion") v = W.applRev + (W.build ? " (Build " + W.build + ")" : "");
    }
    x += propBlock(I2, d, v, t);
  });
  x += I1 + "</installationClass>\n" + wtag(I1, "artBezeichnung", W.isp.artBez) + wtag(I1, "artLbnr", W.stationType) + wtag(I1, "standort", W.isp.bez);
  if (W.isp.produktDoc) x += wtag(I1, "produktDoc", W.isp.produktDoc);
  STATION_JOBS.forEach(([rm, team, d]) => { x += jobBlock(I1, rm, team, d); });
  return x + I + "</Artikel>\n";
}
export function dpArtikel(W, p, sortId, ind) {
  const I = ind, I1 = I + "    ", I2 = I1 + "    ";
  const k = KIND_INFO[p.kind] && p.kind !== "frei" ? { nummer: KIND_INFO[p.kind].nummer, bez: KIND_INFO[p.kind].name, lbnr: KIND_INFO[p.kind].lbnr } : { nummer: "#" + p.kind, bez: p.kind, lbnr: true };
  let x = I + '<Artikel active="true" sortId="' + sortId + '">\n' + wtag(I1, "nummer", k.nummer) + I1 + "<installationClass>\n";
  x += wtag(I2, "description", "N/V") + wtag(I2, "shortkey", "NV") + propBlock(I2, "Info", infoValue(W, p), "Text") + I1 + "</installationClass>\n";
  x += wtag(I1, "artBezeichnung", k.bez) + wtag(I1, "artKlartext", p.klartext);
  if (k.lbnr) x += wtag(I1, "artLbnr", k.nummer);
  x += wtag(I1, "standort", W.isp.bez) + jobBlock(I1, "false", "true", "Funktion prüfen");
  return x + I + "</Artikel>\n";
}
export function pinsOfGroup(W, gid) {
  let a = W.pins.filter(p => p.include && p.gid === gid);
  if (W.opt.sortKind) a = a.slice().sort((x, y) => KIND_INFO[x.kind].order - KIND_INFO[y.kind].order);
  return a;
}
export function ispXml(W, sortId, ind) {
  const I = ind, I1 = I + "    ", I2 = I1 + "    ";
  let x = I + '<Isp sortId="' + sortId + '">\n' + wtag(I1, "ispBezeichnung", W.isp.bez);
  let fac = 1;
  if (W.isp.station) x += I1 + '<facility sortId="' + (fac++) + '">\n' + wtag(I2, "facBezeichnung", W.isp.facName) + stationArtikel(W, 1, I2) + I1 + "</facility>\n";
  W.groups.forEach(g => {
    const pins = pinsOfGroup(W, g.gid);
    if (!pins.length) return;
    x += I1 + '<facility sortId="' + (fac++) + '">\n' + wtag(I2, "facBezeichnung", g.name);
    pins.forEach((p, i) => { x += dpArtikel(W, p, i + 1, I2); });
    x += I1 + "</facility>\n";
  });
  return x + I + "</Isp>\n";
}
export function regroupBy(W) {
  const C = W.C, o = W.opt;
  if (o.mode === "anlage") regroupPlants(W, C, o.splitAt || 0);
  else if (o.mode === "name") applyGroups(W, nameGroups(W.pins.filter(p => p.include), o.grpMax || 12));
  else if (o.mode === "modul") regroupModule(W, C);
  else regroupOne(W);
}

