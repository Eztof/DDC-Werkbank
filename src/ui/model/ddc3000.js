import { natCmp } from "../core/util.js";
import { FORMATS } from "../core/ext.js";
import { edgeLabel, edgesIn, edgesOut, indexEdges, newCentral, nodePlace, pv } from "./model.js";
import { schedText } from "./d4pml.js";

/* =========================================================================
   DDC3000-Parser (.wwf – RTF-verpackte Parameterliste)
   ========================================================================= */
const CP1252 = (() => { try { return new TextDecoder("windows-1252"); } catch (e) { return null; } })();
function rtfToText(rtf) {
  let out = "", i = 0, skip = false;
  const stack = [];
  const L = rtf.length;
  while (i < L) {
    const c = rtf[i];
    if (c === "{") {
      stack.push(skip); i++;
      if (/^\\(\*|fonttbl|colortbl|stylesheet|info|pict|header|footer)/.test(rtf.slice(i, i + 12))) skip = true;
      continue;
    }
    if (c === "}") { skip = stack.length ? stack.pop() : false; i++; continue; }
    if (c === "\\") {
      const n = rtf[i + 1];
      if (n === "\\" || n === "{" || n === "}") { if (!skip) out += n; i += 2; continue; }
      if (n === "'") {
        const b = parseInt(rtf.substr(i + 2, 2), 16);
        if (!skip) out += CP1252 ? CP1252.decode(new Uint8Array([b])) : String.fromCharCode(b);
        i += 4; continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (m) {
        if (!skip) { if (m[1] === "par" || m[1] === "line") out += "\n"; else if (m[1] === "tab") out += "\t"; }
        i += m[0].length; continue;
      }
      i += 2; continue;
    }
    if (c === "\r" || c === "\n") { i++; continue; }
    if (!skip) out += c;
    i++;
  }
  return out;
}

function d3Fields(rec, s) {
  let m;
  if ((m = s.match(/^GT=(.*)$/))) { rec.f.GT = m[1].trim(); return; }
  if ((m = s.match(/^(BEG|END)(\d)=(.*)$/))) { rec.sched[m[1] + m[2]] = m[3].split("=").map(x => x.trim()); return; }
  if (s.startsWith("!")) return;
  let kText = null;
  const km = s.match(/(?:^|;)\s*K=(.*)$/);
  if (km) { kText = km[1].trim(); s = s.slice(0, km.index); }
  for (const seg of s.split(";")) {
    const mm = seg.match(/^\s*([A-Za-z]+\d*)=(.*)$/);
    if (mm) rec.f[mm[1]] = mm[2].trim();
  }
  if (kText != null) rec.f.K = kText;
}

/* "1.701 S8/1Iand" → Zentrale 1, Kreis 701, Parameter S8, Instanz 1, invertiert, UND */
function d3Ref(v) {
  const m = String(v || "").trim().match(/^(\d+)\.(\d+)\s+([A-Za-z]*\d*)\/(\d+)([NI])?(and|or)?\s*$/i);
  if (!m) return null;
  return { z: +m[1], kreis: +m[2], base: m[3], inst: +m[4], inv: (m[5] || "").toUpperCase() === "I", op: (m[6] || "").toLowerCase(), raw: v.trim() };
}

export function parseDDC3000(text, label, fileName) {
  const txt = /^\s*\{\\rtf/.test(text) ? rtfToText(text) : text;
  const recs = []; let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      const m = line.match(/^(\S+)\s+(.*)$/);
      if (!m) { cur = null; continue; }
      cur = { kind: m[1], f: {}, sched: {} };
      recs.push(cur);
      d3Fields(cur, m[2]);
    } else if (cur) d3Fields(cur, line.trim());
  }
  if (!recs.length) throw new Error("Keine DDC3000-Parameter erkannt");

  const C = newCentral("DDC3000", label, fileName);
  const M = C.meta;
  const kreise = new Map([[0, { nr: 0, typ: "Grundgerät", name: "", modules: [] }]]);
  const params = [], scheds = [];
  let kreis = 0;
  for (const r of recs) {
    const f = r.f;
    switch (r.kind) {
      case "Z": M.centralAddr = (f.NR || "").trim(); M.series = f.TYP || "DDC3000"; break;
      case "B": M.stationType = f.TYP || f.GT || ""; break;
      case "K": kreis = parseInt(f.NR, 10) || 0; kreise.set(kreis, { nr: kreis, typ: f.TYP || "", name: f.GT || "", rk: f.RK || "", anl: f.ANL || "", modules: [] }); break;
      case "M": (kreise.get(kreis) || kreise.get(0)).modules.push({ nr: f.NR, aktiv: f.AKTIV }); break;
      case "N": scheds.push({ kreis, nr: parseInt(f.NR, 10) || 1, sched: r.sched }); break;
      default:
        if (f.P != null) {
          const [base, inst] = f.P.split("/");
          const K = (f.K || "").replace(/^!/, "").trim();
          params.push({ kreis, kind: r.kind, P: f.P, base: base.trim(), inst: parseInt(inst, 10) || 1, f, K, GT: f.GT || "", name: f.GT || K, dflt: /%\(/.test(K) && !f.GT });
        }
    }
  }
  M.name = label;
  M.format = "DDC3000 · Parameterliste (.wwf)";
  M.applRev = ""; M.stamp = ""; M.stampSrc = "";
  const typOf = n => (kreise.get(n) || {}).typ || "";
  const isSBM = n => /^SBM/i.test(typOf(n)), isFBM = n => /^FBM/i.test(typOf(n));
  const isRK = n => n > 0 && !isSBM(n) && !isFBM(n);
  const kName = n => n === 0 ? "Grundgerät" : `Kreis ${n}` + (kreise.get(n) && kreise.get(n).name ? " · " + kreise.get(n).name : "") + (typOf(n) ? " (" + typOf(n) + ")" : "");

  /* Gruppen */
  const addGroup = (key, plantName, groupName, isPin, mod) => {
    if (!C.groups.has(key)) C.groups.set(key, { key, mod: String(mod), plant: String(mod), plantName, group: key, groupName, isPinGroup: isPin, nodes: [] });
    return C.groups.get(key);
  };
  for (const [n] of kreise) {
    if (n === 0) { addGroup("0/pins", "Grundgerät", "Klemmen", true, 0); addGroup("0/logik", "Grundgerät", "Logik · Merker · Timer · Zeitprogramme", false, 0); }
    else addGroup(String(n), kName(n), "", isFBM(n), n);
    const k = kreise.get(n);
    C.modules.push({ addr: String(n), type: n === 0 ? (M.stationType || "DDC3000") : (k.typ || "Kreis"), name: n === 0 ? "Grundgerät" : k.name, active: true, hw: "", fw: "", pinCount: 0, kinds: {}, swModules: k.modules });
  }

  /* Knoten */
  const target = (kr, base, inst) => {
    if (isRK(kr)) return { id: kr + ":RK", type: "RK", addr: "Kreis " + kr, gKey: String(kr), port: base + (inst > 1 ? "/" + inst : "") };
    let m;
    if (base === "N") return { id: kr + ":N" + inst, type: "N", addr: "N/" + inst, gKey: "0/logik" };
    if (base === "U") return { id: kr + ":U" + inst, type: "U", addr: "U/" + inst, gKey: "0/logik" };
    if (/^(4838|8616|8618)$/.test(base)) return { id: kr + ":MSG" + inst, type: "MSG", addr: "Meldung " + inst, gKey: "0/logik", port: base };
    if ((m = base.match(/^([A-Za-z]+)(\d+)$/))) {
      const l = m[1].toLowerCase(), num = m[2];
      const pin = l === "b" || l === "y" || l === "k";
      const gKey = kr === 0 ? (pin ? "0/pins" : "0/logik") : String(kr);
      const type = pin ? "P" : ({ m: "M", t: "T", l: "L", s: "S", q: "Q", i: "i" }[l] || l);
      return { id: kr + ":" + l + num, type, addr: l + num, gKey, letter: l, num, pin };
    }
    if (/^\d+$/.test(base)) return { id: kr + ":SYS", type: "SYS", addr: "System", gKey: kr === 0 ? "0/logik" : String(kr), port: base + (inst > 1 ? "/" + inst : "") };
    return { id: kr + ":" + base, type: base, addr: base, gKey: kr === 0 ? "0/logik" : String(kr) };
  };
  const getNode = (t, kr, define) => {
    let n = C.nodes.get(t.id);
    if (!n) {
      const g = C.groups.get(t.gKey) || addGroup(t.gKey, kName(kr), "", false, kr);
      n = { id: t.id, mod: String(kr), plant: String(kr), group: t.gKey, gKey: t.gKey, addr: t.addr, type: t.type, name: "", pcode: "",
        paras: [], subObjs: [], formula: "", images: [], schedules: [], calendar: [], pinFuncs: new Set(), isPin: !!t.pin,
        ghost: true, alarms: [], bacnet: [], lopr: [], fmt: "d3", kreis: kr, letter: t.letter, num: t.num, d3: {} };
      if (t.type === "RK") { n.name = (kreise.get(kr) || {}).name || typOf(kr); n.ghost = false; }
      C.nodes.set(t.id, n); g.nodes.push(t.id);
    }
    if (define) n.ghost = false;
    return n;
  };
  const addPara = (n, addr, label, valueText, extra) => {
    let p = n.paras.find(x => x.addr === addr);
    if (!p) { p = { addr, texts: [], values: [], act: null, funcObjs: [], schedules: [], stateTexts: {}, pcode: null }; n.paras.push(p); }
    if (label && !p.texts.includes(label)) p.texts.push(label);
    if (valueText != null && valueText !== "") p.values = [{ type: "Text", text: valueText }];
    if (extra) Object.assign(p, extra);
    return p;
  };
  const pending = [];
  const vDefs = new Set();
  for (const p of params) if (p.kind === "V" && /^[A-Za-z]+\d+$/.test(p.base)) vDefs.add(p.kreis + ":" + p.base.toLowerCase());

  for (const p of params) {
    const t = target(p.kreis, p.base, p.inst);
    const f = p.f;
    const isSysK0 = p.kreis === 0 && t.type === "SYS";
    const unitTxt = f.E && !/keine/i.test(f.E) ? " " + f.E : "";
    if (isSysK0) {
      const val = f.W != null ? f.W : "";
      if (p.kind === "TX" && /^13\d\d$/.test(p.base) && p.GT) C.system.push({ group: "Neustarts (Protokoll)", k: "P" + p.base, v: p.GT });
      else if (p.kind === "TX" && val && val !== "---" && /^(1419|21[3-9]\d)$/.test(p.base)) C.system.push({ group: "Rufnummern / Ziele", k: "P" + p.P, v: val });
      else if ((p.kind === "AX" || p.kind === "DS" || p.kind === "TX") && val !== "" && val !== "---") C.system.push({ group: "Parameter Grundgerät", k: "P" + p.P + " " + (p.name || ""), v: val + unitTxt });
      flatPut(C, p, t);
      continue;
    }
    /* Optionale Knoten nur, wenn sie wirklich etwas tun */
    if (["i", "Q", "U"].includes(t.type) && (p.kind === "DM" || p.kind === "DS")) { flatPut(C, p, t); continue; }
    if ((t.type === "L" || t.type === "S") && p.kind === "DM") { flatPut(C, p, t); continue; }
    if (t.type === "P" && p.kind === "AI" && p.base === "899") { flatPut(C, p, t); continue; }
    const n = getNode(t, p.kreis, p.kind !== "V" || !t.pin);
    const portAddr = t.port || (p.kind === "V" ? null : (p.kind === "T" ? "TZ" : "Wert"));
    const lbl = p.name;
    if (t.type !== "RK" && (p.kind === "DM" || p.kind === "AI") && lbl && !p.dflt) n.name = lbl;
    if (t.type !== "RK" && p.kind === "DS" && lbl && !p.dflt && !n.name) n.name = lbl;
    if (t.pin && (p.kind === "AI" || p.kind === "DM")) { n.d3.def = p; n.d3.dflt = p.dflt; }
    if (t.type === "P" && p.base[0] === "B" && p.kind === "AX") n.d3.corr = { val: f.W, unit: f.E };
    if (t.type === "RK" || t.type === "MSG" || t.type === "SYS") {
      const val = f.W != null ? f.W + unitTxt : "";
      const pp = addPara(n, t.port, lbl, p.kind === "V" ? null : val);
      if (p.kind === "AX" && (f.UG || f.OG)) pp.range = (f.UG || "") + " … " + (f.OG || "");
    }
    if (p.kind === "V") {
      const refs = ["V1", "V2", "V3", "V4"].map((k, i) => ({ k, i, ref: d3Ref(f[k]) })).filter(x => x.ref);
      if (t.type === "M" || (t.pin && t.letter === "k") || t.type === "i") {
        refs.forEach(x => pending.push({ to: n.id, toPara: String(x.i + 1), ref: x.ref, kreisCtx: p.kreis }));
        n.formula = d3Formula(refs);
        if (lbl && !p.dflt && !n.name) n.name = lbl;
      } else if (t.pin && t.letter === "y") {
        refs.forEach(x => pending.push({ to: n.id, toPara: "Quelle", ref: x.ref, kreisCtx: p.kreis }));
      } else {
        const port = t.port || "Quelle";
        refs.forEach(x => pending.push({ to: n.id, toPara: refs.length > 1 ? port + "·V" + (x.i + 1) : port, ref: x.ref, kreisCtx: p.kreis }));
        if (t.type !== "RK" && t.type !== "MSG") addPara(n, port, lbl);
      }
    } else if (p.kind === "T") {
      const ref = d3Ref(f.TV); if (ref) pending.push({ to: n.id, toPara: "e", ref, kreisCtx: p.kreis });
      if (f.TZ) addPara(n, "TZ", "Zeit (" + (/^E/i.test(f.TZ) ? "Einschaltverzögerung" : /^A/i.test(f.TZ) ? "Ausschaltverzögerung" : "Zeitglied") + ")", f.TZ.replace(/^[EA]\s*/i, ""));
      if (lbl && !p.dflt) n.name = n.name || lbl;
    } else if (p.kind === "L") {
      const a = d3Ref(f.LD), b = d3Ref(f.LB);
      if (a) pending.push({ to: n.id, toPara: "LD", ref: a, kreisCtx: p.kreis });
      if (b) pending.push({ to: n.id, toPara: "LB", ref: b, kreisCtx: p.kreis });
      if (f.F) addPara(n, "F", "Farbe/Art°", f.F);
      if (lbl && !p.dflt) n.name = n.name || lbl;
    } else if (p.kind === "DS" && t.type !== "RK") {
      addPara(n, "W", lbl || "Stellung", f.W);
    }
    flatPut(C, p, t);
  }

  /* Wochenprogramme */
  const DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];
  for (const sc of scheds) {
    const t = target(sc.kreis, "N", sc.nr);
    const n = getNode(t, sc.kreis, true);
    const days = DAYS.map((d, di) => {
      const entries = [];
      for (let i = 1; i <= 4; i++) {
        const b = (sc.sched["BEG" + i] || [])[di + 1], e = (sc.sched["END" + i] || [])[di + 1];
        if (b && b !== "--:--") { entries.push({ time: b, value: "1" }); if (e && e !== "--:--") entries.push({ time: e, value: "0" }); }
      }
      entries.sort((x, y) => x.time.localeCompare(y.time));
      return { weekday: d, entries };
    });
    n.schedules.push(days);
    const dm = params.find(p => p.kreis === sc.kreis && p.base === "N" && p.inst === sc.nr);
    n.name = (dm && dm.GT) || (dm && dm.K) || ("Wochenprogramm " + sc.nr);
    C.flat.set("K" + sc.kreis + "|N" + sc.nr + "|sched", { nid: n.id, label: n.name, val: schedText(days) });
  }
  /* RK: Auswahl Wochenprogramm (5115) als Verbindung */
  for (const p of params) if (p.base === "5115" && isRK(p.kreis) && p.f.W) {
    const nid = "0:N" + parseInt(p.f.W, 10);
    if (C.nodes.has(nid)) C.edges.push({ from: nid, to: p.kreis + ":RK", toPara: "5115", fromRest: "", transform: "", raw: "Auswahl Wochenprogramm = " + p.f.W, inv: false, sel: true });
  }

  /* Verknüpfungen auflösen */
  for (const pe_ of pending) {
    const r = pe_.ref;
    if (r.z === 0 && r.kreis === 0) r.kreis = pe_.kreisCtx;   // 0.0 = eigener Kreis
    const foreign = r.z !== 0 && M.centralAddr && r.z !== parseInt(M.centralAddr, 10);
    const t = target(r.kreis, r.base, r.inst);
    if (foreign) { t.id = "Z" + r.z + ":" + t.id; t.gKey = "Z" + r.z; }
    let src = C.nodes.get(t.id);
    if (!src) src = getNode(t, r.kreis, false);
    C.edges.push({ from: src.id, to: pe_.to, toPara: pe_.toPara, fromRest: t.port || "", transform: r.inv ? "invertiert" : "", inv: r.inv, op: r.op, raw: r.raw });
  }
  /* Nur referenzierte Knoten: Namen aus übersprungenen Datensätzen nachtragen */
  for (const n of C.nodes.values()) {
    if (!n.ghost || n.foreign) continue;
    const p = params.find(x => x.kreis === n.kreis && x.base.toLowerCase() === (n.addr || "").toLowerCase() && (x.kind === "DM" || x.kind === "DS"));
    if (p) { n.ghost = false; if (p.name && !p.dflt) n.name = p.name; }
  }
  /* SYS-Knoten ohne Verbindungen entfernen */
  for (const [id, n] of [...C.nodes]) {
    if (n.type === "SYS" && !C.edges.some(e => e.from === id || e.to === id)) { C.nodes.delete(id); const g = C.groups.get(n.gKey); if (g) g.nodes = g.nodes.filter(x => x !== id); }
  }
  for (const [k, g] of [...C.groups]) if (!g.nodes.length) C.groups.delete(k);
  indexEdges(C);

  /* Klemmen */
  const sensorSel = {};
  for (const p of params) { const m = (p.K || "").match(/F.hlerauswahl B%\((\d+)\)/i); if (m && p.f.W) sensorSel[p.kreis + ":b" + m[1]] = p.f.W; }
  for (const n of C.nodes.values()) {
    if (!n.isPin || n.foreign || !n.d3.def) continue;
    const l = n.letter;
    const ins = edgesIn(C, n.id), outs = edgesOut(C, n.id);
    let kind = l === "b" ? "AE" : l === "y" ? "AA" : (vDefs.has(n.kreis + ":k" + n.num) ? "BA" : "BE");
    const named = !!n.name && !n.d3.dflt;
    const free = !named && !ins.length && !outs.length;
    if (free) kind = "frei";
    const corr = n.d3.corr ? { val: n.d3.corr.val, unit: null, unitTxt: n.d3.corr.unit, num: parseFloat(n.d3.corr.val) } : null;
    const pin = {
      uid: n.id, nodeId: n.id, cid: C.cid, module: String(n.kreis), moduleType: typOf(n.kreis) || M.stationType, addr: n.addr,
      klemme: n.kreis === 0 ? n.addr : n.kreis + "/" + n.addr, name: named ? n.name : (n.name || ""), paraText: "", kind, declaredKind: null,
      subType: { AE: "Fühler", AA: "Analogausgang", BE: "Kontakt (Eingang)", BA: "Kontakt (Ausgang)", frei: "" }[kind],
      value: { stored: null, eff: null, invalid: false, deleted: false }, corr, invert: false, trend: false, funcs: [], alarms: [],
      sources: ins, consumers: outs, bacnet: [], reserve: false, dfltName: !!n.d3.dflt,
      sensorType: sensorSel[n.id] || null, kennlinie: null
    };
    if (!named && !free) pin.name = "";
    C.pins.push(pin); n.pin = pin;
    if (n.ghost && (ins.length || outs.length)) n.ghost = false;
    const mod = C.modules.find(m => m.addr === String(n.kreis));
    if (mod) { mod.pinCount++; mod.kinds[kind] = (mod.kinds[kind] || 0) + 1; }
  }
  C.pins.sort((a, b) => natCmp(a.module, b.module) || ("byk".indexOf(a.addr[0]) - "byk".indexOf(b.addr[0])) || natCmp(a.addr, b.addr));

  /* Zeitprogramme & Meldungen für die Ansicht */
  for (const n of C.nodes.values()) {
    if (n.type === "N" && n.schedules.length) C.schedules.push({ id: n.id, nodeId: n.id, name: n.name, place: "Grundgerät", days: n.schedules[0], def: "0", consumers: edgesOut(C, n.id), kind: "N", stateNames: { "1": "Ein", "0": "Aus" } });
    if (n.type === "MSG") {
      const src = edgesIn(C, n.id)[0];
      const ziel = pv(n.paras.find(p => p.addr === "8616")), mt = pv(n.paras.find(p => p.addr === "8618"));
      const sn = src ? C.nodes.get(src.from) : null;
      n.name = sn ? (sn.name || sn.addr) : n.addr;
      C.alarms.push({ nodeId: n.id, para: "4838", name: n.addr + (sn ? " · " + (sn.name || sn.addr) : ""), place: sn ? nodePlace(C, sn) : "", state: null,
        prio: "", ziel: ziel ? ziel.text : "", mtext: mt ? mt.text : "", src: src ? edgeLabel(C, src) : "" });
    }
  }
  C.system.unshift({ group: "Station", k: "Baureihe", v: M.series || "DDC3000" }, { group: "Station", k: "Typ", v: M.stationType || "–" }, { group: "Station", k: "Zentrale", v: M.centralAddr || "–" },
    { group: "Station", k: "Kreise", v: String(kreise.size - 1) });
  C.d3kreise = kreise;
  return C;
}

function d3Formula(refs) {
  let expr = "";
  refs.forEach((x, idx) => {
    const term = (x.ref.inv ? "NOT " : "") + "e" + (x.i + 1);
    if (idx === 0) expr = term;
    else expr = "(" + expr + ") " + (x.ref.op === "or" ? "OR" : "AND") + " " + term;
  });
  return expr;
}
function flatPut(C, p, t) {
  const f = p.f, base = "K" + p.kreis + "|" + p.P;
  const nid = C.nodes.has(t.id) ? t.id : null;
  const lbl = (p.name || "") + " (P " + p.P + (p.kreis ? ", Kreis " + p.kreis : "") + ")";
  for (const k of ["W", "V1", "V2", "V3", "V4", "TV", "TZ", "LD", "LB", "F", "E", "UG", "OG", "INV"]) {
    if (f[k] == null || f[k] === "" || f[k] === "---") continue;
    if (p.kind === "TX" && /^13\d\d$/.test(p.base)) continue;
    C.flat.set(base + "|" + k, { nid, label: lbl + " · " + k, val: f[k] });
  }
  if (p.GT) C.flat.set(base + "|GT", { nid, label: lbl + " · Text", val: p.GT });
}


/* ---------- Als Dateiformat anmelden ---------- */
FORMATS.add({
  id: "ddc3000", order: 10, icon: "list", label: "DDC3000",
  desc: "*.wwf – Parameterliste der DDC3000-Zentrale (DDC3200 …) inkl. Kreisen, Logik und Wochenprogrammen.",
  exts: ["wwf", "rtf", "txt"],
  sniff: (name, head, text) => (/^\s*\{\\rtf/.test(head) && /(TYP=DDC3|NR=\d+\s*;\s*TYP=|\bAI\s+P=)/.test(text.slice(0, 20000))) || /^\s*Z\s+NR=\s*\d+\s*;\s*TYP=/m.test(head),
  parse: (text, f) => parseDDC3000(text, f.label, f.name)
});
