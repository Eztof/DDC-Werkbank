/* =========================================================================
   Live-Werte für alle Ansichten.
   Eine Live-Quelle (z. B. Online/BACnet) legt die zuletzt gelesenen Werte je
   Zentrale hier ab; Datenpunkte, Wartungsdoku usw. fragen sie über
   liveOfPin()/livePinText() ab – egal, woher sie kommen. Rein lesend.
   Neue Quelle: LIVE_SOURCES.add({ id, label, format(o) }) und setLive(…, { source: id }).
   Quellen, die einzelne Parameter über ihre Adresse lesen können (K&P direkt),
   melden want(cid, adressen) an: Ansichten fordern mit wantLive() an, was sie
   gerade zeigen; die Quelle legt die Werte mit setLiveAddr() ab.
   ========================================================================= */
import { fmtNum, unitLabel } from "./util.js";
import { emit, on } from "./events.js";
import { LIVE_SOURCES } from "./ext.js";

const LIVE = new Map();   // cid → Map(source → { source, label, stamp, ip, t, byNode: Map(nodeId → Wert), byAddr: Map(Adresse → Wert) })

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
  const old = LIVE.get(cid).get(source);
  LIVE.get(cid).set(source, { source, label: S ? S.label : source, ip: o.ip || "", stamp: o.stamp || "", t: Date.now(), byNode, byAddr: old && old.byAddr || new Map() });
  emit("live", { cid, source, stamp: o.stamp });
}
/* Werte je Adresse ergänzen: values [{ a, ok, v, pv, unit, err }] */
export function setLiveAddr(cid, values, opt) {
  const o = opt || {}, source = o.source || "kp", S = LIVE_SOURCES.get(source);
  if (!LIVE.has(cid)) LIVE.set(cid, new Map());
  const M = LIVE.get(cid);
  let L = M.get(source);
  if (!L) { L = { source, label: S ? S.label : source, ip: o.ip || "", stamp: "", t: 0, byNode: new Map(), byAddr: new Map() }; M.set(source, L); }
  const now = Date.now();
  for (const v of values || []) if (v && v.a) L.byAddr.set(v.a, Object.assign({ source, t: now }, v));
  L.stamp = o.stamp || L.stamp; L.t = now; if (o.ip) L.ip = o.ip;
  emit("live", { cid, source, stamp: L.stamp, addr: true });
}
export function liveOfAddr(cid, a) {
  const M = LIVE.get(cid); if (!M || !a) return null;
  let best = null;
  for (const L of M.values()) { const v = L.byAddr && L.byAddr.get(a); if (v && (!best || v.t > best.t)) best = v; }
  return best;
}
/* Anzeige eines Adress-Werts: Klartext der Zentrale, Zahlen im Werkbank-Format */
export function liveAddrText(o) {
  if (!o) return null;
  if (!o.ok) return { t: o.err || "Fehler", cls: "muted", ok: false };
  const u = o.unit ? " " + o.unit : "";
  if (typeof o.v === "boolean") return { t: o.v ? "EIN" : "AUS", cls: o.v ? "liveon" : "liveoff", ok: true };
  const pvs = o.pv == null ? "" : String(o.pv).trim();
  if (typeof o.v === "number") {
    const pn = parseFloat(pvs.replace(",", "."));
    if (!pvs || (!isNaN(pn) && /^[-+\d.,\s]+$/.test(pvs.replace(o.unit || "\u0000", "")))) return { t: fmtNum(o.v) + u, cls: "num", ok: true };
  }
  if (pvs) return { t: pvs + (o.unit && !pvs.includes(o.unit) ? u : ""), cls: "", ok: true };
  if (o.v != null) return { t: String(o.v) + u, cls: "", ok: true };
  return { t: "—", cls: "muted", ok: true };
}
/* Ansicht fordert Werte an (nur Quellen mit want()); billig, Quelle entscheidet über Lesen */
export function wantLive(cid, addrs) {
  const list = [...new Set((addrs || []).filter(Boolean))];
  if (!list.length) return;
  for (const S of LIVE_SOURCES.list()) if (S.want) { try { S.want(cid, list); } catch (e) { console.error("Live-Quelle " + S.id + ":", e); } }
}
/* Gibt es eine Quelle, die gerade für diese Zentrale Adressen lesen kann? */
export function liveConnected(cid) {
  return LIVE_SOURCES.list().some(S => S.connected && S.connected(cid));
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
