import { PIN_ACTIONS, PIN_COLUMNS, PIN_FILTERS } from "../core/ext.js";
import { h, trunc } from "../core/util.js";
import { btn, icon } from "../shell/shell.js";
import { WDOC, wtxt } from "./wtgml.js";
import { artForPin, artName, jumpToArt } from "./view.js";
import { artResult, docPinMap, lkIspKey } from "./link.js";

/* =========================================================================
   Wartungsdoku ↔ Datenpunkte: Spalte, Filter und Sprung-Knopf in der
   Datenpunkt-Ansicht. Alles, was die Doku dort zeigt, steht hier.
   ========================================================================= */
const docOf = (ctx, C) => ctx.doc || (ctx.doc = docPinMap(C));

PIN_COLUMNS.add({
  id: "doc", label: "Wartungsdoku", order: 90, cls: "small nowrap",
  prepare: (C, ctx) => { ctx.doc = docPinMap(C); },
  show: (C, ctx) => ctx.doc.size > 0,
  sort: (p, ctx) => ctx.doc.has(p.uid) ? wtxt(ctx.doc.get(p.uid).f, "facBezeichnung") : "~~~",
  cell(C, p, ctx) {
    const hit = ctx.doc.get(p.uid);
    if (!hit) return p.kind !== "frei" ? h("span", { class: "faint" }, "–") : null;
    const fb = wtxt(hit.f, "facBezeichnung"), r = artResult(hit.a);
    return [h("a", { class: "klink", title: lkIspKey(hit.isp) + " › " + fb + " › " + artName(hit.a) + (hit.st === "sicher" ? "\n(erkannt, noch nicht ins Info-Feld eingetragen)" : ""), onclick: e => { e.stopPropagation(); jumpToArt(hit); } }, icon("doc"), trunc(fb, 26)),
      " ", h("span", { class: "pill " + r.c }, r.t)];
  }
});

PIN_FILTERS.add({ id: "doc", label: "in der Wartungsdoku", order: 100, show: () => !!WDOC.cur, test: (p, ctx, C) => docOf(ctx, C).has(p.uid) });
PIN_FILTERS.add({ id: "nodoc", label: "nicht in der Wartungsdoku", order: 110, show: () => !!WDOC.cur, test: (p, ctx, C) => p.kind !== "frei" && !docOf(ctx, C).has(p.uid) });

PIN_ACTIONS.add({
  id: "doc", order: 30,
  button(C, p) { const hit = artForPin(C, p); return hit ? btn("In der Wartungsdoku", "doc", () => jumpToArt(hit), "sm", "Zum Eintrag dieses Datenpunkts in der verknüpften Wartungsdoku") : null; }
});
