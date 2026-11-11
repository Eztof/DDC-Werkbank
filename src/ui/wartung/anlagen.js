import { natCmp, norm } from "../core/util.js";
import { edgesIn, edgesOut, pinOf } from "../model/model.js";
import { groupIsSystem } from "../views/program.js";
import { applyGroups } from "./generator.js";

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
/* Wort+Nummer-Merkmale nach Wortstamm gruppiert (einmal je Merkmalsatz berechnet) */
function basesOf(F) {
  if (F._bases) return F._bases;
  const m = new Map();
  for (const q of F.comp) { const [b, n] = q.split("#"); if (!m.has(b)) m.set(b, new Set()); m.get(b).add(n); }
  F._alphaArr = [...F.alpha];
  return (F._bases = m);
}
function nameScore(P, Q) {
  /* je Wort der Klemme der beste Treffer in der Anlage – jedes Wort zählt nur einmal */
  let s = 0, hits = 0, conflict = false, strong = false;
  const qBases = basesOf(Q), pBases = basesOf(P), qArr = Q._alphaArr;
  for (const p of P.alpha) {
    if (Q.alpha.has(p)) { s += 1; hits++; if (p.length >= 6) strong = true; }
    else if (p.length >= 4 && qArr.some(q => pfx(p, q))) { s += 0.6; hits++; }
  }
  if (pBases.size && qBases.size) for (const [b, ns] of pBases) {
    let qb = qBases.get(b);
    if (!qb) for (const [x, v] of qBases) if (pfx(x, b)) { qb = v; break; }
    if (!qb) continue;
    let any = false; for (const n of ns) if (qb.has(n)) { any = true; break; }
    if (any) { s += 1.5; strong = true; }
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
  /* Gruppe → Anlage, für plantOfNode */
  plants.byGroup = new Map();
  for (const P of plants.values()) for (const G of P.groups.values()) if (!plants.byGroup.has(G.key)) plants.byGroup.set(G.key, { P, G });
  C._plants = plants;
  return plants;
}
export function plantOfNode(C, n) {
  if (!n || n.isPin || n.ghost) return null;
  return plantsOf(C).byGroup.get(n.gKey) || null;
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


/* =========================================================================
   Objekt-Schlüssel: der Teil eines Klemmennamens, der Anlage/Bauteil benennt.
   "Altbau Hzg. BT.C KG.+ DG. Temp. Rücklauf" → altbau hzg bt c kg dg
   Abgeschnitten wird am ersten Signalwort (Temp., Betrieb, Störung, Ventil …).
   ========================================================================= */
const SIG = new Set(("temp temperatur fuehler ventil pumpe betrieb betr stoerung stoer ansteuern anst ansteuerung anforderung anf freigabe freig " +
  "meldung meld sollwert soll istwert ist wert kontakt taster schalter ein aus auf zu stufe alarm signal stellsignal stellgroesse regelgroesse " +
  "druck impuls impulse vorlauf ruecklauf vl rl vorl rueckl sek prim primaer sekundaer min max ueberw ueberwachung sm bm sb ssm hand auto " +
  "quittierung quittieren entriegeln reset rm warnung wassermangel stb stw not oben unten aktuell gesamt fern rueckmeldung").split(" "));
const SIG_START = ["temp", "betrieb", "stoer", "freig", "anford", "sollw", "istw", "quitt", "entrieg", "rueckmeld", "stell"];
const SIG_END = ["pumpe", "ventil", "fuehler", "kontakt", "taster", "schalter", "waechter", "melder", "meldung", "signal", "impuls", "druck", "temperatur", "anf", "stoerung", "betrieb"];
function isSig(t) {
  if (SIG.has(t)) return true;
  if (!/^[a-z]/.test(t)) return false;
  for (const s of SIG_START) if (t.length > s.length && t.startsWith(s)) return true;
  for (const s of SIG_END) if (t.length >= s.length + 3 && t.endsWith(s)) return true;
  return false;
}
const meaningful = t => t.length >= 3 && /^[a-z]/.test(t) && !GENERIC_WORDS.has(t) && !isSig(t);
/* Wortfamilien, die dieselbe Anlage meinen ("Fernw.", "Fernpumpe BT-D", "Fernltg." → Fernwärme) */
const FAMILY = [[/^fern(w|ltg|leit|pump|heiz)/, "fernwaerme"]];
function nameTokens(s) {
  const out = [];
  for (const m of String(s || "").matchAll(/([A-Za-zÄÖÜäöüß]+)(\.)?|(\d+)/g)) {
    if (m[3]) out.push({ t: String(parseInt(m[3], 10)), i: m.index, e: m.index + m[0].length, num: true });
    else {
      /* Teil eines Kennzeichens ("ZU52", "_ZA_") ist nie ein Signalwort */
      const s0 = String(s), e = m.index + m[1].length;
      const code = /\d/.test(s0[e] || "") || s0[m.index - 1] === "_" || s0[e] === "_";
      let t = deUml(m[1]), fam = false;
      for (const [re, w] of FAMILY) if (re.test(t)) { t = w; fam = true; break; }
      out.push({ t, i: m.index, e: m.index + m[0].length, ab: !!m[2] && !fam, code, fam });
    }
  }
  return out;
}
/* trägt ein Schlüsselteil genug Bedeutung? (ein sprechendes Wort oder mind. 2 Teile mit Buchstaben) */
function validPart(toks) {
  if (!toks.length || !toks.some(x => !x.num && x.t.length >= 2)) return false;
  return toks.length >= 2 || meaningful(toks[0].t);
}
export function objKey(name) {
  const tk = nameTokens(name);
  /* führende reine Signalwörter überspringen ("Anf.Soll Fernw."), ein Gerätewort vorne bleibt ("Anf.Fernpumpe BT-D") */
  const pure = x => !x.code && (SIG.has(x.t) || SIG_START.some(s => x.t.length > s.length && x.t.startsWith(s)));
  const sig = x => !x.code && isSig(x.t);
  let i = 0; while (i < tk.length && pure(tk[i])) i++;
  let j = i < tk.length && sig(tk[i]) ? i + 1 : i;
  while (j < tk.length && !sig(tk[j])) { j++; if (tk[j - 1].fam) break; }   /* "Fernpumpe BT-D" = Fernwärme */
  const toks = tk.slice(i, j);
  if (!validPart(toks)) return null;
  return { name: String(name), toks };
}
const keyText = (K, L) => K.name.slice(K.toks[0].i, K.toks[(L || K.toks.length) - 1].e).replace(/\s+/g, " ").trim();
/* nicht mitten in einem Kürzel abschneiden ("…_ZA_55_SEN|02" → "…_ZA_55") */
function cleanLen(K, L) {
  while (L > 1 && /[A-Za-z0-9ÄÖÜäöüß]/.test(K.name[K.toks[L - 1].e] || "")) L--;
  return L;
}
function editDist1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
/* Schreibvarianten vereinheitlichen: Abkürzungen ("Kesselanl." → kesselanlage), Tippfehler ("Kücke" → kueche) */
function canonizer(keys) {
  const cnt = new Map();
  for (const K of keys) for (const x of K.toks) if (!x.num) cnt.set(x.t, (cnt.get(x.t) || 0) + 1);
  const words = [...cnt.keys()];
  const abbr = new Map(), typo = new Map();
  for (const w of words) {
    if (w.length >= 4) {
      let best = null;
      for (const u of words) if (u.length > w.length && u.startsWith(w) && (!best || cnt.get(u) > cnt.get(best))) best = u;
      if (best) abbr.set(w, best);
    }
    if (w.length >= 5) {
      let best = null;
      for (const u of words) if (u !== w && u.length >= 5 && cnt.get(u) > cnt.get(w) && editDist1(u, w) && (!best || cnt.get(u) > cnt.get(best))) best = u;
      if (best) typo.set(w, best);
    }
  }
  return K => {
    if (!K) return null;
    if (!K.k) K.k = K.toks.map(x => x.num ? x.t : (x.ab && abbr.get(x.t)) || typo.get(x.t) || x.t);
    return K;
  };
}
/* Verwandtschaft zweier Schlüssel: einer ist Anfang (oder Ende) des anderen */
function keyRel(A, B) {
  const a = A.k, b = B.k, n = Math.min(a.length, b.length);
  if (!n) return 0;
  let p = 0; while (p < n && a[p] === b[p]) p++;
  const short = a.length <= b.length ? A : B;
  if (p === n) return validPart(short.toks) ? n : 0;
  let s = 0; while (s < n && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  if (s === n && short.k.some(meaningful)) return n - 0.5;
  return 0;
}
/* Wortteil-Treffer, auch in zusammengesetzten Wörtern ("Gaskessel" ~ "Kessel") */
function wordHit(w, v) {
  if (w === v) return true;
  if (w.length < 5 || v.length < 5) return false;
  return w.endsWith(v) || v.endsWith(w) || w.startsWith(v) || v.startsWith(w);
}
/* gemeinsamer Anfang bei Kennzeichen ("ICB_51_D451_RLT_ZAA57_BSK04" ~ "ICB_51_D451_RLT_ZAA57_VEH01"):
   mind. 3 Teile und mind. die Hälfte des Schlüssels */
function lcpRel(A, B) {
  const a = A.k, b = B.k, n = Math.min(a.length, b.length);
  let p = 0; while (p < n && a[p] === b[p]) p++;
  if (p < 3 || p < a.length / 2 || !validPart(A.toks.slice(0, p))) return 0;
  return p - 0.25;
}
/* eindeutig beste Anlage für einen Schlüssel; bei Gleichstand entscheidet das Ende des Namens
   ("…_MEL03 Raum Z.3.01" → Besprechungsraum Z.3.01, nicht Z.3.02) */
function bestPlant(K, plantKeys) {
  const sc = [];
  for (const [P, keys] of plantKeys) {
    let s = 0;
    for (const M of keys) { const r = Math.max(keyRel(K, M), lcpRel(K, M)); if (r > s) s = r; }
    if (s > 0) sc.push({ P, keys, s });
  }
  if (!sc.length) return null;
  const top = Math.max(...sc.map(x => x.s));
  const tied = sc.filter(x => x.s === top);
  if (tied.length === 1) return tied[0].P;
  if (top % 1 !== 0.75) return null;                 /* nur bei Kennzeichen-Treffern nachschärfen */
  const tail = new Set(K.k.slice(Math.floor(top)).filter(meaningful));
  for (const x of tied) {
    let suf = 0, hit = 0;
    for (const M of x.keys) {
      let q = 0; while (q < K.k.length && q < M.k.length && K.k[K.k.length - 1 - q] === M.k[M.k.length - 1 - q]) q++;
      if (q > suf && K.k.slice(K.k.length - q).some(w => /^[a-z]/.test(w))) suf = q;
    }
    const v = new Set(x.keys.flatMap(M => M.k));
    for (const w of tail) if (v.has(w)) hit++;
    x.t = 2 * suf + hit;
  }
  tied.sort((a, b) => b.t - a.t);
  return tied[0].t > 0 && tied[0].t > tied[1].t ? tied[0].P : null;
}

const ALLG_RE = /ssm|sammelst|entriegel|quittier|phasen|ueberspann|steuersicherung|steuerspann|schaltschr|not ?aus|brandschutz|brandmeld|netzausfall|aussentemp|aussenfuehler|koppelrelais/;
const GENERIC_PLANT = /^(festwert|heizung|lueftung|kaelte|kreis|regelkreis|rk|anlage|allgemein|sonstiges?|frei|reserve)$/;
/* Gruppen nach Anlagen bilden */
export function regroupPlants(W, C, splitAt) {
  const plants = plantsOf(C);
  const d3 = C.format === "DDC3000";
  const byPlant = new Map();
  const rest = [], allg = [];
  const keyOf = new Map();
  for (const p of W.pins) {
    p.plant = p.plantName = p.pgroup = p.pgroupName = null; p.how = "";
    if (!p.include) continue;
    keyOf.set(p, objKey(p.name));
  }
  const canon = canonizer([...keyOf.values(), ...[...plants.values()].map(P => objKey(P.name))].filter(Boolean));
  for (const K of keyOf.values()) canon(K);
  const put = (p, P, how, G) => {
    p.plant = P.key; p.plantName = P.name; p.pgroup = G ? G.key : null; p.pgroupName = G ? G.name : ""; p.how = how;
    if (!byPlant.has(P.key)) byPlant.set(P.key, []);
    byPlant.get(P.key).push(p);
  };
  for (const p of W.pins) {
    if (!p.include) continue;
    const cp = pinOf(C, p.uid);
    const a = cp ? assignPlant(C, cp) : { plant: null };
    const allgName = ALLG_RE.test(deUml(p.name));
    /* von mehreren Anlagen gleich stark genutzt: Allgemein (DDC3000 ohne typischen Allgemein-Namen: nach Namen einordnen) */
    if (a.shared) { if (d3 && !allgName) rest.push(p); else { p.how = "geteilt"; allg.push(p); } continue; }
    /* DDC3000-Sammelmodule (SBM/FBM) sind keine Anlage: über den Namen einordnen */
    if (a.plant && a.plant.collector && (d3 || a.how !== "Programm")) { (allgName ? allg : rest).push(p); continue; }
    if (!a.plant || (a.plant.generic && d3)) { (allgName ? allg : rest).push(p); continue; }
    put(p, a.plant, a.how, a.group);
  }
  /* DDC3000-Regelkreise: Name passt nicht zu den Klemmen ("FESTWERT", "Kreis Z1", "Fernwärme Sollwert" mit Kessel-Klemmen)
     → nach den Klemmen benennen oder auflösen */
  const disp = new Map();
  for (const P of plants.values()) {
    const PK = canon(objKey(P.name));
    if (PK) { const t0 = nameTokens(P.name); const i = t0.findIndex(x => !isSig(x.t)); disp.set(P.key, i > 0 ? P.name.slice(t0[i].i).trim() : P.name); }
    if (!d3 || P.generic || !byPlant.has(P.key)) continue;
    const pins = byPlant.get(P.key), named = pins.filter(p => keyOf.get(p));
    if (!named.length) continue;
    const nt = PK ? PK.k.filter(meaningful) : [];
    const generic = !PK || (!nt.length && GENERIC_PLANT.test(PK.k[0])) || (nt.length === 1 && GENERIC_PLANT.test(nt[0]));
    if (!generic) {
      if (!nt.length) continue;                       /* "Raum A002": nichts zu prüfen */
      const fit = named.filter(p => keyOf.get(p).k.some(w => nt.some(v => wordHit(w, v)))).length;
      if (fit / named.length >= 0.34) continue;
    }
    /* längster Schlüsselanfang, den ≥ 60 % der benannten Klemmen teilen */
    let dom = null;
    const need = Math.max(1, Math.ceil(named.length * 0.6));
    for (const p of named) {
      const K = keyOf.get(p);
      for (let L = K.k.length; L >= 1; L--) {
        if (dom && L <= dom.L) break;
        const pre = K.k.slice(0, L);
        if (!validPart(K.toks.slice(0, L)) || !pre.some(meaningful)) continue;
        const n = named.filter(q => { const k = keyOf.get(q).k; return k.length >= L && pre.every((w, i) => k[i] === w); }).length;
        if (n >= need) { dom = { L, K }; break; }
      }
    }
    if (dom) { disp.set(P.key, keyText(dom.K, cleanLen(dom.K, dom.L))); continue; }
    byPlant.delete(P.key);
    for (const p of pins) { p.plant = p.plantName = p.pgroup = p.pgroupName = null; p.how = ""; rest.push(p); }
  }
  /* Schlüssel je Anlage: Anlagenname + per Programm zugeordnete Klemmen */
  const plantKeys = new Map();
  for (const [key, pins] of byPlant) {
    const P = plants.get(key), ks = [];
    const PK = canon(objKey(disp.get(key) || P.name));
    if (PK && !(PK.k.length === 1 && GENERIC_PLANT.test(PK.k[0]))) ks.push(PK);
    for (const p of pins) if (p.how === "Programm" && keyOf.get(p)) ks.push(keyOf.get(p));
    plantKeys.set(P, ks);
  }
  const take = (arr, p) => { const i = arr.indexOf(p); if (i >= 0) arr.splice(i, 1); };
  /* Wortschatz je Anlage; Wörter in mehreren Anlagen (Ortsangaben wie "Altbau") unterscheiden nicht */
  const vocab = new Map(), seen = new Map();
  for (const [P, ks] of plantKeys) {
    const v = new Set(); for (const M of ks) for (const w of M.k) v.add(w);
    vocab.set(P, { v, ks });
    for (const w of v) if (meaningful(w)) seen.set(w, (seen.get(w) || 0) + 1);
  }
  const numClash = (K, ks, skip) => K.k.some((w, i) => i !== skip && /^\d+$/.test(K.k[i + 1] || "") && meaningful(w) &&
    ks.some(M => M.k.some((x, j) => x === w && /^\d+$/.test(M.k[j + 1] || "") && M.k[j + 1] !== K.k[i + 1])) &&
    !ks.some(M => M.k.some((x, j) => x === w && M.k[j + 1] === K.k[i + 1])));
  const headHit = (w, v) => w === v || (Math.min(w.length, v.length) >= 5 && (w.startsWith(v) || v.startsWith(w))) ||
    (Math.min(w.length, v.length) >= 6 && (w.endsWith(v) || v.endsWith(w)));
  const distinct = w => meaningful(w) && (seen.get(w) || 0) < 2;
  /* nur über den Namen zugeordnete Klemmen: gibt es eine eindeutig passendere Anlage? */
  for (const [key, pins] of [...byPlant]) for (const p of [...pins]) {
    if (p.how !== "Name" || !keyOf.get(p)) continue;
    const P = bestPlant(keyOf.get(p), plantKeys);
    if (P && P.key !== key) { take(pins, p); put(p, P, "Name", null); }
  }
  /* Rest: gleiche Bezeichnung wie Klemmen einer Anlage ("… Temp. Rücklauf" zu "… Temp. Vorlauf") */
  for (const p of [...rest]) {
    const K = keyOf.get(p); if (!K) continue;
    const P = bestPlant(K, plantKeys);
    if (P) { take(rest, p); put(p, P, "Name", null); }
  }
  /* Rest: das erste unterscheidende Wort zeigt eindeutig auf eine Anlage
     ("BR DT Brennwertkessel Umgehung" → Kessel, "BR DT Kesselanl. BHKW Leistungsanf." → Kessel, nicht BHKW) */
  const general = new Set();
  const compound = (w, v) => Math.min(v.length, w.length) >= 3 && Math.abs(v.length - w.length) >= 3 && (v.startsWith(w) || w.startsWith(v));
  const firstHit = K => {
    if (K.toks.some(x => x.code)) return null;   /* Kennzeichen (ICB_46_…) laufen über bestPlant */
    const i = K.k.findIndex(distinct); if (i < 0) return null;
    const w = K.k[i];
    const hits = [...vocab].filter(([, x]) => [...x.v].some(v => distinct(v) && headHit(w, v)));
    return hits.length === 1 ? { i, w, P: hits[0][0], x: hits[0][1] } : null;
  };
  const cand = new Map(); for (const p of rest) { const K = keyOf.get(p); if (K) cand.set(p, firstHit(K)); }
  const tailKey = (A, B) => B.k.length < A.k.length && B.k.every((w, j) => w === A.k[A.k.length - B.k.length + j]) && B.k.some(meaningful);
  for (const p of [...rest]) {
    const K = keyOf.get(p), c = cand.get(p); if (!c) continue;
    const { i, w, P, x } = c;
    /* andere freie Klemmen sprechen für ein eigenes Objekt: "Öl Leckanlage" neben "Öltank 1/2",
       "Kesselanl. Fernpumpe BT.D" neben "Fernpumpe BT-D" */
    const rival = rest.some(q => {
      if (q === p) return false;
      const Q = keyOf.get(q); if (!Q) return false;
      const cq = cand.get(q); if (cq && cq.P === P) return false;
      return tailKey(K, Q) || Q.k.some(v => meaningful(v) && (headHit(w, v) || compound(w, v)));
    });
    if (rival) continue;
    if (numClash(K, x.ks)) {
      /* "Kessel 2 Doppelpumpe" bei nur einer Kessel-Anlage: dazu, wenn es nur Einzelstücke sind; Anlage heißt dann allgemein */
      const n = K.k[i + 1];
      if (!/^\d+$/.test(n || "") || numClash(K, x.ks, i)) continue;
      if (!K.k.slice(0, i).every(y => !meaningful(y) || !distinct(y))) continue;
      const dk = canon(objKey(disp.get(P.key) || P.name));
      if (!dk || !dk.k.some((y, j) => headHit(y, w) && /^\d+$/.test(dk.k[j + 1] || ""))) continue;
      if (rest.filter(q => { const k = keyOf.get(q) && keyOf.get(q).k; return k && k.some((y, j) => y === w && k[j + 1] === n); }).length > 2) continue;
      general.add(P.key + "\u0000" + w);
    }
    take(rest, p); put(p, P, "Name", null);
  }
  for (const [key, pins] of [...byPlant]) if (!pins.length) byPlant.delete(key);
  /* Anlagenname ohne Nummer, wenn andere Nummern dazukamen: "Kessel 1" → "Kesselanlage" bzw. "Kessel" */
  for (const gk of general) {
    const [key, w] = gk.split("\u0000");
    const pins = byPlant.get(key); if (!pins) continue;
    const txt = new Map(), cnt = new Map();
    for (const p of pins) {
      const K = keyOf.get(p); if (!K) continue;
      for (const x of K.toks) if (!x.num && x.t.startsWith(w)) {
        const c = K.k[K.toks.indexOf(x)];
        cnt.set(c, (cnt.get(c) || 0) + 1);
        if (!x.ab && !txt.has(c)) txt.set(c, K.name.slice(x.i, x.e));
      }
    }
    let best = null; for (const [c, n] of cnt) if (c !== w && txt.has(c) && (!best || n > cnt.get(best))) best = c;
    const word = best ? txt.get(best) : (txt.get(w) || w);
    disp.set(key, word.charAt(0).toUpperCase() + word.slice(1));
  }
  const list = [];
  const order = [...plants.keys()];
  const real = order.filter(k => byPlant.has(k));
  /* Station mit nur einer Anlage: alles dorthin */
  if (real.length === 1) { byPlant.get(real[0]).push(...rest.splice(0), ...allg.splice(0)); byPlant.get(real[0]).sort((a, b) => natCmp(a.klemme, b.klemme)); }
  /* Rest nach Namen bündeln */
  const clusters = rest.length ? keyClusters(rest.map(p => ({ p, K: keyOf.get(p) })), W.opt.grpMax || 12, canon) : [];
  for (let i = clusters.length - 1; i >= 0; i--) {
    const c = clusters[i]; if (!c.K) continue;
    const core = c.K.k.filter(w => meaningful(w) && (seen.get(w) || 0) < 2);
    if (!core.length) continue;
    const hits = [...vocab].filter(([, x]) => core.every(w => [...x.v].some(v => meaningful(v) && headHit(w, v))) && !numClash(c.K, x.ks));
    if (hits.length !== 1) continue;
    for (const p of c.pins) put(p, hits[0][0], "Name", null);
    clusters.splice(i, 1);
  }
  /* Sammelmeldungen u. Ä.: zu einer Gruppe mit einer Klemme gleichen Schlüssels, sonst Allgemein */
  const sameKey = (A, B) => A.k.length === B.k.length && A.k.every((w, i) => w === B.k[i]);
  const allgLeft = [];
  const allgKey = order.find(k => /^allgemein$/i.test(plants.get(k).name));
  for (const p of allg) {
    const K = keyOf.get(p);
    if (K) {
      const hitC = clusters.filter(c => c.pins.some(q => keyOf.get(q) && sameKey(keyOf.get(q), K)));
      if (hitC.length === 1) { hitC[0].pins.push(p); p.how = ""; continue; }
      const hitP = [...plantKeys].filter(([, ks]) => ks.some(M => sameKey(M, K)));
      if (hitP.length === 1 && !hitC.length) { put(p, hitP[0][0], "Name", null); continue; }
      /* ohne eigene Allgemein-Anlage: zur Ortsgruppe ("BT C Brandmeldeanlage" → "BT") */
      const loc = allgKey ? [] : clusters.filter(c => c.K && !c.K.k.some(meaningful) && c.K.k.length < K.k.length && c.K.k.every((w, i) => w === K.k[i]));
      if (loc.length === 1) { loc[0].pins.push(p); p.how = ""; continue; }
    }
    if (p.how === "geteilt") p.how = "Programm";
    allgLeft.push(p);
  }
  if (allgLeft.length) { if (allgKey) { (byPlant.get(allgKey) || byPlant.set(allgKey, []).get(allgKey)).push(...allgLeft); byPlant.get(allgKey).sort((a, b) => natCmp(a.klemme, b.klemme)); } else list.push({ name: "Allgemein", pins: allgLeft }); }
  for (const key of order) {
    const pins = byPlant.get(key); if (!pins || !pins.length) continue;
    const P = plants.get(key), pname = disp.get(key) || P.name;
    for (const p of pins) p.plantName = pname;
    if (splitAt && pins.length > splitAt && P.groups.size > 1) {
      const sub = new Map();
      for (const p of pins) { const k = p.pgroup || "-"; if (!sub.has(k)) sub.set(k, []); sub.get(k).push(p); }
      for (const [gk, sp] of [...sub].sort((a, b) => natCmp(a[0], b[0]))) {
        const gn = (P.groups.get(gk) || {}).name;
        list.push({ name: gn && norm(gn) !== norm(pname) ? pname + " – " + gn : pname, pins: sp });
      }
    } else list.push({ name: pname, pins: pins.sort((a, b) => natCmp(a.klemme, b.klemme)) });
  }
  for (const c of clusters) list.push({ name: c.name, pins: c.pins.sort((a, b) => natCmp(a.klemme, b.klemme)) });
  /* gleiche Namen zusammenlegen */
  const merged = [];
  for (const g of list) { const m = merged.find(x => norm(x.name) === norm(g.name)); if (m) m.pins.push(...g.pins); else merged.push(g); }
  /* DDC3000: einzelne Klemme auf einem Modul, dessen übrige Klemmen alle in einer Gruppe stehen ("Tagestank" auf dem Öltank-Modul) */
  if (d3) {
    const modOf = p => (/^(\d+)\//.exec(p.klemme) || [])[1];
    const gOf = new Map(); merged.forEach(g => g.pins.forEach(p => gOf.set(p, g)));
    const spare = g => /^(allgemein|weitere datenpunkte)$/i.test(g.name);
    for (const g of [...merged]) {
      if (g.pins.length !== 1 || spare(g)) continue;
      const p = g.pins[0], m = modOf(p); if (!m) continue;
      const others = W.pins.filter(q => q !== p && q.include && modOf(q) === m);
      const hosts = new Set(others.map(q => gOf.get(q)));
      if (others.length < 2 || hosts.size !== 1) continue;
      const h = [...hosts][0]; if (!h || spare(h)) continue;
      h.pins.push(p); h.pins.sort((a, b) => natCmp(a.klemme, b.klemme)); gOf.set(p, h);
      merged.splice(merged.indexOf(g), 1);
    }
  }
  applyGroups(W, merged);
}

/* Klemmen nach ihrem Objekt-Schlüssel bündeln: Präfixbaum über die Schlüssel.
   Ein Knoten wird nur geteilt, wenn er zu groß ist und mind. zwei echte Untergruppen hat;
   ein Unterknoten mit ≥ 75 % der Klemmen ist ein eigenes Objekt ("Altbau" → "Altbau Kesselanlage"). */
function keyClusters(items, maxSize, canon) {
  const named = items.filter(x => x.K), unnamed = items.filter(x => !x.K).map(x => x.p);
  const root = { ch: new Map(), items: [], count: 0 };
  for (const x of named) {
    canon(x.K);
    let n = root; n.count++;
    for (const w of x.K.k) { if (!n.ch.has(w)) n.ch.set(w, { ch: new Map(), items: [], count: 0 }); n = n.ch.get(w); n.count++; }
    n.items.push(x);
  }
  const flat = n => { const a = [...n.items]; n.ch.forEach(c => a.push(...flat(c))); return a; };
  const out = [];
  const add = (xs, depth, pooled) => { if (xs.length) out.push({ xs, depth, pooled }); };
  (function walk(node, depth) {
    if (!node.count) return;
    const kids = [...node.ch.values()];
    if (!kids.length) { add(flat(node), depth, false); return; }
    if (kids.length === 1 && !node.items.length) { walk(kids[0], depth + 1); return; }
    const split = depth === 0 || (node.count > maxSize && kids.filter(c => c.count >= 3).length >= 2);
    if (split) {
      const here = [...node.items];
      for (const c of kids) { if (c.count === 1 && depth > 0) here.push(...flat(c)); else walk(c, depth + 1); }
      add(here, depth, true);
      return;
    }
    const dom = kids.find(c => c.count >= 2 && c.count >= 0.75 * node.count);
    if (dom) {
      walk(dom, depth + 1);
      add([...node.items, ...kids.filter(c => c !== dom).flatMap(flat)], depth, true);
      return;
    }
    add(flat(node), depth, false);
  })(root, 0);
  /* Einzelstücke unter einer reinen Ortsangabe ("BT.C": Benzinabscheider, Pumpensumpf) sind verschiedene Objekte */
  for (let i = out.length - 1; i >= 0; i--) {
    const g = out[i];
    if (!g.pooled || !g.depth || g.xs.length < 2 || g.xs.length > 4) continue;
    if (g.xs[0].K.k.slice(0, g.depth).some(meaningful)) continue;
    const by = new Map();
    for (const x of g.xs) { const k = x.K.k.join(" "); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
    if (by.size < 2) continue;
    out.splice(i, 1, ...[...by.values()].map(xs => ({ xs, depth: xs[0].K.k.length, pooled: false })));
  }
  /* Name: gemeinsamer Anfang der Schlüssel, im häufigsten Originaltext */
  const res = [];
  for (const g of out) {
    let L = g.depth;
    if (!g.pooled || !L || g.xs.length === 1) {
      const ks = g.xs.map(x => x.K.k), n = Math.min(...ks.map(k => k.length));
      let l = 0; while (l < n && ks.every(k => k[l] === ks[0][l])) l++;
      L = Math.max(L, l);
    }
    if (!L) L = 1;
    L = Math.min(...g.xs.filter(x => x.K.k.length >= L).map(x => cleanLen(x.K, L)));
    const cnt = new Map(); let K0 = null;
    for (const x of g.xs) {
      if (x.K.k.length < L) continue;
      const t = keyText(x.K, L); cnt.set(t, (cnt.get(t) || 0) + 1);
      if (!K0) K0 = x.K;
    }
    let name = "", bn = 0; cnt.forEach((n, t) => { if (n > bn || (n === bn && t.length < name.length)) { bn = n; name = t; } });
    const K = K0 ? { k: K0.k.slice(0, L), toks: K0.toks.slice(0, L), name: K0.name } : null;
    res.push({ name: name || "Weitere Datenpunkte", K, pins: g.xs.map(x => x.p) });
  }
  const tailOf = (a, b) => b.k.length < a.k.length && b.k.every((w, i) => w === a.k[a.k.length - b.k.length + i]) && b.k.some(meaningful);
  const headOf = (a, b) => b.k.length < a.k.length && b.k.every((w, i) => w === a.k[i]) && validPart(b.toks);
  for (let pass = 0; pass < 2; pass++) for (let i = res.length - 1; i >= 0; i--) {
    const g = res[i]; if (!g.K) continue;
    /* gleiches Objekt mit/ohne Ortsvorsatz ("DT Notstromaggregat" ~ "Notstromaggregat", "BHKW" ~ "BR DT BHKW") */
    let hosts = res.filter(h => h !== g && h.K && h.pins.length >= g.pins.length && (tailOf(g.K, h.K) || tailOf(h.K, g.K)));
    /* Kleinstgruppe zum übergeordneten Objekt ("BR DT E-Zähler" → "BR DT") */
    if (hosts.length !== 1 && g.pins.length <= 2) hosts = res.filter(h => h !== g && h.K && headOf(g.K, h.K));
    /* Einzelstück, dessen Wort Anfang eines Wortes einer anderen Gruppe ist ("Öl Leckanlage" → "Öltank") */
    if (hosts.length !== 1 && g.pins.length === 1) {
      const w = g.K.k.find(meaningful);
      const rel = v => v && w && v !== w && Math.min(v.length, w.length) >= 3 && Math.abs(v.length - w.length) >= 3 && (v.startsWith(w) || w.startsWith(v));
      if (w) hosts = res.filter(h => h !== g && h.K && h.pins.length >= 2 && rel(h.K.k.find(meaningful)));
    }
    if (hosts.length === 1) {
      const h = hosts[0];
      /* gleich groß: das allgemeinere Objekt gibt den Namen ("Fernw." statt "BT.C Kesselanl. Fernpumpe") */
      if (h.pins.length === g.pins.length && g.K.k.length < h.K.k.length && tailOf(h.K, g.K)) { h.name = g.name; h.K = g.K; }
      h.pins.push(...g.pins); res.splice(i, 1);
    }
  }
  if (unnamed.length) res.push({ name: "Weitere Datenpunkte", K: null, pins: unnamed });
  return res;
}
/* Namensbasiert (Modus „nach Name“) */
export function nameGroups(pins, maxSize) {
  const items = pins.map(p => ({ p, K: objKey(p.name) }));
  const canon = canonizer(items.map(x => x.K).filter(Boolean));
  return keyClusters(items, maxSize, canon).map(g => ({ name: g.name, pins: g.pins }));
}
