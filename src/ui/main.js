/* =========================================================================
   Einstieg: lädt alle Module (sie tragen sich dabei in die Register aus
   core/ext.js ein), stellt die Schnittstelle für Erweiterungen bereit und
   startet die Oberfläche.
   ========================================================================= */
import "./core/util.js";
import "./core/load.js";
import "./model/model.js";
import "./model/d4pml.js";
import "./model/ddc3000.js";
import "./model/findings.js";
import "./model/pipeline.js";
import "./shell/shell.js";
import "./core/persist.js";
import "./views/start-overview.js";
import "./views/points.js";
import "./views/program.js";
import "./views/findings-sched.js";
import "./wartung/generator.js";
import "./wartung/anlagen.js";
import "./wartung/wtgml.js";
import "./wartung/view.js";
import "./wartung/link.js";
import "./wartung/air.js";
import "./wartung/in-datenpunkten.js";
import "./views/online.js";
import "./views/online-kp.js";
import { ALL } from "./core/ext.js";
import { APP, byCid, curC } from "./core/state.js";
import { emit, on } from "./core/events.js";
import { go, openNode, openPin, openRef } from "./core/nav.js";
import { liveOfPin, livePinText, setLive } from "./core/live.js";
import * as util from "./core/util.js";
import * as model from "./model/model.js";
import { btn, buildShell, icon, kindTag, pageHead, renderAll, toast } from "./shell/shell.js";
import { persistInit } from "./core/persist.js";
import { WDOC, wdocText } from "./wartung/wtgml.js";

/* ---------- Schnittstelle für Erweiterungen ----------
   Erweiterungen ohne Neubauen: Datei  ui\erweiterungen.js  neben die HTML legen, z. B.
     DDCWerkbank.register.CHECKS.add({ id: "meine", label: "Meine Prüfung", run(C, add) { … } });
   oder vor dem Start in die Warteschlange:
     (window.DDCWerkbankErweiterungen = window.DDCWerkbankErweiterungen || []).push(api => { … });  */
const api = {
  version: __WB_VERSION__,
  register: ALL,
  state: APP, curC, byCid,
  on, emit, go, openPin, openNode, openRef, renderAll,
  live: { setLive, liveOfPin, livePinText },
  ui: { h: util.h, icon, btn, toast, pageHead, kindTag },
  wartung: { doc: () => WDOC.cur, text: () => WDOC.cur ? wdocText(WDOC.cur) : "" },
  util, model
};
window.DDCWerkbank = api;
const geladen = [];
function runExtension(fn) {
  if (typeof fn !== "function") return;
  try { fn(api); geladen.push(fn.name || "Erweiterung"); }
  catch (e) { console.error("Erweiterung:", e); setTimeout(() => toast("Eine Erweiterung konnte nicht geladen werden: " + (e && e.message || e), "err", 8000), 500); }
}
api.erweiterungen = geladen;

/* ---------- Start ---------- */
function boot() {
  const q = window.DDCWerkbankErweiterungen;
  if (Array.isArray(q)) q.forEach(runExtension);
  window.DDCWerkbankErweiterungen = { push: runExtension };   // später eingereihte sofort ausführen
  buildShell();
  persistInit();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
