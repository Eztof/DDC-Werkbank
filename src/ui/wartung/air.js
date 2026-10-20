import { APP } from "../core/state.js";
import { h, natCmp, trunc, uniq } from "../core/util.js";
import { btn, emptyState, icon, renderAll, selectEl } from "../shell/shell.js";
import { pref, setPref } from "../core/persist.js";
import { wSnapshot, wdocChanged, wset, wtxt } from "./wtgml.js";
import { jumpToArt, wIsps } from "./view.js";
import { lkAks, lkAksRel, lkArts, lkFold, lkIspKey, lkLinks, lkNum, lkPins, lkSplitTag, lkType, lkWords } from "./link.js";

/* =========================================================================
   Wartungsdoku – Reiter „Zu-/Abluft“
   Für VSR (Volumenstromregler) und BSK (Brandschutzklappen) – auf Wunsch auch
   weitere Bauarten – festlegen, ob Zuluft oder Abluft. Die Angabe wird hinten an
   den Klartext gehängt („… Zuluft“). Die Verknüpfung ignoriert genau dieses
   Anhängsel (lkSplitTag), alles andere am Namen wird weiter geprüft.
   ========================================================================= */
const AIR_DEFAULT = ["VSR", "BSK"];
const AIR_TEXT = [[/volumenstrom|\bvsr\b/i, "VSR"], [/brandschutz|\bbsk\b/i, "BSK"]];
const AIR_NAMES = { VSR: "Volumenstromregler", BSK: "Brandschutzklappen", AUK: "Außenluftklappen", FOK: "Fortluftklappen", JAK: "Jalousieklappen", UMK: "Umluftklappen" };

/* Luftseite aus einem Text: "Zuluft" | "Abluft" | "beide" | "" */
function airSide(text) {
  const t = lkFold(text);
  if (/zu-?\s*\/\s*ab|zu-?\s+und\s+ab/.test(t)) return "beide";
  const w = lkWords(text);
  const z = w.some(x => x.startsWith("zuluft")), a = w.some(x => x.startsWith("abluft"));
  return z && a ? "beide" : z ? "Zuluft" : a ? "Abluft" : "";
}
function airTypeOf(x) {
  if (x.feat.aks) return lkType(x.feat.segs);
  const kt = wtxt(x.a, "artKlartext");
  for (const [re, t] of AIR_TEXT) if (re.test(kt)) return t;
  return "";
}
function airTypes() { const t = pref("airTypes", null); return new Set(Array.isArray(t) && t.length ? t : AIR_DEFAULT); }

/* Geräte einer ISP (gruppiert über das AKS), mit Angaben aus Name, Anhängsel und Sicherung */
function airDevices(D, isp, types) {
  types = types || airTypes();
  const L = APP.centrals.length ? lkLinks(D, isp) : null;
  const map = new Map();
  for (const x of lkArts(isp)) {
    if (x.station) continue;
    const typ = airTypeOf(x);
    if (!typ || !types.has(typ)) continue;
    const key = x.feat.aks || "txt:" + x.key;
    if (!map.has(key)) map.set(key, { key, typ, aks: x.feat.aks, arts: [], pins: new Map() });
    const d = map.get(key);
    d.arts.push(x.a);
    const l = L && L.arts.get(x.a);
    if (l && l.p) d.pins.set(l.p.uid, l.p);
  }
  if (L && L.C) {
    const P = lkPins(L.C);
    for (const d of map.values()) {
      if (!d.aks) continue;
      for (const f of (P.byAks.get(d.aks) || [])) d.pins.set(f.p.uid, f.p);
      /* noch nicht verknüpft: Klemmen mit verwandtem AKS (z. B. anderer ISP-Teil beim Kopieren) */
      if (!d.pins.size) { const sg = d.aks.split("_"); for (const f of P.list) if (f.aks && lkType(f.segs) === d.typ && lkAksRel(sg, f.segs) >= 0.75) d.pins.set(f.p.uid, f.p); }
    }
  }
  for (const d of map.values()) {
    const tags = uniq(d.arts.map(a => lkSplitTag(wtxt(a, "artKlartext")).tag).filter(Boolean));
    d.tag = tags.length === 1 && d.arts.every(a => lkSplitTag(wtxt(a, "artKlartext")).tag) ? tags[0] : tags.length ? "gemischt" : "";
    const ns = uniq(d.arts.map(a => airSide(lkSplitTag(wtxt(a, "artKlartext")).base)).filter(Boolean));
    d.byName = ns.length === 1 ? ns[0] : ns.length > 1 ? "beide" : "";
    const ps = uniq([...d.pins.values()].map(p => airSide(p.name)).filter(Boolean));
    d.byPin = ps.length === 1 ? ps[0] : ps.length > 1 ? "beide" : "";
    const clear = v => v === "Zuluft" || v === "Abluft";
    d.side = clear(d.tag) ? d.tag : clear(d.byName) ? d.byName : "";
    d.how = clear(d.tag) ? "zugeordnet" : d.side ? "steht im Namen" : "";
    d.sugg = !d.side && clear(d.byPin) ? d.byPin : "";
    d.warn = d.side && clear(d.byPin) && d.byPin !== d.side ? "Sicherung sagt „" + d.byPin + "“"
      : clear(d.tag) && clear(d.byName) && d.byName !== d.tag ? "Name enthält „" + d.byName + "“"
      : d.tag === "gemischt" ? "Einträge des Geräts uneinheitlich" : "";
    d.num = d.aks ? lkNum(d.aks.split("_")) : 0;
    d.label = d.aks ? d.aks.split("_").pop() : d.typ;
  }
  return [...map.values()].sort((u, v) => natCmp(u.typ, v.typ) || u.num - v.num || natCmp(u.key, v.key));
}
export function airOpenCount(D) {
  let n = 0;
  for (const { isp } of wIsps(D)) for (const d of airDevices(D, isp)) if (!d.side) n++;
  return n;
}
/* Luftseite setzen: hinten anhängen (nicht doppelt, wenn der Name es schon sagt) oder entfernen */
function airSet(d, side) {
  for (const a of d.arts) {
    const { base } = lkSplitTag(wtxt(a, "artKlartext"));
    wset(a, "artKlartext", side && airSide(base) !== side ? base + " " + side : base);
  }
}

export function wdAirTab(body, D) {
  const S = D.air || (D.air = { sel: null, filter: "offen" });
  const rerender = () => renderAll();
  const isps = wIsps(D);
  if (!isps.length) { body.appendChild(h("div", { class: "card" }, emptyState("doc", "Keine ISP im Dokument", ""))); return; }
  const types = airTypes();

  /* Bauarten im Dokument */
  const typeCount = new Map();
  for (const { isp } of isps) for (const x of lkArts(isp)) { if (x.station) continue; const t = airTypeOf(x); if (t) typeCount.set(t, (typeCount.get(t) || 0) + 1); }
  const all = isps.map(o => Object.assign({}, o, { devs: airDevices(D, o.isp, types) }));
  const T = all.reduce((t, o) => { for (const d of o.devs) { t.n++; if (!d.side) t.open++; if (d.sugg) t.sugg++; if (d.warn) t.warn++; } return t; }, { n: 0, open: 0, sugg: 0, warn: 0 });

  const apply = devs => {
    if (!devs.length) return;
    wSnapshot(D);
    for (const [d, side] of devs) airSet(d, side);
    wdocChanged(D);
    rerender();
  };
  const allSugg = () => all.flatMap(o => o.devs.filter(d => d.sugg).map(d => [d, d.sugg]));
  const toggleType = t => { const s = new Set(types); s.has(t) ? s.delete(t) : s.add(t); if (!s.size) AIR_DEFAULT.forEach(x => s.add(x)); setPref("airTypes", [...s]); rerender(); };

  const others = [...typeCount.entries()].filter(([t]) => !types.has(t)).sort((a, b) => b[1] - a[1]);
  const addSel = others.length ? selectEl([["", "Bauart hinzufügen …"], ...others.map(([t, n]) => [t, t + (AIR_NAMES[t] ? " – " + AIR_NAMES[t] : "") + " (" + n + ")"])], "", v => { if (v) toggleType(v); }, "sm") : null;
  body.appendChild(h("div", { class: "card", style: { marginBottom: "12px", flexShrink: "0" } },
    h("div", { class: "row" },
      h("span", { class: "muted small" }, "Bauarten:"),
      [...types].map(t => h("span", { class: "chip on", title: (AIR_NAMES[t] || t) + " – zum Entfernen klicken", onclick: () => toggleType(t) }, t, h("span", { class: "n" }, typeCount.get(t) || 0))),
      addSel,
      h("span", { class: "grow" }),
      h("span", { class: "muted small" }, T.n + " Geräte · " + T.open + " ohne Angabe" + (T.warn ? " · " + T.warn + " Hinweise" : "")),
      btn("Vorschläge aus der Sicherung übernehmen (" + T.sugg + ")", "check", () => apply(allSugg()), T.sugg ? "accent" : "")),
    h("div", { class: "small muted", style: { marginTop: "8px" } },
      "„Zuluft“ oder „Abluft“ wird hinten an den Namen gehängt – nur wenn der Name es nicht schon sagt. Die Verknüpfung wertet dieses Anhängsel nicht als Abweichung. Vorschläge stammen aus den Klemmennamen der Sicherung.")));

  if (!S.sel || !D.doc.contains(S.sel)) S.sel = (all.find(o => o.devs.some(d => !d.side)) || all.find(o => o.devs.length) || all[0]).isp;
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
    const open = o.devs.filter(d => !d.side).length;
    rail.appendChild(h("div", { class: "rail-item" + (S.sel === o.isp ? " on" : ""), onclick: () => { S.sel = o.isp; rerender(); } },
      h("span", { class: "sevdot " + (!o.devs.length ? "info" : open ? "warn" : "ok") }),
      h("div", { class: "lbl" }, h("b", null, lkIspKey(o.isp) || "ISP"), h("small", null, o.devs.length ? o.devs.length + " Geräte · " + (o.devs.length - open) + " mit Angabe" : "keine Geräte dieser Bauarten")),
      open ? h("span", { class: "badge soft" }, open) : null));
  }

  const o = all.find(x => x.isp === S.sel);
  main.appendChild(h("div", { class: "row", style: { marginBottom: "10px" } },
    h("h2", { style: { margin: 0, font: "600 18px/26px var(--font)" } }, lkIspKey(o.isp) || "ISP"),
    h("span", { class: "grow" }),
    (() => { const sg = o.devs.filter(d => d.sugg); return sg.length ? btn("Vorschläge dieser ISP übernehmen (" + sg.length + ")", "check", () => apply(sg.map(d => [d, d.sugg])), "accent") : null; })()));
  if (!o.devs.length) { main.appendChild(emptyState("air", "Keine Geräte dieser Bauarten", "In dieser ISP gibt es keine Einträge vom Typ " + [...types].join(", ") + ".")); return; }
  const F = { offen: o.devs.filter(d => !d.side || d.warn), alle: o.devs };
  main.appendChild(h("div", { class: "seg", style: { marginBottom: "10px" } }, [["offen", "Ohne Angabe / Hinweis"], ["alle", "Alle"]].map(([k, l]) =>
    h("button", { class: S.filter === k ? "on" : "", onclick: () => { S.filter = k; rerender(); } }, l + " (" + F[k].length + ")"))));
  const list = F[S.filter] || F.alle;
  if (!list.length) { main.appendChild(emptyState("check", "Alles zugeordnet", "Jedes Gerät dieser ISP hat eine Zu- oder Abluft-Angabe.")); return; }

  const tb = h("tbody");
  main.appendChild(h("table", { class: "grid lk-t air-t" }, h("thead", null, h("tr", null,
    h("th", null, "Gerät"), h("th", null, "Eintrag in der Doku"), h("th", null, "In der Sicherung"), h("th", null, "Luftseite"))), tb));
  for (const d of list) {
    const sideBtn = side => h("button", { class: (d.side === side ? "on" : "") + (d.sugg === side ? " sugg" : ""), title: d.sugg === side ? "Vorschlag aus der Sicherung" : "", onclick: () => apply([[d, side]]) }, side);
    const pins = [...d.pins.values()].sort((u, v) => natCmp(u.klemme, v.klemme));
    tb.appendChild(h("tr", null,
      h("td", { class: "mono" }, h("span", { class: "badge soft", title: AIR_NAMES[d.typ] || d.typ }, d.typ), " " + d.label),
      h("td", null, d.arts.map(a => h("div", null, h("a", { class: "klink", style: { fontWeight: 400 }, title: "Im Dokument zeigen", onclick: () => jumpToArt({ f: a.parentElement, a }) }, wtxt(a, "artKlartext")),
        h("span", { class: "sub" }, wtxt(a.parentElement, "facBezeichnung"))))),
      h("td", null, pins.length ? pins.slice(0, 4).map(p => h("span", { class: "sub" }, p.klemme + " · " + trunc(p.name.slice((lkAks(p.name) || "").length).trim() || p.name, 46))) : h("span", { class: "muted small" }, APP.centrals.length ? "keine Klemme" : "Sicherung nicht geladen"),
        pins.length > 4 ? h("span", { class: "sub" }, "… " + (pins.length - 4) + " weitere") : null),
      h("td", { class: "lk-acts" },
        h("div", { class: "seg air-seg" }, sideBtn("Zuluft"), sideBtn("Abluft")),
        d.tag && d.tag !== "gemischt" ? btn(null, "close", () => apply([[d, ""]]), "subtle sm", "Angehängtes „" + d.tag + "“ wieder entfernen") : null,
        h("span", { class: "sub" }, d.how || (d.sugg ? "Vorschlag: " + d.sugg : d.byPin === "beide" || d.byName === "beide" ? "Zu- und Abluft – bitte wählen" : "ohne Angabe")),
        d.warn ? h("span", { class: "sub", style: { color: "var(--warn)" } }, d.warn) : null)));
  }
}

