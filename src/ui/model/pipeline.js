import { ANALYSES } from "../core/ext.js";
import { safely } from "../core/registry.js";
import { runFindings } from "./findings.js";

/* =========================================================================
   Nach dem Einlesen: gemeinsame Schritte für jede Zentrale, egal welches
   Format – Auswertungen (ANALYSES), dann Prüfungen (CHECKS).
   ========================================================================= */
export function prepareCentral(C, file, hash) {
  C.filePath = file.path;
  C.hash = hash;
  for (const A of ANALYSES.list()) safely("Auswertung " + A.id, () => A.run(C));
  runFindings(C);
  return C;
}

/* Kurzer Fingerabdruck eines Texts (zum Erkennen doppelt geladener Dateien) */
export function textHash(t) {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h1 ^= t.charCodeAt(i); h1 = Math.imul(h1, 16777619); }
  return t.length + ":" + (h1 >>> 0).toString(16);
}
