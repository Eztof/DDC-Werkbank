import { fmtNum, fmtUnix, kid, kids, natCmp, textOf } from "../core/util.js";
import { FB_TYPES, FUNC_NAMES, edgesIn, edgesOut, indexEdges, isOutputKind, newCentral, nodePlace, pe, portLabel, pv, valText } from "./model.js";

/* =========================================================================
   D4PML-Parser (DDC4000 datasave.xml, BMR/DDC420 param_backup.d4pml)
   ========================================================================= */
function readVal(c) {
  return {
    type: c.getAttribute("Type"), text: (c.textContent || "").trim(), unit: c.getAttribute("Unit"),
    deleted: c.getAttribute("Deleted") === "true", invalid: c.getAttribute("Invalid") === "true",
    counter: c.getAttribute("Counter"), handPlant: c.getAttribute("HandPlant") === "true", handState: c.getAttribute("HandState") === "true"
  };
}
function parseSchedule(el) {
  return kids(el, "DayList").map(dl => ({
    weekday: dl.getAttribute("WeekDay"),
    entries: kids(dl, "DayEntry").map(e => ({ time: (e.getAttribute("Time") || "").slice(0, 5), value: e.getAttribute("Value") }))
  }));
}
function parseFuncObj(el) {
  const fo = { addr: el.getAttribute("Addr"), type: el.getAttribute("Type"), text: textOf(el), paras: [], sources: [] };
  for (const c of el.children) if (c.tagName === "Para") fo.paras.push(parsePara(c));
  fo.sources = fo.paras.flatMap(pp => pp.values.filter(v => v.type === "Source").map(v => v.text));
  return fo;
}
function parsePara(el) {
  const p = { addr: el.getAttribute("Addr"), texts: [], pcode: null, values: [], act: null, funcObjs: [], schedules: [], stateTexts: {}, fast: null };
  for (const c of el.children) {
    switch (c.tagName) {
      case "Text": p.texts.push((c.textContent || "").trim()); break;
      case "PCode": p.pcode = (c.textContent || "").trim(); break;
      case "Value": p.values.push(readVal(c)); break;
      case "ActValue": p.act = readVal(c); break;
      case "FuncObj": p.funcObjs.push(parseFuncObj(c)); break;
      case "Schedule": p.schedules.push(parseSchedule(c)); break;
      case "StateText": p.stateTexts[c.getAttribute("Num")] = (c.textContent || "").trim(); break;
      case "FastAccess": p.fast = (c.textContent || "").trim(); break;
    }
  }
  return p;
}
const foPara = (fo, addr) => fo && fo.paras.find(p => p.addr === addr);
export const foVal = (fo, addr) => { const v = pv(foPara(fo, addr)); return v ? v.text : ""; };
export const paraOf = (n, addr, sub) => {
  const list = sub ? ((n.subObjs.find(s => s.addr === sub) || {}).paras || []) : (n.paras || []);
  return list.find(p => p.addr === addr) || null;
};

/* Quellpfad zerlegen: "[Umformung] //mod/anl/grp/obj/rest" oder "/zentrale/mod/…" */
function parseSrc(raw, centralAddr) {
  const t = (raw || "").trim();
  if (!t) return null;
  const toks = t.split(/\s+/);
  const path = toks.pop();
  const transform = toks.join(" ");
  if (!path.startsWith("/")) return null;
  let parts, central = null;
  if (path.startsWith("//")) parts = path.slice(2).split("/");
  else { parts = path.slice(1).split("/"); central = parts.shift(); }
  parts = parts.filter(x => x.length);
  if (parts.length < 4) return null;
  const [mod, plant, group, obj, ...rest] = parts;
  const foreign = central != null && centralAddr !== "" && parseInt(central, 10) !== parseInt(centralAddr, 10);
  return { central, foreign, mod, plant, group, obj, rest: rest.join("/"), transform, raw: t };
}
const nodeIdOf = (src) => (src.foreign ? "Z" + src.central + ":" : "") + src.mod + "/" + src.plant + "/" + src.group + "/" + src.obj;

export function parseD4PML(text, label, fileName) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML nicht lesbar");
  const root = doc.documentElement;
  if (root.tagName !== "D4PML") throw new Error("Kein D4PML-Dokument");
  const C = newCentral("D4PML", label, fileName);
  const M = C.meta;
  const hd = kid(root, "Header");
  const ident = hd && kid(hd, "Identity"), ver = hd && kid(hd, "Version");
  M.centralAddr = ident ? ident.getAttribute("CentralAddr") || "" : "";
  M.bacnetDevId = ident ? ident.getAttribute("BacnetDevId") || "" : "";
  M.applRev = ver ? ver.getAttribute("applRev") || "" : "";
  M.build = ver ? ver.getAttribute("build") || "" : "";
  M.defdata = ver ? ver.getAttribute("defdataRev") || "" : "";
  M.d4pmlVersion = root.getAttribute("Version") || "";
  const invoke = hd && kid(hd, "InvokeID") ? kid(hd, "InvokeID").textContent.trim() : "";
  const pending = [];
  const content = kid(root, "Content");

  for (const central of kids(content, "Central")) {
    for (const modEl of kids(central, "Module")) {
      const mAddr = modEl.getAttribute("Addr"), mType = modEl.getAttribute("Type") || "";
      const res = modEl.getAttribute("ResInfo") || "";
      const mod = { addr: mAddr, type: mType, name: textOf(modEl), active: !/inactive/i.test(res), res, hw: "", fw: "", pinCount: 0, kinds: {} };
      C.modules.push(mod);
      if (mAddr === "000") { M.stationType = mType; if (mod.name) M.name = mod.name; }
      for (const plantEl of kids(modEl, "Plant")) {
        const pAddr = plantEl.getAttribute("Addr"), plantName = textOf(plantEl);
        for (const groupEl of kids(plantEl, "Group")) {
          const gAddr = groupEl.getAttribute("Addr");
          const gKey = mAddr + "/" + pAddr + "/" + gAddr;
          if (!C.groups.has(gKey)) C.groups.set(gKey, {
            key: gKey, mod: mAddr, modType: mType, plant: pAddr, plantType: plantEl.getAttribute("Type"), plantName,
            group: gAddr, groupType: groupEl.getAttribute("Type"), groupName: textOf(groupEl), isPinGroup: false, nodes: []
          });
          const G = C.groups.get(gKey);
          for (const objEl of kids(groupEl, "Object")) {
            const n = parseObjectD4(objEl, C, mAddr, pAddr, gAddr, gKey, pending);
            if (n.type === "P") G.isPinGroup = true;
            if (n.type === "SY_Modul") {
              mod.fw = foVal({ paras: n.paras }, "899"); mod.hw = foVal({ paras: n.paras }, "HwRev");
            }
            C.nodes.set(n.id, n); G.nodes.push(n.id);
          }
          if (G.isPinGroup && G.nodes.some(id => C.nodes.get(id).type !== "P")) {
            // Systemobjekte in Klemmengruppen nicht als Klemmen behandeln
          }
        }
      }
    }
  }

  /* Verknüpfungen auflösen */
  for (const pe_ of pending) {
    const src = parseSrc(pe_.src, M.centralAddr);
    if (!src) { C.notes.push("Quellpfad nicht auflösbar: " + pe_.src); continue; }
    const fromId = nodeIdOf(src);
    let from = C.nodes.get(fromId);
    if (!from) from = ghostNode(C, src, fromId);
    const m = src.rest.match(/^(C[A-Z]{2})\b/);
    if (m && from.pinFuncs) from.pinFuncs.add(m[1]);
    C.edges.push({ from: fromId, to: pe_.to, toPara: pe_.toPara, toSub: pe_.toSub, fromRest: src.rest, transform: src.transform, raw: src.raw, inv: false });
  }
  indexEdges(C);

  buildPinsD4(C);
  extractSystemD4(C, invoke);
  extractExtrasD4(C);
  flattenD4(C);
  if (!M.name) M.name = (label && !/^(datasave|param_backup)$/i.test(label)) ? label : (M.location && M.location !== M.stationType ? M.location : (M.stationType ? M.stationType + (M.centralAddr ? " · Z" + M.centralAddr : "") : label));
  M.format = /^BMR/i.test(M.stationType) ? "BMR · D4PML " + M.d4pmlVersion : (M.stationType || "DDC4000") + " · D4PML " + M.d4pmlVersion;
  return C;
}

function parseObjectD4(objEl, C, mAddr, pAddr, gAddr, gKey, pending) {
  const oAddr = objEl.getAttribute("Addr"), type = objEl.getAttribute("Type") || oAddr.split(".")[0];
  const id = gKey + "/" + oAddr;
  const n = {
    id, mod: mAddr, plant: pAddr, group: gAddr, gKey, addr: oAddr, type, name: textOf(objEl),
    pcode: kid(objEl, "PCode") ? kid(objEl, "PCode").textContent.trim() : "",
    paras: [], subObjs: [], formula: "", images: [], schedules: [], calendar: [], pinFuncs: new Set(),
    isPin: type === "P", ghost: false, alarms: [], bacnet: [], lopr: [], fmt: "d4"
  };
  for (const c of objEl.children) {
    if (c.tagName === "Para") n.paras.push(parsePara(c));
    else if (c.tagName === "SubObj") {
      const sub = { addr: c.getAttribute("Addr"), type: c.getAttribute("Type"), paras: [], schedules: [], lopr: [] };
      for (const sc of c.children) {
        if (sc.tagName === "Para") sub.paras.push(parsePara(sc));
        else if (sc.tagName === "Schedule") sub.schedules.push(parseSchedule(sc));
        else if (sc.tagName === "BACnet") {
          for (const opr of sc.getElementsByTagName("OPR"))
            sub.lopr.push({ dev: opr.getAttribute("DevInst"), type: opr.getAttribute("ObjType"), inst: opr.getAttribute("ObjInst"), prop: opr.getAttribute("Prop") });
        }
      }
      n.subObjs.push(sub);
    }
    else if (c.tagName === "Image") n.images.push((c.textContent || "").trim());
    else if (c.tagName === "Schedule") n.schedules.push(parseSchedule(c));
    else if (c.tagName === "Calendar") {
      for (const d of c.children) {
        const a = [...d.attributes].map(x => x.name + "=" + x.value).join(" ");
        n.calendar.push(d.tagName + (a ? " " + a : ""));
      }
    }
  }
  if (type === "M") { const f = n.paras.find(p => p.addr === "5"); const v = pv(f); if (v && v.type === "Text") n.formula = v.text; }
  if (!n.name) {
    const p2 = n.paras.find(p => p.addr === "2" && p.texts.length);
    if (p2) n.name = p2.texts[0];
  }
  if (type === "P" && !n.name) {
    const sub = n.subObjs[0]; const pp = sub && sub.paras.find(p => p.texts.length);
    if (pp) n.name = pp.texts[0];
  }
  const walk = (paras, subAddr) => {
    for (const p of paras) for (const fo of p.funcObjs) {
      if (fo.type === "FSource") for (const src of fo.sources) pending.push({ to: id, toPara: p.addr, toSub: subAddr || "", src });
      else if (fo.type === "FSelMO") n.alarms.push({ para: p.addr, sub: subAddr || "", target: foVal(fo, "1"), prio: foVal(fo, "102"), cls: foVal(fo, "6") });
      else if (fo.type && fo.type.startsWith("FB_") && FB_TYPES[fo.type]) {
        n.bacnet.push({ fb: fo.type, btype: FB_TYPES[fo.type][0], blabel: FB_TYPES[fo.type][1], inst: foVal(fo, "ObjId"), cov: foVal(fo, "COVInc"),
          para: p.addr, sub: subAddr || "", text: fo.text || p.texts[0] || "" });
      }
    }
  };
  walk(n.paras, "");
  for (const sub of n.subObjs) walk(sub.paras, sub.addr);
  return n;
}

function ghostNode(C, src, id) {
  const gKey = (src.foreign ? "Z" + src.central + ":" : "") + src.mod + "/" + src.plant + "/" + src.group;
  if (!C.groups.has(gKey)) C.groups.set(gKey, {
    key: gKey, mod: src.mod, modType: "", plant: src.plant, plantType: "", plantName: src.foreign ? "Zentrale " + src.central : "",
    group: src.group, groupType: "", groupName: "", isPinGroup: /^P\./.test(src.obj), nodes: [], ghostGroup: true, foreign: src.foreign
  });
  const G = C.groups.get(gKey);
  const n = { id, mod: src.mod, plant: src.plant, group: src.group, gKey, addr: src.obj, type: src.obj.split(".")[0], name: "",
    pcode: "", paras: [], subObjs: [], formula: "", images: [], schedules: [], calendar: [], pinFuncs: new Set(),
    isPin: /^P\./.test(src.obj), ghost: true, ghostGroupMissing: !!G.ghostGroup, foreign: src.foreign, alarms: [], bacnet: [], lopr: [], fmt: "d4" };
  C.nodes.set(id, n); G.nodes.push(id);
  if (n.isPin) G.isPinGroup = true;
  return n;
}

/* ---------- Klemmen ---------- */
const SUB_KIND = { CAI: "AE", CAO: "AA", CDI: "BE", CDO: "BA" };
const P1_KIND = { "1": "BE", "2": "BA", "3": "AE", "4": "AA" };
const PRIM_PARA = { CAI: "b", CDI: "k", CDO: "K", CAO: "Y" };

function buildPinsD4(C) {
  const modType = new Map(C.modules.map(m => [m.addr, m]));
  for (const n of C.nodes.values()) {
    if (n.type !== "P" || n.ghost) continue;
    const sub = n.subObjs.find(x => SUB_KIND[x.type]);
    const p1 = n.paras.find(p => p.addr === "1");
    const prim = sub ? sub.paras.find(p => p.addr === PRIM_PARA[sub.type]) : null;
    const sec = sub ? sub.paras.find(p => p.addr === (sub.type === "CAO" ? "y" : sub.type === "CDO" ? "k" : "\u0000")) : null;
    const ins = edgesIn(C, n.id), outs = edgesOut(C, n.id);
    const paraText = prim && prim.texts[0] || "";
    const name = textOfName(n);
    let kind = sub ? SUB_KIND[sub.type] : null;
    const declared = p1 ? P1_KIND[(pv(p1) || {}).text] || null : null;
    let corr = null, invert = false, trend = false;
    const funcs = [], bac = [], alarms = [];
    if (sub) for (const sp of sub.paras) for (const fo of sp.funcObjs) {
      if (fo.type === "F019") { const v = pv(foPara(fo, "C")); corr = { val: v ? v.text : "0", unit: v ? v.unit : null, num: v ? parseFloat(v.text) : 0 }; }
      else if (fo.type === "F014") invert = true;
      else if (fo.type === "FB_TR") trend = true;
      if (fo.type === "FSelMO") alarms.push(fo);
      if (fo.type !== "FSource" && fo.type !== "F019")
        funcs.push({ type: fo.type, addr: fo.addr, label: FUNC_NAMES[fo.type] || (FB_TYPES[fo.type] ? "BACnet " + FB_TYPES[fo.type][1] : fo.type),
          paras: fo.paras.filter(x => x.values.length).map(x => x.addr + "=" + valText(pv(x))) });
    }
    const stored = pv(prim);
    let eff = null;
    if (kind === "AE" || kind === "BE") eff = prim ? (prim.act || stored) : null;
    else if (kind === "AA" || kind === "BA") eff = (sec && pv(sec)) || (prim ? (prim.act || stored) : null);
    const hasAny = !!(name || paraText || ins.length || outs.length || funcs.length);
    const free = !sub || !hasAny;
    const finalKind = free ? "frei" : (kind || declared || "frei");
    const st = sub ? sub.paras.find(p => p.addr === "SType") : null;
    const reserveName = /(^|[\s(])(res|reserve)([\s).]|$)/i.test(name + " " + paraText);
    const pin = {
      uid: n.id, nodeId: n.id, cid: C.cid, module: n.mod, moduleType: (modType.get(n.mod) || {}).type || "", addr: n.addr,
      klemme: n.mod + "/" + n.addr, name, paraText, kind: finalKind, declaredKind: declared, subType: sub ? sub.type : null,
      value: { stored, eff, invalid: isOutputKind(finalKind) ? !!(eff && eff !== stored && eff.invalid) : !!(stored && stored.invalid), deleted: !isOutputKind(finalKind) && !!(stored && stored.deleted) },
      corr, invert, trend, funcs, alarms, sources: ins, consumers: outs,
      bacnet: n.bacnet, reserve: reserveName && !ins.length && !outs.length,
      sensorType: st ? (pv(st) || {}).text : null, kennlinie: p1 ? (pv(p1) || {}).text : null
    };
    C.pins.push(pin);
    n.pin = pin;
    const m = modType.get(n.mod);
    if (m) { m.pinCount++; m.kinds[finalKind] = (m.kinds[finalKind] || 0) + 1; }
  }
  C.pins.sort((a, b) => natCmp(a.module, b.module) || natCmp(a.addr, b.addr));
}
function textOfName(n) { return n.name || ""; }

/* ---------- System ---------- */
function extractSystemD4(C, invoke) {
  const M = C.meta, sys = C.system;
  const byType = t => [...C.nodes.values()].find(n => n.type === t && !n.ghost && n.mod === "000");
  const P = (n, a, sub) => { const p = n && paraOf(n, a, sub); return p ? pv(p) : null; };
  const add = (group, k, v, warn) => { if (v != null && v !== "") sys.push({ group, k, v: String(v), warn: !!warn }); };

  const clk = byType("SY_Clock"); const cv = P(clk, "1");
  if (cv && fmtUnix(cv.text)) { M.stamp = fmtUnix(cv.text); M.stampSrc = "Systemuhr in der Sicherung"; }
  else if (invoke && parseInt(invoke.slice(0, 4), 10) > 2005) { M.stamp = invoke.replace("T", " ").slice(0, 16); M.stampSrc = "Exportkennung"; }

  add("Station", "Typ", M.stationType);
  add("Station", "Zentrale", M.centralAddr);
  add("Station", "Firmware", M.applRev + (M.build ? " (Build " + M.build + ")" : ""));
  add("Station", "Defdata", M.defdata);
  const m0 = byType("SY_Modul");
  add("Station", "Hardware", (P(m0, "HwRev") || {}).text);
  const bd = byType("SY_BACDev");
  if (bd) {
    add("BACnet", "Device-Instanz", (P(bd, "ObjId") || {}).text || M.bacnetDevId);
    add("BACnet", "Objektname", (P(bd, "ObjName") || {}).text);
    add("BACnet", "Standort", (P(bd, "Location") || {}).text);
    M.location = (P(bd, "Location") || {}).text || "";
  } else add("BACnet", "Device-Instanz", M.bacnetDevId);
  const net = byType("SY_Network");
  if (net) {
    add("Netzwerk", "IP-Adresse", (P(net, "4", "CEth.01") || {}).text);
    add("Netzwerk", "Gateway", (P(net, "Gateway") || {}).text);
    add("Netzwerk", "DNS", (P(net, "DNS1") || {}).text);
    add("Netzwerk", "MAC", (P(net, "MACAdr") || {}).text);
    const link = (P(net, "28", "CNetStat.01") || {}).text; if (link) add("Netzwerk", "Link", link.replace(/\s+/g, " ").replace(/^Link detected:\s*/i, ""));
    const err = P(net, "EthError", "CNetStat.01"); if (err) add("Netzwerk", "Ethernet-Fehlerzähler", err.text);
  }
  const hosts = byType("SY_Hosts"); add("Netzwerk", "Host", (P(hosts, "1") || {}).text);
  const cfg = byType("SY_Config");
  if (cfg) {
    const t = P(cfg, "Temp"), u = P(cfg, "Voltage"), b = P(cfg, "Battery");
    if (t) add("Gerät", "Innentemperatur", fmtNum(t.text) + " °C", parseFloat(t.text) > 55);
    if (u) add("Gerät", "Versorgung intern", fmtNum(u.text) + " V");
    if (b) { const bv = parseFloat(b.text); add("Gerät", "Pufferbatterie", fmtNum(b.text) + " V", bv > 0 && bv < 2.8); M.battery = bv; }
    add("Gerät", "Bedienteil", (P(cfg, "4") || {}).text);
  }
  const ds = byType("SY_Datsi"); const fm = P(ds, "freeMem"); if (fm) add("Gerät", "Freier Speicher", fm.text + " %", parseInt(fm.text, 10) < 10);
  for (const can of [...C.nodes.values()].filter(n => n.type === "SY_CAN" && n.mod === "000")) {
    const tx = P(can, "TXFrame"), rx = P(can, "RXFrame");
    if (tx || rx) add("Bus", can.addr, "TX " + (tx ? fmtNum(tx.text) : "–") + " · RX " + (rx ? fmtNum(rx.text) : "–"));
  }
  const em = byType("SY_Email"); add("Meldungsversand", "E-Mail-Empfänger", (P(em, "1") || {}).text);
  const smtp = byType("SY_SMTP");
  if (smtp) { add("Meldungsversand", "SMTP-Server", (P(smtp, "hostname") || {}).text); add("Meldungsversand", "SMTP-Benutzer", (P(smtp, "user") || {}).text); add("Meldungsversand", "SMTP-Port", (P(smtp, "1") || {}).text); }
  const usr = byType("SY_User");
  if (usr) for (const sub of usr.subObjs) {
    const pw = sub.paras.find(p => p.addr === "password"), lv = sub.paras.find(p => p.addr === "level");
    C.users.push({ user: sub.addr.replace("CUser.", "Benutzer "), level: lv ? (pv(lv) || {}).text : "", password: pw ? (pv(pw) || {}).text : "" });
  }
}

/* ---------- Zeitprogramme, Kalender, Meldungen, BACnet, Betriebsstunden ---------- */
function extractExtrasD4(C) {
  const devInst = C.meta.bacnetDevId;
  for (const n of C.nodes.values()) {
    if (n.ghost) continue;
    for (const b of n.bacnet) C.bacnet.push(Object.assign({ nodeId: n.id, name: b.text || n.name }, b));
    if (n.type === "S118") {
      for (const sub of n.subObjs) {
        const days = sub.schedules[0] || (n.schedules[0] || []);
        const obj = (pv(sub.paras.find(p => p.addr === "ObjId")) || {}).text;
        if (obj) C.bacnet.push({ nodeId: n.id, fb: "SCHED", btype: 17, blabel: "Schedule", inst: obj, cov: "", para: "ObjId", sub: sub.addr, name: n.name });
        C.schedules.push({
          id: n.id + "/" + sub.addr, nodeId: n.id, name: n.name || nodePlace(C, n), place: nodePlace(C, n), days,
          def: (pv(sub.paras.find(p => p.addr === "Default")) || {}).text,
          act: (pv(sub.paras.find(p => p.addr === "actValue")) || {}).text,
          nxt: (pv(sub.paras.find(p => p.addr === "nxtValue")) || {}).text,
          objId: obj, lopr: sub.lopr, consumers: edgesOut(C, n.id), kind: "S118"
        });
        for (const l of sub.lopr) if (l.dev && devInst && l.dev !== devInst && l.dev !== "4194303")
          n.loprForeign = (n.loprForeign || []).concat([l]);
      }
    }
    if (n.type === "S116") {
      const obj = (pv(n.paras.find(p => p.addr === "ObjId")) || {}).text;
      if (obj) C.bacnet.push({ nodeId: n.id, fb: "CAL", btype: 6, blabel: "Calendar", inst: obj, cov: "", para: "ObjId", sub: "", name: n.name });
      C.calendars.push({ nodeId: n.id, name: n.name, dates: n.calendar, out: valText(pv(n.paras.find(p => p.addr === "j"))) });
    }
    if (n.type === "SY_BACDev") {
      const obj = (pv(n.paras.find(p => p.addr === "ObjId")) || {}).text;
      if (obj) C.bacnet.push({ nodeId: n.id, fb: "DEV", btype: 8, blabel: "Device", inst: obj, cov: "", para: "ObjId", sub: "", name: (pv(n.paras.find(p => p.addr === "ObjName")) || {}).text || "" });
    }
    if (n.type === "SY_MsgMan" && n.addr === "SY_MsgMan.01") {
      const p103 = n.paras.find(p => p.addr === "103");
      if (p103) for (const fo of p103.funcObjs.filter(f => f.type === "FMSG")) {
        const srcPath = foVal(fo, "2");
        const src = parseSrc(srcPath, C.meta.centralAddr);
        const t101 = foVal(fo, "101"), t102 = foVal(fo, "102");
        C.messages.push({
          id: fo.addr, text: foVal(fo, "1"), path: srcPath, nodeId: src ? nodeIdOf(src) : null, kind: foVal(fo, "4"), cls: foVal(fo, "6"),
          come: parseInt(t101, 10) || 0, go: parseInt(t102, 10) || 0, comeTxt: fmtUnix(t101), goTxt: fmtUnix(t102),
          active: !t102, flag100: foVal(fo, "100") === "true", flag103: foVal(fo, "103") === "true"
        });
      }
      C.messages.sort((a, b) => b.come - a.come);
    }
    if (n.alarms.length) for (const a of n.alarms) {
      const p = paraOf(n, a.para, a.sub);
      C.alarms.push({ nodeId: n.id, para: a.para, name: (p && p.texts[0]) || n.name || n.addr, place: nodePlace(C, n), state: p ? pe(p) : null, prio: a.prio });
    }
    /* Betriebsstunden */
    const hp = n.type === "H901" ? "27" : n.type === "H601" ? "6" : null;
    if (hp) { const v = pv(paraOf(n, hp)); if (v && v.text) C.hours.push({ nodeId: n.id, label: (paraOf(n, hp).texts[0]) || n.name || nodePlace(C, n), place: nodePlace(C, n), hours: parseFloat(v.text) }); }
    for (const p of n.paras) for (const fo of p.funcObjs) if (fo.type === "F002") {
      const v = pv(foPara(fo, "bst")); if (v) C.hours.push({ nodeId: n.id, label: (p.texts[0] || n.name || n.addr) + " (F002)", place: nodePlace(C, n), hours: parseFloat(v.text) });
    }
  }
  C.trends = C.bacnet.filter(b => b.fb === "FB_TR");
  C.schedules.sort((a, b) => natCmp(a.nodeId, b.nodeId));
}

/* ---------- Abflachen für den Vergleich zweier Sicherungen ---------- */
const VOLATILE = {
  S238: "5101 5105 5110 5111 5112 5113 5169 5205 5207 5211 5255 i011 i012 i022", S066: "2 3", S337: "5101 5105 5110",
  H614: "3 5 6 24", H613: "7 8", H601: "2 6 11 21 22", H901: "2 9 19 27 28 30", M: "6", T: "t Tstart", L: "1",
  S336: "5570 5573 5574", S116: "j", S118: "actValue nxtValue rTime Info BACInfo", S325: "32", S335: "4", S322: "5537 5538",
  CAI: "b", CAO: "Y y", CDI: "k", CDO: "K k"
};
const VOL_SET = Object.fromEntries(Object.entries(VOLATILE).map(([k, v]) => [k, new Set(v.split(" "))]));
const SY_KEEP = new Set(["SY_BACDev", "SY_Network", "SY_Hosts", "SY_Email", "SY_SMTP", "SY_I18N", "SY_BMR400"]);
function flattenD4(C) {
  const F = C.flat;
  const put = (key, nid, label, val) => F.set(key, { nid, label, val });
  for (const n of C.nodes.values()) {
    if (n.ghost) continue;
    if (n.type.startsWith("SY_") && !SY_KEEP.has(n.type)) continue;
    if (n.name) put(n.id + "|Text", n.id, "Bezeichnung", n.name);
    const doParas = (paras, sub, subType) => {
      for (const p of paras) {
        const vol = (VOL_SET[n.type] && VOL_SET[n.type].has(p.addr)) || (subType && VOL_SET[subType] && VOL_SET[subType].has(p.addr)) || (sub === "CNetStat.01");
        const base = n.id + "|" + (sub ? sub + "/" : "") + p.addr;
        const lbl = (sub ? sub + " · " : "") + (p.texts[0] || portLabel(n.type, p.addr));
        if (p.texts[0]) put(base + "|Text", n.id, lbl + " (Text)", p.texts[0]);
        const v = pv(p);
        if (!vol && v && v.type !== "Source" && v.type !== "Bool" && !v.deleted && !v.invalid && v.unit !== "71" && p.addr !== "password")
          put(base, n.id, lbl, valText(v, p.stateTexts));
        for (const fo of p.funcObjs) {
          if (fo.type === "FSource") fo.sources.forEach((sv, i) => put(base + "|src" + (i || ""), n.id, lbl + " ◄ Quelle", sv.replace(/\s+/g, " ").trim()));
          else if (fo.type === "FMSG" || fo.type === "F017") continue;
          else for (const fp of fo.paras) {
            if (fo.type === "FB_TR" && /^(12|13|14)$/.test(fp.addr)) continue;
            const fv = pv(fp);
            if (fv && fv.type !== "Source" && !fv.deleted && fv.type !== "Bool") put(base + "|" + fo.addr + "/" + fp.addr, n.id, lbl + " · " + fo.type + " " + fp.addr, valText(fv));
          }
        }
        for (const sch of p.schedules) put(base + "|sched", n.id, lbl + " · Zeitprogramm", schedText(sch));
      }
    };
    doParas(n.paras, "", "");
    for (const sub of n.subObjs) {
      doParas(sub.paras, sub.addr, sub.type);
      sub.schedules.forEach((sch, i) => put(n.id + "|" + sub.addr + "|sched" + (i || ""), n.id, sub.addr + " · Zeitprogramm", schedText(sch)));
    }
    n.schedules.forEach((sch, i) => put(n.id + "|sched" + (i || ""), n.id, "Zeitprogramm", schedText(sch)));
    if (n.calendar.length) put(n.id + "|cal", n.id, "Kalender", n.calendar.join("; "));
  }
}
export const WD = { mo: "Mo", tu: "Di", we: "Mi", th: "Do", fr: "Fr", sa: "Sa", su: "So", ho: "Feiertag", sp: "Sondertag" };
export function schedText(days) { return (days || []).map(d => (WD[d.weekday] || d.weekday) + " " + d.entries.map(e => e.time + "=" + e.value).join(" ")).join(" · "); }

