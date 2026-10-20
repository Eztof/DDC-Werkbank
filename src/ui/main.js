/* =========================================================================
   Einstieg: lädt alle Module (Ansichten tragen sich dabei in VIEWS ein)
   und startet die Oberfläche.
   ========================================================================= */
import "./core/util.js";
import "./core/load.js";
import "./model/model.js";
import "./model/d4pml.js";
import "./model/ddc3000.js";
import "./model/findings.js";
import "./core/views.js";
import "./shell/shell.js";
import "./core/persist.js";
import "./views/start-overview.js";
import "./views/points.js";
import "./views/program.js";
import "./views/findings-sched.js";
import "./wartung/generator.js";
import "./wartung/anlagen.js";
import "./views/compare.js";
import "./wartung/wtgml.js";
import "./wartung/view.js";
import "./wartung/link.js";
import "./wartung/air.js";
import "./views/online.js";
import { buildShell } from "./shell/shell.js";
import { persistInit } from "./core/persist.js";

/* ---------- Start ---------- */
function boot() { buildShell(); persistInit(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

