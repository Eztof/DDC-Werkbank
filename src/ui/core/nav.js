/* =========================================================================
   Navigation und Sprungziele: von überall in eine Ansicht springen,
   z. B. von einem Befund zur Klemme oder von einem Live-Wert zum Baustein.
   Das Neuzeichnen übernimmt das Fenster-Gerüst (setRenderer).
   ========================================================================= */
import { APP } from "./state.js";
import { emit } from "./events.js";

let RENDER = () => {};
export function setRenderer(fn) { RENDER = fn; }

export function go(view, opts) { APP.view = view; APP.opts = opts || {}; emit("ansicht", { view, opts: APP.opts }); RENDER(); }

export function openPin(cid, uid) { if (cid) APP.cur = cid; go("points", { pin: uid }); }
export function openNode(cid, nid, chain) { if (cid) APP.cur = cid; go("program", { node: nid, chain: chain || null }); }
export function openRef(C, ref) {
  if (!ref) return;
  if (ref.pin) return openPin(C.cid, ref.pin);
  const n = C.nodes.get(ref.node);
  if (n && n.pin) return openPin(C.cid, n.pin.uid);
  if (ref.node) return openNode(C.cid, ref.node);
}
