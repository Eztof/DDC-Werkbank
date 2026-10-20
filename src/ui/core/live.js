/* =========================================================================
   Live-Werte (aus dem Online-Reiter) für alle Ansichten.
   Online legt die zuletzt gelesenen Werte je Zentrale hier ab; Datenpunkte,
   Wartungsdoku usw. fragen sie über liveOfPin() ab. Rein lesend.
   ========================================================================= */
import { fmtNum, unitLabel } from "./util.js";
import { emit } from "./events.js";

const LIVE = new Map();   // cid → { stamp, ip, byNode: Map(nodeId → Wert) }

/* Anzeige eines gelesenen BACnet-Werts: { t: Text, cls: CSS-Klasse } */
export function liveText(o) {
  if (!o.ok) return { t: o.err === "timeout" ? "keine Antwort" : (o.err || "Fehler"), cls: "muted" };
  if (o.value == null) return { t: "—", cls: "muted" };
  const t = o.type;
  if (t === 3 || t === 4 || t === 5) { const on = o.value === true || o.value === 1 || o.value === "1"; return { t: on ? "EIN" : "AUS", cls: on ? "liveon" : "liveoff" }; }
  if (t === 13 || t === 14 || t === 19) return { t: String(o.value), cls: "" };
  if (typeof o.value === "number") return { t: fmtNum(o.value), cls: "num" };
  return { t: String(o.value), cls: "" };
}

/* values: [{ type, inst, nodeId, ok, value, err }] wie vom Dienst gelesen */
export function setLive(cid, ip, values, stamp) {
  const byNode = new Map();
  for (const v of values) if (v.nodeId && !byNode.has(v.nodeId)) byNode.set(v.nodeId, v);
  LIVE.set(cid, { ip, stamp, byNode });
  emit("live", { cid, stamp });
}
export const liveInfo = cid => LIVE.get(cid) || null;
export function liveOfNode(cid, nodeId) { const L = LIVE.get(cid); return L ? L.byNode.get(nodeId) || null : null; }
export const liveOfPin = (C, p) => liveOfNode(C.cid, p.nodeId);
/* Live-Wert einer Klemme als Text, Zahlen mit der Einheit aus der Sicherung; null wenn keiner gelesen */
export function livePinText(C, p) {
  const o = liveOfPin(C, p); if (!o) return null;
  const f = liveText(o), v = p.value && (p.value.eff || p.value.stored), u = v && v.unit ? unitLabel(v.unit) : "";
  return Object.assign(f, { ok: o.ok, t: o.ok && f.cls === "num" && u ? f.t + " " + u : f.t });
}
