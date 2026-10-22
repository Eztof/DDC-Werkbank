import { go } from "../core/nav.js";
import { APP } from "../core/state.js";
import { WD_TABS } from "../core/ext.js";
import { $, h, natCmp, norm, trunc, uniq } from "../core/util.js";
import { KIND_INFO, isOutputKind, pinOf } from "../model/model.js";
import { btn, emptyState, icon, kindTag, renderAll, selectEl, stationLabel, toast } from "../shell/shell.js";
import { PERSIST, pentry, pput, pref, setPref } from "../core/persist.js";
import { WTG_NS, dpArtikel, infoValue, wdModel } from "./generator.js";
import { assignPlant } from "./anlagen.js";
import { WDOC, WX, wRenumber, wSnapshot, wdocChanged, wkid, wkids, wplace, wset, wtxt } from "./wtgml.js";
import { artName, artProp, jumpToArt, jumpToPin, pinForArt, wIsps } from "./view.js";

/* =========================================================================
   Wartungsdoku ↔ Sicherung: Verknüpfung, auch nachträglich
   Ordnet jedem Datenpunkt-Eintrag der Doku die passende Klemme zu – auch bei
   Dokus, die nicht aus der Werkbank stammen (z. B. Vorjahres-Doku eines
   Kollegen). Erkennung über AKS-Kennzeichen, Signalart und Klartext.
   Fest wird eine Verknüpfung, wenn „Klemme …“ im Info-Feld des Eintrags steht –
   genau so, wie es die Werkbank beim Erzeugen aus der Sicherung schreibt.
   ========================================================================= */
const LK_KIND = { "#AE": "AE", "#AA": "AA", "#BE": "BE", "#BA": "BA" };
export const LK_ON = new Set(["fest", "sicher"]);            // zählt als verknüpft
const LK_OPEN = new Set(["wahrsch", "pruefen", "keine"]);
const LK_TXT = { fest: "eingetragen", sicher: "sicher erkannt", wahrsch: "wahrscheinlich", pruefen: "bitte prüfen", keine: "kein Treffer", ohne: "ohne Klemme" };
const LK_PILL = { fest: "ok", sicher: "ok soft", wahrsch: "warn", pruefen: "warn", keine: "err", ohne: "" };
let LK_VER = 1;                                        // erhöht bei Entscheidungen → Caches neu

/* ---------- Merkmale ---------- */
export const lkFold = s => norm(s).replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
export function lkAks(s) { const m = String(s || "").trim().match(/^([A-Za-z0-9]+(?:_[A-Za-z0-9]+){2,})/); return m ? m[1].toUpperCase() : ""; }
/* Schreibvarianten vereinheitlichen: „AA_41“ = „AA41“, „ICB_41“ = „ICB41“ */
export const lkCanon = aks => aks.replace(/(^|_)([A-Z]+)_(\d+)(?=_|$)/g, "$1$2$3");
/* gängige Langformen auf die Kürzel abbilden, damit „Brandschutzklappe“ zu „BSK“ passt */
const LK_SYN = { brandschutzklappe: "bsk", brandschutzklappen: "bsk", volumenstromregler: "vsr", volumenstromreglers: "vsr" };
export const lkWords = s => lkFold(s).replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 1).map(w => LK_SYN[w] || w);
function lkFeat(text, kind) {
  const t = String(text || "").trim();
  const raw = lkAks(t), aks = raw ? lkCanon(raw) : "";
  const words = uniq(lkWords(raw ? t.slice(raw.length) : t));
  return { aks, segs: aks ? aks.split("_") : null, words, full: aks + "|" + words.join(" "), kind: kind || null };
}
/* Wortähnlichkeit: Mittel aus Dice und Überdeckung; Präfixe (≥ 4 Zeichen) zählen fast voll */
function lkSim(a, b) {
  if (!a.length || !b.length) return 0;
  let n = 0;
  for (const w of a) {
    if (b.includes(w)) { n += 1; continue; }
    if (w.length >= 4 && b.some(x => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) n += 0.8;
  }
  return 0.5 * (2 * n / (a.length + b.length)) + 0.5 * Math.min(1, n / Math.min(a.length, b.length));
}
/* Verwandtschaft zweier AKS: 1 gleich · 0.75 gleiches Ende (Anlage+Bauteil), anderer ISP-Teil ·
   0.55 eins ist Anfang des anderen bzw. Mitte umbenannt · 0 fremd */
export function lkAksRel(a, p) {
  if (!a || !p) return 0;
  if (a.length === p.length && a.every((s, i) => s === p[i])) return 1;
  const n = Math.min(a.length, p.length);
  const lastA = a[a.length - 1], lastP = p[p.length - 1];
  if (n >= 4 && a.slice(-3).join("_") === p.slice(-3).join("_")) return 0.75;     // anderer ISP-Teil
  let k = 0; while (k < n && a[k] === p[k]) k++;
  if (k === n && k >= 3) return 0.55;                                              // gekürzt
  if (n >= 3 && a[0] === p[0] && lastA === lastP) return 0.55;                     // Mitte umbenannt
  if (n >= 3 && lastA === lastP && /^[A-Z]+\d+$/.test(lastA)) return 0.45;         // nur Bauteil gleich
  return 0;
}
/* Punktzahl 0…100 für Eintrag ↔ Klemme */
function lkScore(af, pf) {
  const kindBad = !!(af.kind && pf.kind && af.kind !== pf.kind);
  const sim = lkSim(af.words, pf.words);
  if (af.aks && pf.aks) {
    const rel = lkAksRel(af.segs, pf.segs);
    if (rel === 1) {
      const s = af.full === pf.full ? 100 : Math.round(62 + 38 * sim);
      if (!kindBad) return s;
      if (sim < 0.6) return 0;
      /* andere Signalart: Ausgang↔Ausgang (z. B. Klappe zwei-Punkt → stetig) eher plausibel als Ausgang↔Eingang */
      return isOutputKind(af.kind) === isOutputKind(pf.kind) ? Math.min(72, s - 20) : Math.min(55, s - 35);
    }
    if (kindBad || !rel) return 0;
    if (rel === 0.75) return sim >= 0.5 ? Math.round(45 + 35 * sim) : 0;
    if (rel === 0.55) return sim >= 0.6 ? Math.round(30 + 30 * sim) : 0;
    return sim >= 0.75 ? Math.round(25 + 30 * sim) : 0;
  }
  if (kindBad) return 0;
  if (af.words.length && af.full === pf.full) return 100;
  if (!af.words.length || !pf.words.length) return 0;
  return sim >= 0.6 ? Math.round(75 * sim) : 0;
}

/* ---------- Sicherung: Klemmen-Merkmale (je Zentrale einmal) ---------- */
export function lkPins(C) {
  if (C._lk) return C._lk;
  const list = [], byAks = new Map(), byKlemme = new Map(), byFull = new Map();
  for (const p of C.pins) {
    if (p.kind === "frei") continue;
    const f = lkFeat(p.name || p.paraText || "", p.kind); f.p = p;
    list.push(f); byKlemme.set(p.klemme, f);
    if (f.aks) { if (!byAks.has(f.aks)) byAks.set(f.aks, []); byAks.get(f.aks).push(f); }
    if (f.aks || f.words.length) byFull.set(f.full, f);
  }
  return (C._lk = { list, byAks, byKlemme, byFull });
}
const lkCentralKey = C => [C.meta.name, C.meta.centralAddr, C.meta.stationType].join("|");

/* ---------- Doku: Einträge einer ISP ---------- */
function lkInfoKlemme(a) { const p = artProp(a, "Info"); const m = p && wtxt(p, "value").match(/Klemme\s+([^\s·]+)/); return m ? m[1] : ""; }
/* Klemme ohne Signalweg im Programm? (Eingang nicht verwendet / Ausgang nicht angesteuert) */
const LK_NOLINK = "Nicht verknüpft";
/* Geht die Klemme außerhalb des Programms weiter? BACnet-Objekt direkt am Pin, Trend, Meldung */
export function pinExternal(p) {
  if (!p) return [];
  const out = [];
  const isOut = isOutputKind(p.kind);
  const bac = p.bacnet.filter(b => b.fb !== "FB_TR");
  if (bac.length) out.push("BACnet " + bac.map(b => b.fb.replace(/^FB_/, "") + " " + b.inst).join(", "));
  if (!isOut && (p.trend || p.bacnet.some(b => b.fb === "FB_TR"))) out.push("Trend");
  if (!isOut && p.alarms && p.alarms.length) out.push("Meldung");
  return out;
}
/* Klemme ohne Signalweg: weder im Programm noch über BACnet/Trend/Meldung genutzt */
export function pinUnlinked(p) {
  if (!p || p.kind === "frei") return null;
  if (isOutputKind(p.kind) ? p.sources.length : p.consumers.length) return null;
  if (pinExternal(p).length) return null;
  return isOutputKind(p.kind) ? "Ausgang wird weder im Programm noch über BACnet angesteuert" : "Eingang wird weder im Programm verwendet noch über BACnet, Trend oder Meldung weitergegeben";
}
/* Nicht im Programm, aber über BACnet & Co. genutzt → kurzer Hinweis statt „nicht verknüpft“ */
export function pinOnlyExternal(p) {
  if (!p || p.kind === "frei") return null;
  if (isOutputKind(p.kind) ? p.sources.length : p.consumers.length) return null;
  const ex = pinExternal(p);
  if (!ex.length) return null;
  const bac = ex.some(x => x.startsWith("BACnet"));
  return { text: bac ? "nur BACnet" : "nur " + ex.join(" / "), why: (isOutputKind(p.kind) ? "Im Programm nicht angesteuert, aber " : "Im Programm nicht verwendet, aber ") + ex.join(" · ") };
}
/* Vorschlag für die Bemerkung eines Doku-Eintrags, dessen Klemme keinen Signalweg hat */
export function artRemarkSuggestion(a) {
  const isp = a && a.parentElement && a.parentElement.parentElement;
  const l = isp && isp.localName === "Isp" ? pinForArt(a, isp) : null;
  if (!l || !LK_ON.has(l.st)) return null;
  const why = pinUnlinked(l.p);
  return why ? { text: LK_NOLINK, why, p: l.p } : null;
}
/* Alle verknüpften Klemmen einer Sicherung → Doku-Eintrag (für die Datenpunktliste) */
export function docPinMap(C) {
  const D = WDOC.cur, m = new Map();
  if (!D || !C) return m;
  for (const { isp } of wIsps(D)) {
    const L = lkLinks(D, isp); if (L.C !== C) continue;
    for (const [uid, hit] of L.byPin) if (LK_ON.has(hit.l.st) && !m.has(uid)) m.set(uid, { f: hit.a.parentElement, a: hit.a, st: hit.l.st, isp });
  }
  return m;
}
export function artResult(a) {
  const ex = wkids(a, "job").map(j => wtxt(j, "executed"));
  if (!ex.length || ex.every(e => !e)) return { t: "offen", c: "" };
  if (ex.includes("Mangel")) return { t: "Mangel", c: "err" };
  if (ex.every(e => e === "Ja")) return { t: "Ja", c: "ok" };
  if (ex.some(e => !e)) return { t: "teilweise", c: "" };
  const o = ex.find(e => e !== "Ja");
  return { t: o, c: o === "Nein" || o === "nicht möglich" ? "warn" : "" };
}

/* Zuluft/Abluft hinten am Namen (Reiter „Zu-/Abluft“): für die Verknüpfung ohne Bedeutung */
const LK_TAG = /\s+(Zuluft|Abluft)\s*$/i;
export function lkSplitTag(kt) {
  kt = String(kt || "");
  const m = kt.match(LK_TAG);
  return m ? { base: kt.slice(0, m.index), tag: /^z/i.test(m[1]) ? "Zuluft" : "Abluft" } : { base: kt, tag: "" };
}
const LK_AIRTXT = /volumenstrom|brandschutz|\b(vsr|bsk)\b/i;
function lkMatchName(kt) { const sp = lkSplitTag(kt); return sp.tag && (lkAks(sp.base) || LK_AIRTXT.test(sp.base)) ? sp.base : String(kt || ""); }
export function lkArts(isp) {
  const out = [], seen = new Map();
  for (const f of wkids(isp, "facility")) for (const a of wkids(f, "Artikel")) {
    const nr = wtxt(a, "nummer").trim();
    const station = !/^#/.test(nr);
    const kt = lkMatchName(wtxt(a, "artKlartext"));
    const base = nr + "|" + lkFold(kt);
    const occ = (seen.get(base) || 0) + 1; seen.set(base, occ);
    out.push({ a, f, station, key: base + "|" + occ, info: station ? "" : lkInfoKlemme(a), feat: lkFeat(kt || wtxt(a, "artBezeichnung"), LK_KIND[nr] || null) });
  }
  return out;
}

/* ---------- Entscheidungen merken (pro Doku, im Browser) ---------- */
/* Schlüssel über das Objekt (Liegenschaft), nicht die Servicenummer – so gelten Entscheidungen
   auch für die Kopie im nächsten Jahr */
function lkDocKey(D) {
  const o = D.doc.getElementsByTagNameNS(WTG_NS, "prjObjekt")[0];
  const r = D.doc.documentElement;
  return o && o.getAttribute("objId") ? "obj:" + o.getAttribute("objId") : "prj:" + (r.getAttribute("prjId") || r.getAttribute("prjServiceNumber") || D.name || "");
}
function lkStore(D) {
  const k = lkDocKey(D);
  if (D._lks && D._lks.k === k && D._lks.gen === PERSIST.gen) return D._lks.v;
  const e = pentry("verknuepfung", k);
  const v = e && e.v && typeof e.v === "object" ? e.v : { isp: {}, art: {} };
  if (!v.isp) v.isp = {}; if (!v.art) v.art = {};
  D._lks = { k, v, gen: PERSIST.gen };
  return v;
}
/* Entscheidungen liegen in der Merkliste (Werkbank-Ordner bzw. Browser), nie in der Doku */
export function lkInvalidate() { LK_VER++; }
function lkSave(D) { pput("verknuepfung", lkDocKey(D), lkStore(D)); LK_VER++; }
export const lkIspKey = isp => wtxt(isp, "ispBezeichnung").trim();

/* ---------- Welche Sicherung gehört zu einer ISP? ---------- */
export function lkCentral(D, isp) {
  const key = APP.centrals.map(c => c.cid).join(",") + "|" + lkIspKey(isp) + "|" + LK_VER;
  if (isp._lkc && isp._lkc.key === key) return isp._lkc;
  const res = lkDetect(D, isp, true);
  res.key = key;
  return (isp._lkc = res);
}
function lkDetect(D, isp, useManual) {
  const cs = APP.centrals;
  const res = { key: "", C: null, how: "", hits: 0, of: 0 };
  if (!cs.length) return res;
  const bez = lkIspKey(isp);
  const man = useManual ? lkStore(D).isp[bez] : null;
  if (man === "-") { res.how = "manuell keine"; return res; }
  if (man) { const C = cs.find(c => lkCentralKey(c) === man); if (C) { res.C = C; res.how = "manuell"; return res; } }
  const nm = norm(bez);
  const byName = cs.find(c => norm(c.meta.name) === nm || (c.meta.stationName && norm(c.meta.stationName) === nm) || (APP.wd[c.cid] && norm(APP.wd[c.cid].isp.bez) === nm));
  if (byName) { res.C = byName; res.how = "Name"; return res; }
  /* Abstimmung: wie viele Einträge finden ihr AKS / ihren Klartext / ihre Klemme in der Sicherung? */
  const arts = lkArts(isp).filter(x => !x.station);
  res.of = arts.length;
  /* Ein Eintrag mit AKS stimmt nur über sein eigenes AKS ab. Die Klemmen-Info zählt nur bei Einträgen
     ohne AKS – sonst gewinnen baugleiche Stationen (gleiche Klemmenbelegung) nach dem Eintragen mit. */
  const stNr = lkStationNr(isp).toUpperCase();
  let best = null, bs = 0, bsoft = 0, btype = false;
  for (const c of cs) {
    const P = lkPins(c); let s = 0, soft = 0;
    for (const x of arts) {
      if (x.feat.aks) { if (P.byAks.has(x.feat.aks)) s += 1; continue; }
      if (x.feat.words.length && P.byFull.has(x.feat.full)) s += 1;
      else if (x.info && P.byKlemme.has(x.info) && lkScore(x.feat, P.byKlemme.get(x.info)) >= 60) soft += 1;
    }
    const typeOk = !!stNr && stNr === String(c.meta.stationType || "").toUpperCase();
    if (s > bs || (s === bs && (soft > bsoft || (soft === bsoft && typeOk && !btype)))) { bs = s; bsoft = soft; btype = typeOk; best = c; }
  }
  const tot = bs + bsoft;
  if (best && tot >= Math.max(2, Math.ceil(arts.length * 0.25))) { res.C = best; res.how = "Einträge"; res.hits = tot; }
  return res;
}
function lkStationNr(isp) { for (const x of lkArts(isp)) if (x.station) return wtxt(x.a, "nummer").trim(); return ""; }

/* ---------- Verknüpfungen einer ISP ---------- */
export function lkLinks(D, isp) {
  const cent = lkCentral(D, isp);
  const key = (D.ver || 0) + "|" + cent.key + "|" + LK_VER;
  if (isp._lkl && isp._lkl.key === key) return isp._lkl;
  const res = { key, C: cent.C, cent, arts: new Map(), byPin: new Map(), missing: [], list: [] };
  isp._lkl = res;
  const arts = lkArts(isp);
  res.list = arts.filter(x => !x.station);
  if (!cent.C) { for (const x of res.list) res.arts.set(x.a, { st: "keine", x, alt: [] }); return res; }
  const P = lkPins(cent.C), dec = lkStore(D).art, ik = lkIspKey(isp);
  const taken = new Map();
  const pending = [];
  for (const x of res.list) {
    const d = dec[ik + "|" + x.key] || {};
    x.rej = new Set(d.rej || []);
    if (d.none) { res.arts.set(x.a, { st: "ohne", x, alt: [] }); continue; }
    if (x.info) {
      const pf = P.byKlemme.get(x.info);
      if (pf && !taken.has(pf.p.uid)) {
        const sc = lkScore(x.feat, pf);
        const conflict = !!(x.feat.aks && pf.aks && x.feat.aks !== pf.aks) || (x.feat.kind && pf.kind !== x.feat.kind);
        res.arts.set(x.a, { st: "fest", p: pf.p, score: sc, conflict, x, alt: [] });
        taken.set(pf.p.uid, x.a);
        continue;
      }
      x.infoMissing = !pf;
      x.infoDouble = !!pf;
    }
    pending.push(x);
  }
  /* Kandidaten bewerten, dann gierig vergeben (beste Paare zuerst, jede Klemme einmal) */
  const pairs = [];
  for (const x of pending) {
    const cands = x.feat.aks
      ? P.list.filter(f => f.aks ? lkAksRel(x.feat.segs, f.segs) > 0 : (!x.feat.kind || f.kind === x.feat.kind))
      : P.list.filter(f => !x.feat.kind || f.kind === x.feat.kind);
    const sc = [];
    for (const f of cands) { if (x.rej.has(f.p.klemme)) continue; const s = lkScore(x.feat, f); if (s >= 30) sc.push({ f, s }); }
    sc.sort((u, v) => v.s - u.s || natCmp(u.f.p.klemme, v.f.p.klemme));
    x.cands = sc;
    for (const c of sc) pairs.push({ x, f: c.f, s: c.s });
  }
  pairs.sort((u, v) => v.s - u.s);
  for (const pr of pairs) {
    if (res.arts.has(pr.x.a) || taken.has(pr.f.p.uid)) continue;
    taken.set(pr.f.p.uid, pr.x.a);
    const rivals = pr.x.cands.filter(c => c.f !== pr.f && pr.s - c.s < 8);
    /* mehrere Klemmen desselben Geräts (BSK Auf/Zu, Rauchmelder Alarm/Störung …): Gerät ist sicher */
    const sameDev = rivals.length > 0 && rivals.every(c => c.f.aks && c.f.aks === pr.f.aks) && pr.f.aks && pr.f.aks === pr.x.feat.aks;
    const st = pr.s >= 85 && (!rivals.length || sameDev) ? "sicher" : pr.s >= 60 ? "wahrsch" : "pruefen";
    res.arts.set(pr.x.a, { st, p: pr.f.p, score: pr.s, x: pr.x, alt: pr.x.cands.slice(0, 8), sameDev: sameDev ? rivals.map(c => c.f.p) : null,
      kindBad: !!(pr.x.feat.kind && pr.f.p.kind !== pr.x.feat.kind), renamed: !!(pr.x.feat.aks && pr.f.aks && pr.f.aks !== pr.x.feat.aks) });
  }
  lkByOrder(res, pending, P, taken);
  for (const x of pending) if (!res.arts.has(x.a)) res.arts.set(x.a, { st: "keine", x, alt: (x.cands || []).slice(0, 8) });
  for (const [a, l] of res.arts) if (l.p && !res.byPin.has(l.p.uid)) res.byPin.set(l.p.uid, { a, l });
  /* Klemmen ohne Eintrag: neues Gerät oder weitere Klemme eines dokumentierten Geräts? */
  const docAks = res.list.filter(x => x.feat.aks).map(x => x.feat.segs);
  const linkedAks = new Set([...res.arts.values()].filter(l => l.p).map(l => lkCanon(lkAks(l.p.name))).filter(Boolean));
  res.missing = []; res.missingDev = new Set();
  for (const f of P.list) {
    if (taken.has(f.p.uid)) continue;
    res.missing.push(f.p);
    if (f.aks && (linkedAks.has(f.aks) || docAks.some(s => lkAksRel(s, f.segs) >= 0.75))) res.missingDev.add(f.p.uid);
  }
  return res;
}
/* Reihenfolge-Abgleich für Kopier-Dokus: übrig gebliebene Einträge gleicher Bauart und gleichen
   Textes (z. B. „Zuluft BSK“ BSK29, 31, 33 …) ↔ freie Geräte gleicher Bauart (BSK39, 41, 43 …).
   Nur wenn die Anzahl genau passt – dann der Reihe nach, als Vorschlag zum Prüfen. */
export const lkType = segs => (segs[segs.length - 1].match(/^[A-Z]+/) || [""])[0];
export const lkNum = segs => parseInt((segs[segs.length - 1].match(/\d+$/) || ["0"])[0], 10);
function lkByOrder(res, pending, P, taken) {
  const left = pending.filter(x => !res.arts.has(x.a) && x.feat.aks && lkType(x.feat.segs) && x.feat.words.length);
  const groups = new Map();
  for (const x of left) { const k = lkType(x.feat.segs) + "|" + x.feat.kind + "|" + x.feat.words.join(" "); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  for (const xs of groups.values()) {
    const x0 = xs[0], typ = lkType(x0.feat.segs);
    /* freie Klemmen gleicher Bauart/Signalart/Text, je Gerät die beste */
    const dev = new Map();
    for (const f of P.list) {
      if (!f.aks || taken.has(f.p.uid) || f.kind !== x0.feat.kind || lkType(f.segs) !== typ || x0.rej.has(f.p.klemme)) continue;
      const sim = lkSim(x0.feat.words, f.words); if (sim < 0.75) continue;
      const cur = dev.get(f.aks);
      if (!cur || sim > cur.sim || (sim === cur.sim && natCmp(f.p.klemme, cur.f.p.klemme) < 0)) dev.set(f.aks, { f, sim });
    }
    if (dev.size !== xs.length) continue;
    const ds = [...dev.values()].sort((u, v) => lkNum(u.f.segs) - lkNum(v.f.segs));
    const as = xs.slice().sort((u, v) => lkNum(u.feat.segs) - lkNum(v.feat.segs));
    as.forEach((x, i) => {
      const f = ds[i].f; taken.set(f.p.uid, x.a);
      res.arts.set(x.a, { st: "pruefen", p: f.p, score: 50, x, alt: (x.cands || []).slice(0, 8), byOrder: true, renamed: true, kindBad: false });
    });
  }
}
const lkOpen = l => LK_OPEN.has(l.st) || (l.st === "fest" && l.conflict);
function lkIspStats(L) {
  const dev = L.missingDev ? L.missingDev.size : 0;
  const s = { fest: 0, sicher: 0, wahrsch: 0, pruefen: 0, keine: 0, ohne: 0, conflict: 0, total: L.list.length, missing: L.missing.length - dev, missingDev: dev };
  for (const l of L.arts.values()) { s[l.st]++; if (l.st === "fest" && l.conflict) s.conflict++; }
  s.on = s.fest + s.sicher; s.open = s.wahrsch + s.pruefen + s.keine + s.conflict;
  return s;
}

/* ---------- Schreiben ins Info-Feld (wie beim Erzeugen aus der Sicherung) ---------- */
WX.ORDER.installationClass = ["description", "shortkey", "articleProperties"];
function lkW(C) { return APP.wd[C.cid] || (APP.wd[C.cid] = wdModel(C)); }
function lkInfoText(C, p, mode) {
  if (mode === "klemmewert") { const W = lkW(C); const wp = pinOf(W, p.uid); if (wp) return infoValue({ opt: { info: "klemmewert" } }, wp); }
  return "Klemme " + p.klemme;
}
function lkWriteInfo(a, C, p, mode) {
  const doc = a.ownerDocument;
  let ic = wkid(a, "installationClass");
  if (!ic) { ic = wplace(a, doc.createElementNS(WTG_NS, "installationClass")); wset(ic, "description", "N/V"); wset(ic, "shortkey", "NV"); }
  let pr = artProp(a, "Info");
  if (!pr) {
    pr = doc.createElementNS(WTG_NS, "articleProperties"); ic.appendChild(pr);
    wset(pr, "description", "Info"); wset(pr, "length", "0"); wset(pr, "type", "Text"); wset(pr, "checked", "true");
  }
  const old = wtxt(pr, "value").trim();
  let v = lkInfoText(C, p, mode);
  if (old && !/^Klemme\s/.test(old)) v += " · " + old;   // eigenen Text des Kollegen behalten
  wset(pr, "value", v);
}
function lkClearInfo(a) { const pr = artProp(a, "Info"); if (pr && /^Klemme\s/.test(wtxt(pr, "value").trim())) wset(pr, "value", null); }
function lkInfoMode() { return pref("lkInfoMode", "klemme"); }

/* Eine Entscheidung zu einem Eintrag ändern */
function lkDecide(D, isp, x, patch) {
  const S = lkStore(D), k = lkIspKey(isp) + "|" + x.key;
  const d = Object.assign({}, S.art[k] || {}, patch);
  if (d.rej && !d.rej.length) delete d.rej;
  if (!d.none) delete d.none;
  if (Object.keys(d).length) S.art[k] = d; else delete S.art[k];
  lkSave(D);
}
/* Mehrere Verknüpfungen eintragen (ein Rückgängig-Schritt) */
function lkCommit(D, items) {
  if (!items.length) return 0;
  wSnapshot(D);
  const mode = lkInfoMode();
  for (const it of items) lkWriteInfo(it.a, it.C, it.p, mode);
  wdocChanged(D);
  return items.length;
}

/* ---------- Fehlende Klemme in die Doku aufnehmen ---------- */
/* Raumnummern wie „Z.3.02“, „A.0.43“, „A0.43“ */
const LK_ROOM = /\b([A-Z]{1,2})\.?(\d{1,2})\.(\d{2,3})\b/g;
function lkRooms(s) { const out = new Set(); for (const m of String(s || "").toUpperCase().matchAll(LK_ROOM)) out.add(m[1] + "." + (+m[2]) + "." + m[3]); return out; }
/* In welche Anlage gehört eine Klemme ohne Eintrag? Gründe nach Gewicht:
   100 Raumnummer im Anlagennamen · 80 Raumnummer bei Einträgen der Anlage · 70 gleiches Gerät dort dokumentiert ·
   40–50 gleiche Anlage (AKS) und gleiche Bauart, nächste Nummer · 30 gleiche Anlage (AKS) · ≤ 20 Namens-/AKS-Ähnlichkeit */
function lkFacFor(L, isp, p) {
  const facs = wkids(isp, "facility");
  const pa = lkAks(p.name), segs = pa ? lkCanon(pa).split("_") : null;
  const rooms = lkRooms(p.name);
  const typ = segs ? lkType(segs) : "", num = segs ? lkNum(segs) : 0, plant = segs ? segs.slice(0, -1).join("_") : "";
  const pw = lkFeat(p.name).words;
  const sc = new Map();
  const bump = (fac, v, why) => { const c = sc.get(fac) || { s: 0, n: 0, why: "" }; if (v > c.s) { c.s = v; c.n = 1; c.why = why; } else if (v === c.s && v > 0) c.n++; sc.set(fac, c); };
  for (const fac of facs) {
    const fn = wtxt(fac, "facBezeichnung");
    if (rooms.size && [...lkRooms(fn)].some(r => rooms.has(r))) bump(fac, 100, "Raum im Anlagennamen");
    const ns = lkSim(pw, lkWords(fn)); if (ns >= 0.5) bump(fac, Math.round(20 * ns), "ähnlicher Name");
  }
  for (const [a, l] of L.arts) {
    const fac = a.parentElement;
    if (rooms.size && [artName(a), l.p ? l.p.name : ""].some(n => [...lkRooms(n)].some(r => rooms.has(r)))) bump(fac, 80, "gleicher Raum bei den Einträgen");
    if (!segs) continue;
    const pk = l.p && lkAks(l.p.name);
    for (const q of [l.x.feat.segs, pk ? lkCanon(pk).split("_") : null]) {
      if (!q) continue;
      if (q.length === segs.length && q.every((x, k) => x === segs[k])) { bump(fac, 70, "Gerät dort schon dokumentiert"); continue; }
      if (q.slice(0, -1).join("_") === plant) { if (lkType(q) === typ) bump(fac, 40 + Math.max(0, 10 - Math.abs(lkNum(q) - num)), "Nachbar " + q[q.length - 1]); else bump(fac, 30, "gleiche Anlage (AKS)"); continue; }
      const n = Math.min(segs.length, q.length);
      let k = 0; while (k < n - 1 && segs[k] === q[k]) k++;
      let t = 0; while (t < n - 1 && segs[segs.length - 2 - t] === q[q.length - 2 - t]) t++;
      const v = Math.max(k, t) + (lkType(q) === typ ? 3 : 0);
      if (v >= 3) bump(fac, v, "ähnliches AKS");
    }
  }
  const rank = [...sc.entries()].filter(([, v]) => v.s > 0).sort((x, y) => y[1].s - x[1].s || y[1].n - x[1].n);
  if (rank.length && rank[0][1].s >= 3) {
    const [fac, v] = rank[0], second = rank[1] ? rank[1][1].s : 0;
    return { fac, sure: v.s >= 40 && v.s - second >= 10, why: v.why };
  }
  /* Programm-Anlage gleichen Namens? */
  try {
    const ap = assignPlant(L.C, p);
    const nm = ap && ap.plant ? norm(ap.plant.name) : "";
    const fac = nm && facs.find(f => norm(wtxt(f, "facBezeichnung")) === nm);
    if (fac) return { fac, sure: false, why: "Programm-Anlage" };
  } catch (e) {}
  return { fac: null, sure: false, why: "" };
}
/* Stil der ISP: stehen die AKS-Kennzeichen im Klartext (wie in K&P-Dokus üblich)? */
function lkFullNames(isp) { const xs = lkArts(isp).filter(x => !x.station); return xs.length ? xs.filter(x => x.feat.aks).length / xs.length > 0.5 : false; }
function lkPinText(isp, C, p) {
  if (lkFullNames(isp)) return p.name;
  const wp = pinOf(lkW(C), p.uid);
  return wp && wp.klartext ? wp.klartext : p.name;
}
/* Doku-Eintrag an die Klemme angleichen: Klartext und ggf. Signalart */
function lkAlign(isp, a, C, p) {
  const tag = lkSplitTag(wtxt(a, "artKlartext")).tag;
  let nt = lkPinText(isp, C, p);
  if (tag && !lkWords(nt).some(w => w.startsWith(lkFold(tag)))) nt += " " + tag;   // Zu-/Abluft-Angabe behalten
  wset(a, "artKlartext", nt);
  const cur = LK_KIND[wtxt(a, "nummer").trim()], want = KIND_INFO[p.kind];
  if (cur && want && cur !== p.kind) {
    wset(a, "nummer", want.nummer); wset(a, "artBezeichnung", want.name);
    wset(a, "artLbnr", want.lbnr ? want.nummer : null);
  }
}
function lkAddPin(D, isp, fac, C, p) {
  const W = lkW(C);
  const wp = pinOf(W, p.uid);
  if (!wp) return null;
  const first = lkArts(isp).find(x => wtxt(x.a, "standort"));
  const standort = first ? wtxt(first.a, "standort") : lkIspKey(isp);
  const xml = dpArtikel({ opt: { info: lkInfoMode() }, isp: { bez: standort } }, wp, 1, "");
  const frag = new DOMParser().parseFromString('<r xmlns="' + WTG_NS + '">' + xml + "</r>", "application/xml");
  const el = D.doc.importNode(frag.documentElement.firstElementChild, true);
  /* Prüfaufgaben wie beim Nachbarn gleicher Art (z. B. „Auf Funktion prüfen“) */
  const nr = wtxt(el, "nummer");
  const sib = wkids(fac, "Artikel").find(a => wtxt(a, "nummer") === nr) || lkArts(isp).map(x => x.a).find(a => wtxt(a, "nummer") === nr);
  if (sib && wkids(sib, "job").length) {
    wkids(el, "job").forEach(j => j.remove());
    for (const j of wkids(sib, "job")) {
      const c = j.cloneNode(true);
      for (const n of ["executed", "jobBemerkung", "pruefDatum", "jobMitarbeiter"]) { const k = wkid(c, n); if (k) k.remove(); }
      el.appendChild(c);
    }
  }
  wset(el, "artKlartext", lkPinText(isp, C, p));
  fac.appendChild(el);
  wRenumber(isp);
  return el;
}

/* =========================================================================
   Tab „Verknüpfung“
   ========================================================================= */
export function lkDocStats(D) {
  const t = { isps: 0, ispOk: 0, total: 0, on: 0, fest: 0, sicher: 0, wahrsch: 0, pruefen: 0, keine: 0, ohne: 0, conflict: 0, open: 0, missing: 0 };
  if (!APP.centrals.length) return t;
  for (const { isp } of wIsps(D)) {
    const L = lkLinks(D, isp), s = lkIspStats(L);
    t.isps++; if (L.C) t.ispOk++;
    for (const k of ["total", "on", "fest", "sicher", "wahrsch", "pruefen", "keine", "ohne", "conflict", "open", "missing"]) t[k] += s[k];
  }
  return t;
}
export function lkGoto(D, isp, a) { D.lk = Object.assign(D.lk || {}, { sel: isp, filter: "alle", flash: a }); APP.wdTab = "link"; go("wartung", { tab: "link" }); }

export function wdLinkTab(body, D) {
  const S = D.lk || (D.lk = { sel: null, filter: "offen" });
  const rerender = () => renderAll();
  if (!APP.centrals.length) {
    body.appendChild(h("div", { class: "card", style: { maxWidth: "860px" } }, emptyState("swap", "Erst die Datensicherungen laden",
      "Für die Verknüpfung braucht die Werkbank die Sicherungen der Zentralen. Am einfachsten den ganzen Ordner (oder die ZIP-Datei) mit allen Sicherungen öffnen – welche Station zu welcher ISP gehört, findet die Werkbank selbst heraus.",
      h("div", { class: "row", style: { justifyContent: "center", marginTop: "14px" } }, btn("Ordner öffnen", "folder", () => $("#dirIn").click(), "accent"), btn("Dateien / ZIP öffnen", "file", () => $("#fileIn").click())))));
    return;
  }
  const isps = wIsps(D);
  if (!isps.length) { body.appendChild(h("div", { class: "card" }, emptyState("doc", "Keine ISP im Dokument", ""))); return; }
  const all = isps.map(o => { const L = lkLinks(D, o.isp); return Object.assign({}, o, { L, s: lkIspStats(L) }); });
  if (!S.sel || !D.doc.contains(S.sel)) S.sel = (all.find(o => o.s.open || !o.L.C) || all[0]).isp;
  const T = all.reduce((t, o) => { t.total += o.s.total; t.on += o.s.on; t.fest += o.s.fest; t.sicher += o.s.sicher; t.wahrsch += o.s.wahrsch; t.open += o.s.open; t.missing += o.s.missing; t.keine += o.s.keine; t.ispOk += o.L.C ? 1 : 0; return t; }, { total: 0, on: 0, fest: 0, sicher: 0, wahrsch: 0, open: 0, missing: 0, keine: 0, ispOk: 0 });

  /* Kopf: Zahlen + Sammelaktionen */
  const commitWhere = pred => {
    const items = [];
    for (const o of all) if (o.L.C) for (const [a, l] of o.L.arts) if (l.p && pred(l)) items.push({ a, C: o.L.C, p: l.p });
    const n = lkCommit(D, items);
    toast(n ? n + (n === 1 ? " Verknüpfung" : " Verknüpfungen") + " ins Info-Feld eingetragen." : "Nichts einzutragen.", n ? "ok" : "inf");
    rerender();
  };
  const tile = (n, l, cls) => h("div", { class: "lk-tile" + (cls ? " " + cls : "") }, h("b", null, String(n)), h("span", null, l));
  body.appendChild(h("div", { class: "card", style: { marginBottom: "12px", flexShrink: "0" } },
    h("div", { class: "lk-tiles" },
      tile(T.ispOk + " / " + all.length, "ISP einer Sicherung zugeordnet", T.ispOk < all.length ? "warn" : "ok"),
      tile(T.on + " / " + T.total, "Einträge verknüpft", T.on === T.total ? "ok" : ""),
      tile(T.fest, "davon fest eingetragen"),
      tile(T.open, "offen: prüfen oder ohne Treffer", T.open ? "warn" : "ok"),
      tile(T.missing, "Klemmen ohne Doku-Eintrag", T.missing ? "warn" : "")),
    h("div", { class: "row", style: { marginTop: "12px" } },
      btn("Sichere eintragen (" + T.sicher + ")", "check", () => commitWhere(l => l.st === "sicher"), T.sicher ? "accent" : ""),
      btn("Auch wahrscheinliche (" + T.wahrsch + ")", "check", () => { if (confirm(T.wahrsch + " wahrscheinliche Zuordnungen ungeprüft eintragen?\nBesser vorher in der Liste durchsehen.")) commitWhere(l => l.st === "sicher" || l.st === "wahrsch"); }),
      h("span", { class: "grow" }),
      h("span", { class: "muted small" }, "Ins Info-Feld schreiben:"),
      selectEl([["klemme", "Klemme"], ["klemmewert", "Klemme + Wert"]], lkInfoMode(), v => setPref("lkInfoMode", v), "sm")),
    h("div", { class: "small muted", style: { marginTop: "8px" } },
      "„Eintragen“ schreibt z. B. „Klemme 001/P.03“ in das Info-Feld des Eintrags – wie bei einer aus der Sicherung erzeugten Doku. Sichere Treffer wirken schon vorher (Adressen, Sprünge, Mängel-Vorschläge); eingetragen bleiben sie auch ohne geladene Sicherung erhalten.")));

  /* Leiste + Hauptbereich */
  const split = h("div", { class: "split card tight", style: { minHeight: "420px", alignItems: "stretch" } });
  body.appendChild(split);
  const rail = h("div", { class: "rail", style: { width: "300px" } });
  const main = h("div", { class: "center wd-main", style: { padding: "16px 20px", overflow: "auto" } });
  split.appendChild(rail); split.appendChild(main);
  if (S._last !== S.sel) main.dataset.noRestore = "1";
  S._last = S.sel;
  let lastB = null;
  for (const o of all) {
    if (o.bte !== lastB) { rail.appendChild(h("div", { class: "rail-head" }, icon("station"), " ", wtxt(o.bte, "bteBezeichnung") || "Einbauort")); lastB = o.bte; }
    const dot = !o.L.C ? "err" : o.s.open ? "warn" : "ok";
    rail.appendChild(h("div", { class: "rail-item" + (S.sel === o.isp ? " on" : ""), onclick: () => { S.sel = o.isp; S.flash = null; rerender(); } },
      h("span", { class: "sevdot " + dot }),
      h("div", { class: "lbl" }, h("b", null, lkIspKey(o.isp) || "ISP"),
        h("small", null, o.L.C ? "→ " + o.L.C.meta.name + " · " + o.s.on + "/" + o.s.total + " verknüpft" : "keine Sicherung zugeordnet")),
      o.s.open ? h("span", { class: "badge warn" }, o.s.open) : null));
  }
  lkIspDetail(main, D, all.find(o => o.isp === S.sel), S, rerender);
}

function lkIspDetail(main, D, o, S, rerender) {
  const { isp, L, s } = o;
  const C = L.C;
  /* Zuordnung ISP → Sicherung */
  const man = lkStore(D).isp[lkIspKey(isp)];
  const autoC = man ? lkDetect(D, isp, false).C : C;
  const opts = [["auto", "automatisch" + (autoC ? " (" + autoC.meta.name + ")" : " – nichts erkannt")], ["-", "keine Sicherung"], ...APP.centrals.map(c => [lkCentralKey(c), stationLabel(c)])];
  const sel = selectEl(opts, man ? man : "auto", v => {
    const st = lkStore(D);
    if (v === "auto") delete st.isp[lkIspKey(isp)]; else st.isp[lkIspKey(isp)] = v;
    lkSave(D); rerender();
  }, "sm");
  const how = !C ? (L.cent.how === "manuell keine" ? "bewusst ohne Sicherung" : "Keine passende Sicherung gefunden – bitte auswählen.")
    : L.cent.how === "Einträge" ? "erkannt: " + L.cent.hits + " von " + L.cent.of + " Einträgen finden sich in " + C.meta.name
    : L.cent.how === "Name" ? "über den Namen erkannt" : "von Hand zugeordnet";
  const stNr = lkStationNr(isp);
  const typeWarn = C && stNr && C.meta.stationType && stNr.toUpperCase() !== C.meta.stationType.toUpperCase();
  main.appendChild(h("div", { class: "row", style: { marginBottom: "6px" } },
    h("h2", { style: { margin: 0, font: "600 18px/26px var(--font)" } }, lkIspKey(isp) || "ISP"),
    h("span", { class: "grow" }),
    h("span", { class: "muted small" }, "Sicherung:"), sel));
  main.appendChild(h("div", { class: "small " + (C ? "muted" : ""), style: { marginBottom: typeWarn ? "6px" : "12px", color: C ? null : "var(--err)" } }, how));
  if (typeWarn) main.appendChild(h("div", { class: "infobar warn", style: { marginBottom: "12px" } }, icon("alert"), h("div", null, "Die Doku nennt die Station ", h("b", null, stNr), ", die Sicherung ist eine ", h("b", null, C.meta.stationType), ". Stimmt die Zuordnung?")));
  if (!C) return;

  /* Filter */
  const rows = [...L.arts.entries()].map(([a, l]) => ({ a, l }));
  const F = {
    offen: rows.filter(r => lkOpen(r.l)), alle: rows, ok: rows.filter(r => LK_ON.has(r.l.st) && !r.l.conflict), fehlt: L.missing
  };
  if (!F[S.filter]) S.filter = "offen";
  const seg = h("div", { class: "seg" }, [["offen", "Offen"], ["alle", "Alle"], ["ok", "Verknüpft"], ["fehlt", "Klemmen ohne Eintrag"]].map(([k, l]) =>
    h("button", { class: S.filter === k ? "on" : "", onclick: () => { S.filter = k; rerender(); } }, l + " (" + (k === "fehlt" ? (L.missing.length - L.missingDev.size) + (L.missingDev.size ? " · " + L.missingDev.size + " weitere" : "") : F[k].length) + ")")));
  const ispSure = rows.filter(r => r.l.st === "sicher");
  const ispNone = rows.filter(r => r.l.st === "keine");
  main.appendChild(h("div", { class: "row", style: { marginBottom: "10px" } }, seg, h("span", { class: "grow" }),
    ispNone.length && S.filter !== "fehlt" ? btn("Ohne Treffer → ohne Klemme (" + ispNone.length + ")", "eyeoff", () => {
      if (!confirm(ispNone.length + " Einträge ohne Treffer als „ohne Klemme“ markieren?\nTypisch für Zähler, LAB-Controller und andere Busgeräte. Die Doku selbst wird dabei nicht verändert.")) return;
      const st = lkStore(D);
      for (const r of ispNone) { const k = lkIspKey(isp) + "|" + r.l.x.key; st.art[k] = Object.assign({}, st.art[k] || {}, { none: true }); }
      lkSave(D); rerender();
    }, "sm", "Für Einträge, die keine Klemme an dieser Station haben") : null,
    ispSure.length ? btn("Sichere dieser ISP eintragen (" + ispSure.length + ")", "check", () => { const n = lkCommit(D, ispSure.map(r => ({ a: r.a, C, p: r.l.p }))); toast(n + " eingetragen.", "ok"); rerender(); }, "accent") : null));

  if (S.filter === "fehlt") return lkMissingTable(main, D, isp, L, rerender);
  const list = F[S.filter];
  if (!list.length) { main.appendChild(emptyState("check", S.filter === "offen" ? "Alles zugeordnet" : "Keine Einträge", S.filter === "offen" ? "Für jeden Eintrag dieser ISP gibt es eine sichere oder eingetragene Klemme." : "")); return; }

  const tb = h("tbody");
  const tbl = h("table", { class: "grid lk-t" }, h("thead", null, h("tr", null,
    h("th", null, "Eintrag in der Doku"), h("th", null, "Klemme in der Sicherung"), h("th", null, "Status"), h("th", null, ""))), tb);
  main.appendChild(tbl);
  for (const { a, l } of list) {
    const x = l.x;
    const commit = p => { lkCommit(D, [{ a, C, p }]); if (x.rej.has(p.klemme)) lkDecide(D, isp, x, { rej: [...x.rej].filter(k => k !== p.klemme) }); rerender(); };
    const reject = () => { if (l.st === "fest") { wSnapshot(D); lkClearInfo(a); wdocChanged(D); } lkDecide(D, isp, x, { rej: uniq([...x.rej, l.p.klemme]) }); rerender(); };
    /* Auswahl einer anderen Klemme */
    const P = lkPins(C);
    const cand = (l.alt && l.alt.length ? l.alt : []).filter(c => !l.p || c.f.p !== l.p);
    const pick = h("select", { class: "in sm", style: { maxWidth: "230px" } });
    pick.appendChild(h("option", { value: "" }, l.p ? "andere Klemme …" : "Klemme wählen …"));
    if (cand.length) { const g = h("optgroup", { label: "Vorschläge" }); for (const c of cand) g.appendChild(h("option", { value: c.f.p.klemme }, c.f.p.klemme + " · " + trunc(c.f.p.name, 48) + "  (" + c.s + ")")); pick.appendChild(g); }
    const used = f => L.byPin.has(f.p.uid) && L.byPin.get(f.p.uid).a !== a ? "  (vergeben)" : "";
    const sorted = P.list.slice().sort((u, v) => natCmp(u.p.klemme, v.p.klemme));
    const groups = x.feat.kind ? [["Gleiche Signalart (" + KIND_INFO[x.feat.kind].name + ")", sorted.filter(f => f.kind === x.feat.kind)], ["Andere Signalart", sorted.filter(f => f.kind !== x.feat.kind)]] : [["Alle Klemmen", sorted]];
    for (const [lbl, fs] of groups) { if (!fs.length) continue; const g = h("optgroup", { label: lbl }); for (const f of fs) g.appendChild(h("option", { value: f.p.klemme }, f.p.klemme + " · " + f.kind + " · " + trunc(f.p.name, 44) + used(f))); pick.appendChild(g); }
    pick.addEventListener("change", () => { const f = P.byKlemme.get(pick.value); if (f) commit(f.p); });

    /* Hinweise zur Zuordnung */
    const notes = [];
    if (l.sameDev && l.sameDev.length) notes.push("Gerät hat weitere Klemmen: " + l.sameDev.map(p => p.klemme + " " + trunc((p.name || "").slice((lkAks(p.name) || "").length).trim(), 24)).join(", "));
    if (l.p && x.feat.kind && l.p.kind !== x.feat.kind) notes.push("Doku: " + KIND_INFO[x.feat.kind].name + " – Sicherung: " + (KIND_INFO[l.p.kind] || {}).name);
    if (l.byOrder) notes.push("Nach Reihenfolge zugeordnet – Nummer in der Doku: " + x.feat.segs[x.feat.segs.length - 1] + ", an der Station: " + lkCanon(lkAks(l.p.name)).split("_").pop() + ". Bitte vor Ort prüfen.");
    else if (l.p && x.feat.aks && lkCanon(lkAks(l.p.name)) !== x.feat.aks) notes.push("AKS in der Doku weicht ab: " + lkAks(artName(a)));
    if (l.conflict) notes.push("Im Info-Feld steht diese Klemme, Name oder Signalart passen aber nicht.");
    const canAlign = l.p && (x.feat.kind && l.p.kind !== x.feat.kind || (x.feat.aks && lkCanon(lkAks(l.p.name)) !== x.feat.aks));
    const align = () => { wSnapshot(D); lkAlign(isp, a, C, l.p); lkWriteInfo(a, C, l.p, lkInfoMode()); wdocChanged(D); toast("Eintrag an " + l.p.klemme + " angeglichen und verknüpft.", "ok"); rerender(); };

    const pinCell = l.p
      ? h("td", null, h("a", { class: "klink", title: "In der Datenpunktliste zeigen", onclick: () => jumpToPin(C, l.p) }, icon("jump"), l.p.klemme), " ", kindTag(l.p.kind),
        h("span", { class: "sub" }, l.p.name || "—"),
        notes.map(n => h("span", { class: "sub", style: { color: "var(--warn)" } }, n)))
      : h("td", null, h("span", { class: "muted" }, l.st === "ohne" ? "bewusst ohne Klemme" : "kein passender Name in " + C.meta.name),
        x.infoMissing ? h("span", { class: "sub", style: { color: "var(--warn)" } }, "Info-Feld nennt Klemme " + x.info + " – in der Sicherung nicht belegt.") : null);
    const acts = h("td", { class: "lk-acts" },
      l.p && l.st !== "fest" && !canAlign ? btn("Eintragen", "check", () => commit(l.p), l.st === "sicher" ? "accent sm" : "sm", "„Klemme " + l.p.klemme + "“ ins Info-Feld schreiben") : null,
      canAlign ? btn("Angleichen", "check", align, "sm", "Klartext" + (x.feat.kind && l.p.kind !== x.feat.kind ? " und Signalart" : "") + " aus der Sicherung übernehmen und „Klemme " + l.p.klemme + "“ eintragen") : null,
      canAlign && l.st !== "fest" ? btn(null, "pin", () => commit(l.p), "subtle sm", "Nur verknüpfen, Text der Doku lassen") : null,
      l.p ? btn(null, "close", reject, "subtle sm", l.st === "fest" ? "Verknüpfung lösen und diese Klemme nicht mehr vorschlagen" : "Falscher Vorschlag – nicht mehr vorschlagen") : null,
      l.st !== "ohne" ? pick : null,
      !l.p && l.st !== "ohne" ? btn(null, "eyeoff", () => { lkDecide(D, isp, x, { none: true }); rerender(); }, "subtle sm", "Eintrag hat keine Klemme (z. B. Feldgerät ohne Aufschaltung) – nicht mehr als offen zeigen") : null,
      l.st === "ohne" ? btn("Wieder zuordnen", "left", () => { lkDecide(D, isp, x, { none: false }); rerender(); }, "sm") : null);
    const tr = h("tr", { class: S.flash === a ? "flash" : "" },
      h("td", null, kindTag(x.feat.kind || "frei"), " ", h("a", { class: "klink", style: { fontWeight: 400 }, title: "Im Dokument zeigen", onclick: () => jumpToArt({ f: a.parentElement, a }) }, artName(a)),
        h("span", { class: "sub" }, wtxt(a.parentElement, "facBezeichnung"))),
      pinCell,
      h("td", null, h("span", { class: "pill " + (LK_PILL[l.st] || ""), title: l.score != null ? "Übereinstimmung " + l.score + " von 100" : "" }, l.conflict ? "widersprüchlich" : LK_TXT[l.st])),
      acts);
    tb.appendChild(tr);
  }
  if (S.flash) { const r = tb.querySelector("tr.flash"); if (r) setTimeout(() => r.scrollIntoView({ block: "center" }), 30); S.flash = null; }
}

function lkMissingTable(main, D, isp, L, rerender) {
  const C = L.C;
  if (!L.missing.length) { main.appendChild(emptyState("check", "Keine Klemme fehlt", "Jede belegte Klemme von " + C.meta.name + " hat einen Eintrag in dieser ISP.")); return; }
  const facs = wkids(isp, "facility");
  const byK = (u, v) => natCmp(u.klemme, v.klemme);
  const fresh = L.missing.filter(p => !L.missingDev.has(p.uid)).sort(byK);
  const more = L.missing.filter(p => L.missingDev.has(p.uid)).sort(byK);
  const plan = [];
  const table = list => {
    const tb = h("tbody");
    for (const p of list) {
      const sug = lkFacFor(L, isp, p);
      const fsel = selectEl([["", "– Anlage wählen –"], ...facs.map((f, i) => [String(i), wtxt(f, "facBezeichnung") || "Anlage " + (i + 1)])], sug.fac ? String(facs.indexOf(sug.fac)) : "", () => {}, "sm");
      fsel.style.maxWidth = "240px";
      plan.push({ p, fsel });
      tb.appendChild(h("tr", null,
        h("td", { class: "mono" }, h("a", { class: "klink", onclick: () => jumpToPin(C, p) }, icon("jump"), p.klemme), " ", kindTag(p.kind)),
        h("td", null, p.name || "—"),
        h("td", null, fsel, sug.fac ? h("span", { class: "sub" }, (sug.sure ? "" : "unsicher · ") + sug.why) : null),
        h("td", null, btn("Aufnehmen", "plus", () => {
          const fac = facs[parseInt(fsel.value, 10)]; if (!fac) { toast("Bitte erst die Anlage wählen.", "warn"); return; }
          wSnapshot(D); lkAddPin(D, isp, fac, C, p); wdocChanged(D);
          toast("„" + trunc(p.name, 40) + "“ in „" + wtxt(fac, "facBezeichnung") + "“ aufgenommen.", "ok"); rerender();
        }, "sm"))));
    }
    return h("table", { class: "grid lk-t" }, h("thead", null, h("tr", null, h("th", null, "Klemme"), h("th", null, "Name in der Sicherung"), h("th", null, "In Anlage"), h("th", null, ""))), tb);
  };
  if (fresh.length) {
    main.appendChild(h("h3", { class: "lk-h" }, "Neue Geräte – in der Doku gar nicht vorhanden (" + fresh.length + ")"));
    main.appendChild(h("div", { class: "small muted", style: { marginBottom: "8px" } },
      "Belegte Klemmen von " + C.meta.name + ", deren Gerät (AKS) in dieser ISP nicht vorkommt – z. B. seit der letzten Wartung neu aufgeschaltet oder vom Kollegen vergessen. Vorgeschlagen wird die Anlage, in der die Nachbarn mit gleichem AKS stehen."));
    main.appendChild(table(fresh));
  } else main.appendChild(h("div", { class: "infobar ok", style: { marginBottom: "12px" } }, icon("check"), h("div", null, "Jedes Gerät von " + C.meta.name + " hat mindestens einen Eintrag in der Doku.")));
  if (more.length) {
    const det = h("details", { class: "lk-more", open: LK_OPENDET.has(isp) ? LK_OPENDET.get(isp) : !fresh.length });
    det.addEventListener("toggle", () => S_open(isp, det.open));
    det.appendChild(h("summary", null, "Weitere Klemmen schon dokumentierter Geräte (" + more.length + ")", h("span", { class: "muted small" }, " – z. B. BSK „Zu“, wenn die Doku nur „Auf“ führt. Meist so gewollt.")));
    det.appendChild(table(more));
    main.appendChild(det);
  }
  const ready = () => plan.filter(x => x.fsel.value !== "" && (x.fsel.closest("details") ? x.fsel.closest("details").open : true));
  main.appendChild(h("div", { class: "row", style: { marginTop: "10px" } }, btn("Alle sichtbaren mit gewählter Anlage aufnehmen", "plus", () => {
    const r = ready(); if (!r.length) { toast("Bei keiner sichtbaren Klemme ist eine Anlage gewählt.", "warn"); return; }
    if (!confirm(r.length + " Klemmen als neue Einträge in die Doku aufnehmen?")) return;
    wSnapshot(D);
    for (const x of r) lkAddPin(D, isp, facs[parseInt(x.fsel.value, 10)], C, x.p);
    wdocChanged(D); toast(r.length + " Einträge aufgenommen.", "ok"); rerender();
  })));
}
const LK_OPENDET = new WeakMap();
function S_open(isp, v) { if (v === undefined) return !!LK_OPENDET.get(isp); LK_OPENDET.set(isp, v); }


/* ---------- Reiter „Verknüpfung“ der Wartungsdoku ---------- */
WD_TABS.add({
  id: "link", label: "Verknüpfung", icon: "swap", order: 20, needsDoc: true,
  fill: D => APP.centrals.length > 0 && wIsps(D).length > 0,
  badge: D => { const n = APP.centrals.length ? lkDocStats(D).open : 0; return n ? { n, cls: "warn", title: n + " Einträge offen" } : null; },
  render: (body, D) => wdLinkTab(body, D)
});
