import { natCmp, norm } from "../core/util.js";
import { edgesIn, edgesOut, pinOf } from "../model/model.js";
import { groupIsSystem } from "../views/program.js";
import { applyGroups, autoGroup, dominantPrefix } from "./generator.js";

/* =========================================================================
   Anlagen-Zuordnung für die Wartungsdoku
   Jede Klemme wird der Anlage zugeordnet, an der sie im Programm hängt.
   Unverknüpfte Klemmen werden über ihren Namen einer Anlage zugeordnet.
   ========================================================================= */
const GENERIC_WORDS = new Set(("temperatur temp fuehler raumfuehler raumtemp raumtemperatur betrieb betr betriebsmeldung stoerung stoer stoermeldung ansteuern anst ansteuerung " +
  "anforderung anf freigabe freig meldung meld meldungen sollwert soll istwert wert ventil regelventil stellventil pumpe zuluft zulu abluft ablu fortluft fort " +
  "aussenluft aussen umluft vorlauf ruecklauf vl rl raum feuchte rf druck diff differenzdruck min max auf zu stufe eg kg og ug dg res reserve und u des der die das " +
  "mit von fuer im in am an kl x3 ausgeloest waechter druckwaechter stroemungswaechter regelung steuerung gruppe anlage allgemein klappe klappen filter " +
  "rep schal schalter reparaturschalter hand auto ein aus lampe sm bm sb ssm signal prim sek primaer sekundaer ext extern intern grad c k v ma " +
  "eingang ausgang analog binaer kontakt neue neu alt sonstige weitere ansteuern sammelstoermeldung entriegeln quittieren quittierung frostschutz " +
  "anzeige zustand status ueberwachung wartung ok nicht keine").split(" "));

function deUml(s) { return String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss"); }
/* Merkmale eines Namens: bedeutungstragende Wörter und Wort+Nummer ("psr#1") */
function nameFeatures(s) {
  const raw = deUml(s).replace(/(\d)\s*[-+\/]\s*(\d)/g, "$1 $2").split(/[^a-z0-9°]+/).flatMap(t => t.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/)).filter(Boolean);
  const alpha = new Set(), comp = new Set();
  let last = null;
  for (const t of raw) {
    if (/^\d+$/.test(t)) { if (last) comp.add(last + "#" + parseInt(t, 10)); continue; }
    if (t.length < 2 || GENERIC_WORDS.has(t) || /^\d/.test(t)) { if (!GENERIC_WORDS.has(t)) last = null; continue; }
    alpha.add(t); last = t;
  }
  return { alpha, comp };
}
const pfx = (a, b) => a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
function nameScore(P, Q) {
  /* je Wort der Klemme der beste Treffer in der Anlage – jedes Wort zählt nur einmal */
  let s = 0, hits = 0, conflict = false, strong = false;
  for (const p of P.alpha) {
    if (Q.alpha.has(p)) { s += 1; hits++; if (p.length >= 6) strong = true; }
    else if ([...Q.alpha].some(q => pfx(p, q))) { s += 0.6; hits++; }
  }
  const qBases = new Map();
  for (const q of Q.comp) { const [b, n] = q.split("#"); if (!qBases.has(b)) qBases.set(b, new Set()); qBases.get(b).add(n); }
  const pBases = new Map();
  for (const p of P.comp) { const [b, n] = p.split("#"); if (!pBases.has(b)) pBases.set(b, new Set()); pBases.get(b).add(n); }
  for (const [b, ns] of pBases) {
    const qb = qBases.get(b) || [...qBases.keys()].filter(x => pfx(x, b)).map(x => qBases.get(x))[0];
    if (!qb) continue;
    if ([...ns].some(n => qb.has(n))) { s += 1.5; strong = true; }
    else { s -= 2.5; conflict = true; }
  }
  return { s, hits, conflict, strong };
}

/* Anlagen des Programms */
function plantsOf(C) {
  if (C._plants) return C._plants;
  const plants = new Map();
  for (const g of C.groups.values()) {
    if (g.isPinGroup || g.ghostGroup || g.foreign || !g.nodes.length) continue;
    if (groupIsSystem(C, g)) continue;
    let key, name, generic = false, collector = false;
    if (C.format === "DDC3000") {
      if (g.key === "0/logik") { key = g.key; name = "Grundgerät"; generic = true; }
      else {
        const k = (C.d3kreise || new Map()).get(parseInt(g.key, 10)) || {};
        key = g.key; name = (k.name || "").trim() || ("Kreis " + g.key);
        if (/^(SBM|FBM)/i.test(k.typ || "")) collector = true;
      }
    } else {
      key = g.mod + "/" + g.plant; name = (g.plantName || "").trim() || ("Anlage " + g.plant);
    }
    if (!plants.has(key)) plants.set(key, { key, name, generic, collector, groups: new Map(), order: key });
    const P = plants.get(key);
    const gname = C.format === "DDC3000" ? "" : (g.groupName || "").trim();
    P.groups.set(g.key, { key: g.key, name: gname, collector: collector || /sammel|ssm|st(ö|oe)rmeld|lampen?\b|meldungen/i.test(gname), feat: nameFeatures(name + " " + gname) });
  }
  for (const P of plants.values()) P.feat = nameFeatures(P.name);
  C._plants = plants;
  return plants;
}
export function plantOfNode(C, n) {
  if (!n || n.isPin || n.ghost) return null;
  const plants = plantsOf(C);
  for (const P of plants.values()) if (P.groups.has(n.gKey)) return { P, G: P.groups.get(n.gKey) };
  return null;
}

/* Zuordnung einer Klemme */
export function assignPlant(C, pin) {
  const plants = plantsOf(C);
  const PF = nameFeatures(pin.name || pin.paraText || "");
  const score = new Map();   // key -> {P, s, g: Map(gKey -> s)}
  const bump = (P, G, w) => {
    if (!score.has(P.key)) score.set(P.key, { P, s: 0, conn: 0, g: new Map() });
    const x = score.get(P.key); x.s += w; x.conn += w;
    if (G) x.g.set(G.key, (x.g.get(G.key) || 0) + w);
  };
  const neigh = [...pin.sources.map(e => e.from), ...pin.consumers.map(e => e.to)];
  for (const id of neigh) {
    const n = C.nodes.get(id);
    const hit = plantOfNode(C, n);
    if (!hit) continue;
    if (hit.P.generic) {
      /* Logik im Grundgerät: weiterverfolgen, wohin das Signal führt */
      const seen = new Set([id]); let front = [id];
      for (let d = 1; d <= 3 && front.length; d++) {
        const next = [];
        for (const fid of front) for (const e of [...edgesOut(C, fid), ...edgesIn(C, fid)]) {
          const o = e.from === fid ? e.to : e.from;
          if (seen.has(o)) continue; seen.add(o);
          const on = C.nodes.get(o); if (!on || on.isPin) continue;
          const h2 = plantOfNode(C, on);
          if (h2 && !h2.P.generic) bump(h2.P, h2.G, (h2.G.collector || h2.P.collector ? 0.15 : 0.5) / d);
          else next.push(o);
        }
        front = next;
      }
      bump(hit.P, hit.G, 0.1);
      continue;
    }
    bump(hit.P, hit.G, hit.G.collector || hit.P.collector ? 0.35 : 1);
  }
  /* Namensähnlichkeit: entscheidet mit, wenn die Bezeichnung eindeutig auf eine Anlage zeigt */
  for (const x of score.values()) x.s = Math.min(x.s, 2);
  for (const P of plants.values()) {
    let best = nameScore(PF, P.feat), bestG = null;
    for (const G of P.groups.values()) { const r = nameScore(PF, G.feat); if (r.s > best.s) { best = r; bestG = G; } }
    const connected = score.has(P.key);
    if (connected) { const x = score.get(P.key); x.s += best.s; if (bestG) x.g.set(bestG.key, (x.g.get(bestG.key) || 0) + Math.max(0, best.s)); }
    else if (best.hits && !best.conflict && (best.s >= 1.2 || (best.s >= 1 && best.strong)) && !P.generic && !P.collector) {
      score.set(P.key, { P, s: best.s, conn: 0, g: new Map(bestG ? [[bestG.key, best.s]] : []) });
    }
  }
  let win = null, second = null;
  for (const x of score.values()) { if (!win || x.s > win.s) { second = win; win = x; } else if (!second || x.s > second.s) second = x; }
  if (!win || win.s < 0.3) return { plant: null, how: "", group: null };
  /* gleich stark an mehrere Anlagen verteilt (z. B. Außentemperatur) → Allgemein */
  if (second && win.conn > 0 && second.conn > 0 && win.s - second.s < 0.5 && !win.P.collector && !second.P.collector) return { plant: null, how: "Programm", group: null, shared: true };
  const how = win.conn > 0 ? "Programm" : "Name";
  let gk = null, gs = -1;
  for (const [k, v] of win.g) if (v > gs) { gs = v; gk = k; }
  if (!gk) gk = [...win.P.groups.keys()][0];
  return { plant: win.P, group: win.P.groups.get(gk), how };
}

const ALLG_RE = /ssm|sammelst|entriegel|quittier|phasen|ueberspann|steuersicherung|not ?aus|brandschutz|brandmeld|netzausfall|aussentemp|aussenfuehler|koppelrelais/;
/* Gruppen nach Anlagen bilden */
export function regroupPlants(W, C, splitAt) {
  const plants = plantsOf(C);
  const byPlant = new Map();
  const rest = [], allg = [];
  for (const p of W.pins) {
    p.plant = p.plantName = p.pgroup = p.pgroupName = null; p.how = "";
    if (!p.include) continue;
    const cp = pinOf(C, p.uid);
    const a = cp ? assignPlant(C, cp) : { plant: null };
    if (a.shared || (a.plant && a.plant.collector && C.format === "DDC3000") || (!a.plant && ALLG_RE.test(deUml(p.name)))) { allg.push(p); continue; }
    if (!a.plant || (a.plant.generic && C.format === "DDC3000") || a.plant.collector && a.how !== "Programm") { rest.push(p); continue; }
    p.plant = a.plant.key; p.plantName = a.plant.name; p.pgroup = a.group ? a.group.key : null; p.pgroupName = a.group ? a.group.name : ""; p.how = a.how;
    if (!byPlant.has(a.plant.key)) byPlant.set(a.plant.key, []);
    byPlant.get(a.plant.key).push(p);
  }
  const list = [];
  const order = [...plants.keys()];
  const real = order.filter(k => byPlant.has(k));
  /* Station mit nur einer Anlage: alles dorthin */
  if (real.length === 1) { byPlant.get(real[0]).push(...rest.splice(0), ...allg.splice(0)); byPlant.get(real[0]).sort((a, b) => natCmp(a.klemme, b.klemme)); }
  const allgKey = order.find(k => /^allgemein$/i.test(plants.get(k).name));
  if (allg.length) { if (allgKey) { (byPlant.get(allgKey) || byPlant.set(allgKey, []).get(allgKey)).push(...allg); byPlant.get(allgKey).sort((a, b) => natCmp(a.klemme, b.klemme)); } else list.push({ name: "Allgemein", pins: allg }); }
  for (const key of order) {
    const pins = byPlant.get(key); if (!pins || !pins.length) continue;
    const P = plants.get(key);
    if (splitAt && pins.length > splitAt && P.groups.size > 1) {
      const sub = new Map();
      for (const p of pins) { const k = p.pgroup || "-"; if (!sub.has(k)) sub.set(k, []); sub.get(k).push(p); }
      for (const [gk, sp] of [...sub].sort((a, b) => natCmp(a[0], b[0]))) {
        const gn = (P.groups.get(gk) || {}).name;
        list.push({ name: gn && norm(gn) !== norm(P.name) ? P.name + " – " + gn : P.name, pins: sp });
      }
    } else list.push({ name: P.name, pins });
  }
  /* Rest: über die bedeutungstragenden Wörter des Namens */
  if (rest.length) {
    for (const g of nameGroups(rest, W.opt.grpMax || 12)) list.push(g);
  }
  /* gleiche Namen zusammenlegen */
  const merged = [];
  for (const g of list) { const m = merged.find(x => x.name === g.name); if (m) m.pins.push(...g.pins); else merged.push(g); }
  applyGroups(W, merged);
}
/* Namensbasiert, aber ohne Allerweltswörter vorne ("Vorlauf", "Zuluft" …) */
export function nameGroups(pins, maxSize) {
  const keyed = pins.map(p => {
    const words = String(p.name || "").split(/\s+/).filter(Boolean);
    const sig = words.filter(w => { const f = nameFeatures(w); return f.alpha.size > 0; });
    return { p, key: sig.join(" ") };
  });
  const fake = keyed.map(k => ({ name: k.key, _p: k.p }));
  const groups = autoGroup(fake, maxSize, dominantPrefix(fake.filter(x => x.name).map(x => x.name)));
  return groups.map(g => ({ name: !g.name || g.name === "Ohne Bezeichnung" || !nameFeatures(g.name).alpha.size ? "Weitere Datenpunkte" : g.name, pins: g.pins.map(x => x._p) }));
}

