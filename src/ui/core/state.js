/* =========================================================================
   Gemeinsamer Zustand der Oberfläche: geladene Zentralen, aktuelle Zentrale,
   aktuelle Ansicht und je Ansicht/Zentrale gemerkter Zustand.
   ========================================================================= */
import { store } from "./util.js";

export const APP = {
  centrals: [], cur: null, templates: [], view: "start", opts: {}, vs: {}, wd: {}, cmp: {},
  theme: store.get("theme", "system"), collapsed: store.get("navCollapsed", false)
};
export const curC = () => APP.centrals.find(c => c.cid === APP.cur) || null;
export const byCid = cid => APP.centrals.find(c => c.cid === cid) || null;
export function vstate(view, C, init) {
  const k = view + ":" + (C ? C.cid : "-");
  if (!APP.vs[k]) APP.vs[k] = init();
  return APP.vs[k];
}
