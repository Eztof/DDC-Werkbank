import { fmtNum, norm, unitLabel } from "../core/util.js";

/* =========================================================================
   Gemeinsames Modell, Wörterbücher, Wert-Formatierung
   ========================================================================= */
export const TYPE_NAMES = {
  M: "Logikmodul", T: "Zeitglied", P: "Hardware-Klemme", L: "Lampe / Anzeige", S_01: "Schalter",
  S066: "Grenzwert / Schwelle", S083: "Rechenbaustein", S116: "Kalender", S118: "Zeitprogramm",
  S238: "Regler (Lüftung/Kälte)", S322: "Stellsignal-Ziel", S325: "Maximal-/Auswahl", S335: "Wertziel",
  S336: "Außentemperatur-Aufbereitung", S337: "Raumregler (PI)",
  H601: "Aggregat (Lüfter)", H613: "3-Punkt-Stellantrieb", H614: "Stetiges Stellgerät", H901: "Pumpe",
  SY_BMR400: "Systemobjekt BMR", SY_Clock: "Systemuhr", SY_User: "Benutzerverwaltung", SY_Network: "Netzwerk",
  SY_BacCfg: "BACnet-Konfiguration", SY_CAN: "CAN-Bus", SY_Serial: "Serielle Schnittstelle",
  SY_BACDev: "BACnet-Device", SY_Modul: "Modulverwaltung", SY_I18N: "Sprache/Region",
  SY_MsgMan: "Meldungsmanager", SY_MsgOut: "Meldungsausgabe", SY_TrMan: "Trendmanager", SY_Config: "Konfiguration",
  SY_Datsi: "Datensicherung", SY_SMTP: "E-Mail-Versand", SY_Email: "E-Mail", SY_Hosts: "Hosts",
  /* DDC3000 */
  RK: "Regelkreis", MSG: "Meldung", N: "Wochenprogramm", U: "Meldemenü", i: "Interner Zustand",
  m: "Merker", t: "Timer", S: "Schalter (SBM)", l: "Lampe (SBM)"
};

/* Parameterbedeutungen. inf:1 = aus der Dateistruktur abgeleitet, nicht aus K&P-Doku (Anzeige mit °). */
const PARAM_DICT = {
  M: { "1": { n: "e1 · Eingang 1", r: "in" }, "2": { n: "e2 · Eingang 2", r: "in" }, "3": { n: "e3 · Eingang 3", r: "in" },
       "4": { n: "e4 · Eingang 4", r: "in" }, "5": { n: "Verknüpfungsformel", r: "formula" }, "6": { n: "m · Ausgang", r: "out" } },
  T: { e: { n: "Eingang", r: "in" }, t: { n: "Ausgang", r: "out" }, Ton: { n: "Einschaltverzögerung", r: "time" },
       Toff: { n: "Ausschaltverzögerung", r: "time" }, Tstart: { n: "Startzeitpunkt", r: "info", inf: 1 } },
  L: { "1": { n: "Lampenzustand", r: "out", inf: 1 }, "2": { n: "Eingang Betrieb", r: "in", inf: 1 },
       "3": { n: "Eingang Störung", r: "in", inf: 1 }, "4": { n: "Darstellung", r: "param", inf: 1 } },
  S_01: { h: { n: "Schalterstellung", r: "hand" } },
  S066: { "2": { n: "Ausgang · Grenzwert erreicht", r: "out" }, "3": { n: "wirksamer Grenzwert", r: "info" },
          "4832": { n: "Führungsgröße", r: "in", inf: 1 }, "4839": { n: "Eingang · Istwert", r: "in" },
          "5748": { n: "Freigabe", r: "release", inf: 1 }, "8610": { n: "Grenzwert / Grundsollwert", r: "threshold" },
          "8611": { n: "Steilheit", r: "param" }, "8612": { n: "Hysterese / Schaltdifferenz", r: "threshold" },
          "8613": { n: "Gleitanfang", r: "param" }, "8614": { n: "Gleitende", r: "param" }, "8615": { n: "Wirkrichtung", r: "param", inf: 1 } },
  S238: { "5100": { n: "Sollwert", r: "setpoint" }, "5101": { n: "akt. (wirksamer) Sollwert", r: "info" },
          "5102": { n: "Regelgröße (Istwert)", r: "in" }, "5103": { n: "Außentemperatur", r: "in", inf: 1 },
          "5105": { n: "Regelabweichung", r: "out", inf: 1 },
          "5110": { n: "Y1 · Stellgröße 1", r: "out" }, "5111": { n: "Y2 · Stellgröße 2", r: "out" },
          "5112": { n: "Y3 · Stellgröße 3", r: "out" }, "5113": { n: "Y4 · Stellgröße 4", r: "out" },
          "5115": { n: "Zeitprogramm / Nutzzeit", r: "release", inf: 1 }, "5120": { n: "XP Y1", r: "param" },
          "5121": { n: "XP Y2", r: "param" }, "5122": { n: "XP Y3", r: "param" }, "5123": { n: "XP Y4", r: "param" },
          "5126": { n: "Sequenz", r: "param", inf: 1 }, "5138": { n: "Betriebsart / Fern-Ein", r: "release", inf: 1 },
          "5140": { n: "Freigabe Regelung", r: "release" }, "5200": { n: "Kaskadenfühler (Abluft/Raum)", r: "in" },
          "5203": { n: "Zuluft Min-Begrenzung", r: "param" }, "5204": { n: "Zuluft Max-Begrenzung", r: "param" },
          "5205": { n: "Zuluft-Sollwert Kaskade", r: "info" }, "5230": { n: "Ablufttemperatur", r: "in" },
          "5231": { n: "Außentemp. Kompensation", r: "in", inf: 1 }, "5250": { n: "Außentemp. Kompensation", r: "in", inf: 1 },
          "5260": { n: "Zusatzeingang", r: "in", inf: 1 }, "5333": { n: "Anfahrschaltung · Führung", r: "in", inf: 1 },
          "5335": { n: "Anfahrschaltung · Öffnungszeit", r: "param" }, "5352": { n: "Erhitzer-RL-Begrenzung · Führung", r: "in", inf: 1 },
          "5353": { n: "Erh.-Vent.-Begr. Beginn", r: "param" }, "5354": { n: "Erh.-Vent.-Begr. Ende", r: "param" },
          "5356": { n: "Sperrung stet. Frostschutz", r: "block", inf: 1 }, "5327.1": { n: "Y-Fix (Zwangsstellung)", r: "block", inf: 1 },
          "5288.1": { n: "Umschaltung Sollwert 2", r: "release", inf: 1 }, "5286.1": { n: "Sollwert 2", r: "setpoint", inf: 1 },
          i011: { n: "Status · Anlage Ein", r: "out" }, i012: { n: "Status · Regelung Ein", r: "out" }, i022: { n: "Status · Anfahren aktiv", r: "out" } },
  S337: { "5100": { n: "Sollwert", r: "setpoint" }, "5101": { n: "akt. Sollwert", r: "info" }, "5102": { n: "Istwert", r: "in" },
          "5105": { n: "Regelabweichung", r: "out", inf: 1 }, "5110": { n: "Stellgröße", r: "out" }, "5120": { n: "XP", r: "param" },
          "5178": { n: "Freigabe", r: "release", inf: 1 } },
  S083: { "2146": { n: "Eingang a", r: "in" }, "2147": { n: "Eingang b", r: "in" }, "2148": { n: "Eingang c", r: "in" }, "2151": { n: "Rechenformel", r: "formula" } },
  S118: { actValue: { n: "aktueller Schaltwert", r: "out" }, nxtValue: { n: "nächster Schaltwert", r: "info" }, Info: { n: "Ausgang Zeitprogramm", r: "out", inf: 1 } },
  S322: { "5520": { n: "Eingang Stellsignal", r: "in" }, "5522": { n: "Begrenzung", r: "param" }, "5537": { n: "Ausgang Stellsignal", r: "out" } },
  S325: { "1": { n: "Eingang 1", r: "in" }, "2": { n: "Eingang 2", r: "in" }, "32": { n: "Ausgang · Auswahl", r: "out", inf: 1 } },
  S335: { "1": { n: "Eingang", r: "in" }, "4": { n: "Ausgang", r: "out" } },
  S336: { "5570": { n: "Eingang Außenfühler", r: "in" }, "5572": { n: "Ersatzwert", r: "param" }, "5573": { n: "Außentemperatur (Ausgang)", r: "out" }, "5574": { n: "Fühlerausfall", r: "out", inf: 1 } },
  H601: { "1": { n: "Ein-Befehl (Anforderung)", r: "in" }, "5": { n: "Betriebsmeldung", r: "in" }, "6": { n: "Betriebsstunden", r: "info" },
          "10": { n: "Handschalter (9=Auto)", r: "hand" }, "11": { n: "Schaltbefehl (Ausgang)", r: "out" }, "12": { n: "Sperre", r: "block", inf: 1 },
          "14": { n: "Quittierung", r: "in", inf: 1 }, "15": { n: "Störmeldung (Eingang)", r: "in", inf: 1 }, "17": { n: "Überwachungszeit", r: "param", inf: 1 },
          "22": { n: "Störung (Ausgang)", r: "out", inf: 1 } },
  H901: { "1": { n: "Ein-Befehl (Anforderung)", r: "in" }, "2": { n: "Betriebsmeldung", r: "in", inf: 1 }, "5": { n: "Handschalter (9=Auto)", r: "hand" },
          "8": { n: "Quittierung", r: "in", inf: 1 }, "11": { n: "Störmeldung (Eingang)", r: "in", inf: 1 }, "19": { n: "Schaltbefehl (Ausgang)", r: "out" },
          "27": { n: "Betriebsstunden", r: "info" } },
  H613: { "3": { n: "Eingang Stellsignal", r: "in" }, "7": { n: "Ausgang Impuls A", r: "out", inf: 1 }, "8": { n: "Ausgang Impuls B", r: "out", inf: 1 }, "10": { n: "Handwert", r: "hand" } },
  H614: { "3": { n: "Eingang Stellsignal", r: "in" }, "6": { n: "Stellungs-Ausgang", r: "out" }, "10": { n: "Handwert", r: "hand" },
          "19": { n: "Zwangsstellung", r: "block", inf: 1 }, "24": { n: "Hand aktiv", r: "out", inf: 1 } },
  RK: { G: { n: "Grenzwert-Ausgang", r: "out" } }
};

export const FUNC_NAMES = {
  F019: "Fühlerkorrektur", F014: "Invertierung°", F012: "Kennlinie/Skalierung°", F002: "Betriebsstundenzähler°",
  F017: "Modulüberwachung°", FSelMO: "Meldung (an Meldeausgabe)", FMSG: "Meldung", FReset: "Rücksetzen",
  FB_TR: "BACnet Trend-Log", FB_IR: "BACnet Intrinsic Reporting°"
};

/* BACnet-Objekttypen der K&P-Funktionsblöcke */
export const FB_TYPES = {
  FB_AI: [0, "Analog Input"], FB_AO: [1, "Analog Output"], FB_AV: [2, "Analog Value"], FB_BI: [3, "Binary Input"],
  FB_BO: [4, "Binary Output"], FB_BV: [5, "Binary Value"], FB_MI: [13, "Multi-state Input"], FB_MO: [14, "Multi-state Output"],
  FB_MV: [19, "Multi-state Value"], FB_TR: [20, "Trend Log"], SCHED: [17, "Schedule"], CAL: [6, "Calendar"], DEV: [8, "Device"]
};

export const KIND_INFO = {
  AE: { name: "Analogeingang", nummer: "#AE", lbnr: true, order: 1 },
  AA: { name: "Analogausgang", nummer: "#AA", lbnr: false, order: 2 },
  BE: { name: "Binäreingang", nummer: "#BE", lbnr: true, order: 3 },
  BA: { name: "Binärausgang", nummer: "#BA", lbnr: true, order: 4 },
  frei: { name: "frei", nummer: "", lbnr: false, order: 5 }
};
export const isOutputKind = k => k === "AA" || k === "BA";

export function dictFor(type, addr) { return (PARAM_DICT[type] || {})[addr] || null; }
export function roleFromText(t) {
  t = norm(t);
  if (!t) return "";
  if (/freigabe|fern ein|nutzzeit/.test(t)) return "release";
  if (/sperr|zwangs|y-fix|verriegel/.test(t)) return "block";
  if (/\bhand\b|handschalter|handwert/.test(t)) return "hand";
  if (/sollwert|\bxs\b|soll\b/.test(t)) return "setpoint";
  if (/grenzwert|hysterese|schwelle/.test(t)) return "threshold";
  if (/quelle|eingang|fühler|istwert|regelgr/.test(t)) return "in";
  return "";
}
export function roleOf(type, addr, label) {
  const d = dictFor(type, addr);
  if (d) return d.r;
  return roleFromText(label);
}

/* ---------- Werte ---------- */
export const pv = p => (p && p.values && p.values[0]) || null;             // gespeicherter Wert
export const pe = p => (p && (p.act || (p.values && p.values[0]))) || null; // wirksamer Wert (ActValue bevorzugt)
export function valText(v, stateTexts) {
  if (!v) return "";
  if (v.type === "Source") return "";
  if (v.type === "Bool") return v.text === "true" ? "EIN" : "AUS";
  if ((v.type === "MultiState" || v.type === "SelectList") && stateTexts && stateTexts[v.text] != null)
    return stateTexts[v.text].trim() + " (" + v.text + ")";
  if (v.type === "Float") { const u = unitLabel(v.unit); return fmtNum(v.text) + (u ? " " + u : ""); }
  if (v.type === "Integer") { const u = unitLabel(v.unit); return v.text + (u ? " " + u : ""); }
  return v.text ?? "";
}
export const vNum = v => (v && v.text != null && v.text !== "") ? parseFloat(v.text) : NaN;
export const vBool = v => v ? v.text === "true" || v.text === "1" : null;

/* ---------- Umformungen in Quellpfaden (+s0,1 +s1,0 …) ---------- */
function decodeTransform(tr) {
  if (!tr) return [];
  return [...String(tr).matchAll(/([+-])s(-?\d+),(-?\d+)/g)].map(m => ({ neg: m[1] === "-", from: m[2], to: m[3] }));
}
function isInvertTransform(tr) {
  const r = decodeTransform(tr);
  return r.length === 2 && r.some(x => !x.neg && x.from === "0" && x.to === "1") && r.some(x => !x.neg && x.from === "1" && x.to === "0");
}
export function describeTransform(tr, stateTexts) {
  const r = decodeTransform(tr);
  if (!r.length) return tr ? String(tr) : "";
  if (isInvertTransform(tr)) return "invertiert";
  const st = x => stateTexts && stateTexts[x] != null ? "„" + stateTexts[x].trim() + "“" : x;
  const pos = r.filter(x => !x.neg && x.to === "1"), neg = r.filter(x => x.neg && x.to === "0");
  if (pos.length === 1 && neg.length === 1 && pos[0].from === neg[0].from && r.length === 2) return "wahr wenn = " + st(pos[0].from);
  if (pos.length && r.every(x => !x.neg && x.to === "1")) return "wahr wenn = " + pos.map(x => st(x.from)).join(" / ");
  return r.map(x => (x.neg ? "≠" : "=") + st(x.from) + "→" + x.to).join(", ");
}

/* ---------- Zentrale (gemeinsamer Container) ---------- */
let CID = 1;
export function newCentral(format, label, fileName) {
  return {
    cid: "c" + (CID++), format, label, fileName,
    meta: { name: "", stationType: "", centralAddr: "", bacnetDevId: "", applRev: "", build: "", defdata: "", stamp: "", stampSrc: "", d4pmlVersion: "" },
    system: [],            // [{group, k, v, warn}]
    modules: [],           // {addr,type,name,active,hw,fw,pinCount,kinds}
    nodes: new Map(), edges: [], groups: new Map(),
    pins: [], schedules: [], calendars: [], messages: [], alarms: [], bacnet: [], users: [],
    trends: [], hours: [], flat: new Map(), findings: [], notes: [],
    inMap: new Map(), outMap: new Map()
  };
}
export function indexEdges(C) {
  C.inMap = new Map(); C.outMap = new Map();
  C.edges.forEach((e, i) => {
    e.i = i;
    if (!C.inMap.has(e.to)) C.inMap.set(e.to, []); C.inMap.get(e.to).push(e);
    if (!C.outMap.has(e.from)) C.outMap.set(e.from, []); C.outMap.get(e.from).push(e);
  });
}
export const edgesIn = (C, id) => C.inMap.get(id) || [];
export const edgesOut = (C, id) => C.outMap.get(id) || [];
function groupOf(C, n) { return C.groups.get(n.gKey) || {}; }
export function nodeTitle(C, n) {
  if (!n) return "";
  const g = groupOf(C, n);
  const where = [g.plantName, g.groupName].filter(Boolean).join(" › ");
  return (n.name ? n.name + " · " : "") + n.addr + (where ? " (" + where + ")" : "");
}
export function nodePlace(C, n) {
  const g = groupOf(C, n);
  if (g.isPinGroup) return "Klemmen Modul " + n.mod;
  return [g.plantName, g.groupName].filter(Boolean).join(" › ") || ("Gruppe " + n.gKey);
}
export function stateTextsOf(node, paraAddr) {
  if (!node) return null;
  const p = (node.paras || []).find(x => x.addr === paraAddr);
  if (p && p.stateTexts && Object.keys(p.stateTexts).length) return p.stateTexts;
  if (node.type === "S_01") return { "9": "Auto", "0": "Aus", "1": "Ein" };
  return null;
}
export function edgeLabel(C, e) {
  const a = C.nodes.get(e.from);
  const st = stateTextsOf(a, e.fromRest);
  return (a ? a.addr : "?") + (e.fromRest ? "/" + e.fromRest : "") + (e.inv ? " [INV]" : e.transform ? " [" + describeTransform(e.transform, st) + "]" : "");
}
export function isInvertedEdge(e) { return !!e.inv || isInvertTransform(e.transform); }
export function portLabel(type, para) {
  if (type === "M") { if (/^[1-4]$/.test(para)) return "e" + para; if (para === "5") return "Formel"; if (para === "6") return "m (Ausgang)"; }
  if (type === "T") { if (para === "e") return "e (Eingang)"; if (para === "t") return "t (Ausgang)"; }
  const d = dictFor(type, para);
  return d ? d.n : para;
}

