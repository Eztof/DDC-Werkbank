/* =========================================================================
   Live-Werte für alle Ansichten.
   Eine Live-Quelle (z. B. Online/BACnet) legt die zuletzt gelesenen Werte je
   Zentrale hier ab; Datenpunkte, Wartungsdoku usw. fragen sie über
   liveOfPin()/livePinText() ab – egal, woher sie kommen. Rein lesend.
   Neue Quelle: LIVE_SOURCES.add({ id, label, format(o) }) und setLive(…, { source: id }).
   ========================================================================= */
import { fmtNum, unitLabel } from "./util.js";
import { emit, on } from "./events.js";
import { LIVE_SOURCES } from "./ext.js";

const LIVE = new Map();   // cid → Map(source → { source, label, stamp, ip, t, byNode: Map(nodeId → Wert) })

/* Standard-Anzeige eines gelesenen Werts: { t: Text, cls: CSS-Klasse }
   o = { ok, value, err, type (BACnet-Objekttyp, optional), text (fertiger Text, optional) } */
export function defaultLiveText(o) {
  if (!o.ok) return { t: o.err === "timeout" ? "keine Antwort" : (o.err || "Fehler"), cls: "muted" };
  if (o.text != null) return { t: String(o.text), cls: "" };
  if (o.value == null) return { t: "—", cls: "muted" };
  if (typeof o.value === "boolean") return { t: o.value ? "EIN" : "AUS", cls: o.value ? "liveon" : "liveoff" };
  if (typeof o.value === "number") return { t: fmtNum(o.value), cls: "num" };
  return { t: String(o.value), cls: "" };
}
export function liveText(o) {
  const S = o && o.source && LIVE_SOURCES.get(o.source);
  if (S && S.format) { try { return S.format(o); } catch (e) { console.error("Live-Quelle " + S.id + ":", e); } }
  return defaultLiveText(o);
}

/* values: [{ nodeId, ok, value, err, … }]   opt: { source, stamp, ip } */
export function setLive(cid, values, opt) {
  const o = opt || {}, source = o.source || "bacnet", S = LIVE_SOURCES.get(source);
  const byNode = new Map();
  for (const v of values || []) if (v && v.nodeId && !byNode.has(v.nodeId)) byNode.set(v.nodeId, Object.assign({ source }, v));
  if (!LIVE.has(cid)) LIVE.set(cid, new Map());
  LIVE.get(cid).set(source, { source, label: S ? S.label : source, ip: o.ip || "", stamp: o.stamp || "", t: Date.now(), byNode });
  emit("live", { cid, source, stamp: o.stamp });
}
export function clearLive(cid, source) {
  const M = LIVE.get(cid); if (!M) return;
  if (source) M.delete(source); else LIVE.delete(cid);
  emit("live", { cid, source: source || null, stamp: null });
}
/* Neueste Lesung einer Zentrale (mit Liste aller Quellen) oder null */
export function liveInfo(cid) {
  const M = LIVE.get(cid); if (!M || !M.size) return null;
  const all = [...M.values()].sort((a, b) => b.t - a.t);
  return Object.assign({ sources: all }, all[0]);
}
export function liveOfNode(cid, nodeId) {
  const M = LIVE.get(cid); if (!M) return null;
  let best = null, bt = -1;
  for (const L of M.values()) { const v = L.byNode.get(nodeId); if (v && L.t > bt) { best = v; bt = L.t; } }
  return best;
}
export const liveOfPin = (C, p) => liveOfNode(C.cid, p.nodeId);
/* Live-Wert einer Klemme als Text, Zahlen mit der Einheit aus der Sicherung; null wenn keiner gelesen */
export function livePinText(C, p) {
  const o = liveOfPin(C, p); if (!o) return null;
  const f = liveText(o), v = p.value && (p.value.eff || p.value.stored), u = v && v.unit ? unitLabel(v.unit) : "";
  return Object.assign({}, f, { ok: o.ok, t: o.ok && f.cls === "num" && u ? f.t + " " + u : f.t });
}

/* Zentrale entfernt → ihre Live-Werte auch */
on("zentralen", ({ centrals }) => { const keep = new Set(centrals.map(c => c.cid)); for (const cid of [...LIVE.keys()]) if (!keep.has(cid)) LIVE.delete(cid); });
