import { go } from "../core/nav.js";
import { FORMATS } from "../core/ext.js";
import { APP } from "../core/state.js";
import { $, download, h, natCmp, nowStamp, store } from "../core/util.js";
import { decodeBytes } from "../core/load.js";
import { btn, chk, icon, renderAll, toast } from "../shell/shell.js";
import { pref } from "../core/persist.js";
import { SERVICE_BASE } from "../core/service.js";
import { WTG_NS } from "./generator.js";

/* =========================================================================
   WTGML-Dokument: Laden, Bearbeiten im DOM, Schreiben im K&P-Format,
   Verknüpfung mit der Datei auf der Festplatte (File System Access API)
   ========================================================================= */
export const WX = {
  /* Kind-Elemente in der Reihenfolge, wie sie das K&P-Programm schreibt */
  ORDER: {
    facility: ["facBezeichnung", "facZustand", "Artikel"],
    Artikel: ["nummer", "installationClass", "artBezeichnung", "artKlartext", "artLbnr", "standort", "pruefDatum", "mitarbeiter", "produktDoc", "job"],
    job: ["jobDescription", "executed", "targetTime", "jobBemerkung", "pruefDatum", "jobMitarbeiter"],
    articleProperties: ["description", "value", "measure", "length", "type", "checked"],
    Isp: ["ispBezeichnung", "facility", "ispComment"],
    ispComment: ["title", "body"],
    selBauteil: ["bteBezeichnung", "Isp"]
  }
};
export const wkids = (el, name) => { const a = []; if (el) for (const c of el.children) if (!name || c.localName === name) a.push(c); return a; };
export const wkid = (el, name) => { if (el) for (const c of el.children) if (c.localName === name) return c; return null; };
export const wtxt = (el, name) => { const k = name ? wkid(el, name) : el; return k ? k.textContent : ""; };

/* Element-Text setzen; fehlendes Element an der richtigen Stelle anlegen */
export function wset(el, name, value) {
  let k = wkid(el, name);
  if (value == null) { if (k) k.remove(); return null; }
  if (!k) {
    k = el.ownerDocument.createElementNS(WTG_NS, name);
    const order = WX.ORDER[el.localName] || [];
    const my = order.indexOf(name);
    let before = null;
    if (my >= 0) for (const c of el.children) { const ix = order.indexOf(c.localName); if (ix > my) { before = c; break; } }
    el.insertBefore(k, before);
  }
  k.textContent = String(value);
  return k;
}

/* Kind-Element an der richtigen Stelle einsetzen (vorhandenes gleiches ersetzen) */
export function wplace(el, child) {
  const old = wkid(el, child.localName);
  if (old) { el.replaceChild(child, old); return child; }
  const order = WX.ORDER[el.localName] || [];
  const my = order.indexOf(child.localName);
  let before = null;
  if (my >= 0) for (const c of el.children) { const ix = order.indexOf(c.localName); if (ix > my) { before = c; break; } }
  el.insertBefore(child, before);
  return child;
}
/* sortId fortlaufend neu vergeben */
export function wRenumber(isp) {
  wkids(isp, "facility").forEach((f, i) => { f.setAttribute("sortId", String(i + 1)); wkids(f, "Artikel").forEach((a, k) => a.setAttribute("sortId", String(k + 1))); });
}
/* Personen des Projekts (Mitarbeiter zuerst) */
export function wPersons(D) {
  const seen = new Set(), out = [];
  for (const tag of ["prjUser", "Participants"]) for (const p of D.doc.getElementsByTagNameNS(WTG_NS, tag)) {
    const id = p.getAttribute("personId") || "";
    if (!id || seen.has(id)) continue; seen.add(id);
    out.push({ id, el: p, name: [wtxt(p, "vorname"), wtxt(p, "nachname")].filter(Boolean).join(" ").trim() || "(ohne Name)", rel: wtxt(p, "relation"), email: wtxt(p, "email") });
  }
  out.sort((a, b) => (a.rel === "Mitarbeiter" ? 0 : 1) - (b.rel === "Mitarbeiter" ? 0 : 1) || natCmp(a.name, b.name));
  return out;
}
/* „geprüft durch“: Mitarbeiter am Artikel – Aufbau wie im K&P-Export (ohne Anrede) */
export function wSetPruefer(art, person) {
  const old = wkid(art, "mitarbeiter");
  if (!person) { if (old) old.remove(); return; }
  if (old && old.getAttribute("personId") === person.id) return;
  const doc = art.ownerDocument;
  const m = doc.createElementNS(WTG_NS, "mitarbeiter");
  m.setAttribute("personId", person.id);
  for (const name of ["nachname", "vorname", "relation", "telefon", "email", "address"]) {
    const src = wkid(person.el, name); if (!src) continue;
    m.appendChild(doc.importNode(src, true));
  }
  wplace(art, m);
}
export const wPrueferOf = art => { const m = wkid(art, "mitarbeiter"); return m ? m.getAttribute("personId") : ""; };
export function wPrueferDefault(D) {
  if (D.pruefer !== undefined) return D.pruefer;
  const want = pref("wdPruefer", null);
  const ps = wPersons(D);
  const hit = want && ps.find(p => (want.email && p.email && p.email.toLowerCase() === want.email.toLowerCase()) || p.name === want.name);
  D.pruefer = hit ? hit.id : "";
  return D.pruefer;
}
/* Rückgängig: Zustand vor strukturellen Änderungen merken */
export function wSnapshot(D) {
  D.undo = D.undo || [];
  D.undo.push(wtgmlSerialize(D.doc, D.decl));
  if (D.undo.length > 25) D.undo.shift();
}
export function wUndo(D) {
  if (!D.undo || !D.undo.length) return false;
  const selPath = D.sel ? wPath(D.sel) : null;
  const { doc } = wtgmlParse(D.undo.pop());
  D.doc = doc; D.sel = selPath ? wFromPath(D, selPath) : null; D.openArt = null; D.pick = null;
  wdocChanged(D);
  return true;
}
function wPath(el) { const p = []; while (el && el.parentElement) { p.unshift([...el.parentElement.children].indexOf(el)); el = el.parentElement; } return p; }
function wFromPath(D, p) { let el = D.doc.documentElement; for (const i of p) { if (!el) return null; el = el.children[i]; } return el || null; }
window.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && WDOC.cur && APP.view === "wartung" && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) {
    if (wUndo(WDOC.cur)) { e.preventDefault(); toast("Rückgängig gemacht.", "inf", 1500); renderAll(); }
  }
});

/* Ausgabe im Stil des K&P-Programms: 4 Leerzeichen, leere Elemente als <a></a> */
function wtgmlSerialize(doc, decl) {
  const out = [decl || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'];
  const escT = v => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escA = v => escT(v).replace(/"/g, "&quot;");
  const walk = (el, ind) => {
    /* Namensraum-Angaben ans Ende – wie im K&P-Export (Chromium liefert sie zuerst) */
    const at = [...el.attributes], isNs = a => a.name === "xmlns" || a.name.startsWith("xmlns:");
    const attrs = [...at.filter(a => !isNs(a)), ...at.filter(isNs)].map(a => " " + a.name + '="' + escA(a.value) + '"').join("");
    const elKids = [...el.children];
    if (!elKids.length) { out.push(ind + "<" + el.localName + attrs + ">" + escT(el.textContent) + "</" + el.localName + ">"); return; }
    out.push(ind + "<" + el.localName + attrs + ">");
    for (const c of elKids) walk(c, ind + "    ");
    out.push(ind + "</" + el.localName + ">");
  };
  walk(doc.documentElement, "");
  return out.join("\n") + "\n";
}
function wtgmlParse(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Die Datei ist keine lesbare XML-Datei.");
  if (doc.documentElement.localName !== "Maintenance") throw new Error("Das ist keine WTGML-Wartungsdokumentation.");
  const m = text.match(/^\s*(<\?xml[^?]*\?>)/);
  return { doc, decl: m ? m[1] : null };
}

/* ---------- Arbeitsdokument ---------- */
export function addTemplate(text, fname, handle) {
  if (WDOC.cur && WDOC.cur.dirty && !confirm("Die geöffnete Wartungsdoku hat ungespeicherte Änderungen. Trotzdem „" + fname + "“ öffnen?")) return false;
  const D = wdocOpen(text, fname, handle || null);
  if (handle) handle.getFile().then(f => { D.lastMod = f.lastModified; }).catch(() => {});
  return true;
}
export const WDOC = { cur: null };   // {name, text0, doc, decl, handle, svc, writable, dirty, savedAt, lastMod, auto, err}
                                     // handle = Dateigriff des Browsers; svc = { pfad, mtime } = Datei über die Werkbank-.exe
export function wdocOpen(text, name, handle) {
  const { doc, decl } = wtgmlParse(text);
  WDOC.cur = { name, text0: text, doc, decl, handle: handle || null, svc: null, writable: false, dirty: false, savedAt: null, lastMod: null, auto: store.get("wdAuto", true), err: null, sel: null };
  return WDOC.cur;
}
export function wdocInfo(D) {
  const r = D.doc.documentElement;
  const g = n => { const e = D.doc.getElementsByTagNameNS(WTG_NS, n)[0]; return e ? e.textContent.trim() : ""; };
  const persons = [...D.doc.getElementsByTagNameNS(WTG_NS, "Participants")].concat([...D.doc.getElementsByTagNameNS(WTG_NS, "prjUser")])
    .map(p => ({ id: p.getAttribute("personId"), name: [wtxt(p, "vorname"), wtxt(p, "nachname")].filter(Boolean).join(" "), rel: wtxt(p, "relation"), el: p }));
  return { svc: r.getAttribute("prjServiceNumber") || "", type: r.getAttribute("prjType") || "", updated: r.getAttribute("updatedate") || "",
    prj: g("prjName"), cust: g("customerName"), obj: g("objBezeichnung").trim(), persons };
}
export const wdocBauteile = D => [...D.doc.getElementsByTagNameNS(WTG_NS, "selBauteil")];
export function wdocText(D) {
  D.doc.documentElement.setAttribute("updatedate", nowStamp());
  return wtgmlSerialize(D.doc, D.decl);
}
export function wdocChanged(D) {
  D.dirty = true; D.ver = (D.ver || 0) + 1;
  if (D.auto && D.writable) { clearTimeout(D._t); D._t = setTimeout(() => wdocSave(D, true), 900); }
  wdocStatus();
}
export async function wdocSave(D, silent) {
  D = D || WDOC.cur; if (!D) return;
  const text = wdocText(D);
  if (D.svc) {
    /* über die Werkbank-.exe direkt in die Datei */
    try {
      const r = await wdSvc("schreiben", { pfad: D.svc.pfad, text, mtime: D.svc.mtime, force: !!D.overwriteOk });
      if (r && r.konflikt) {
        D.err = "Die Datei wurde außerhalb der Werkbank geändert.";
        wdocStatus(); if (!silent) toast("Die Datei wurde zwischenzeitlich außerhalb geändert. Bitte neu laden oder „Trotzdem speichern“ wählen.", "warn", 8000);
        return false;
      }
      if (!r || !r.ok) throw new Error((r && r.err) || "keine Antwort der Werkbank-.exe");
      D.svc.mtime = r.mtime; D.dirty = false; D.savedAt = new Date(); D.err = null; D.overwriteOk = false;
      wdocStatus();
      if (!silent) toast("In " + D.name + " gespeichert.", "ok");
      return true;
    } catch (e) {
      D.err = /^Speichern fehlgeschlagen/.test(e.message) ? e.message : "Speichern fehlgeschlagen: " + e.message; wdocStatus();
      toast(D.err, "err", 8000); return false;
    }
  }
  if (D.handle && D.writable) {
    try {
      const f = await D.handle.getFile();
      if (D.lastMod && f.lastModified !== D.lastMod && !D.overwriteOk) {
        D.err = "Die Datei wurde außerhalb der Werkbank geändert.";
        wdocStatus(); if (!silent) toast("Die Datei wurde zwischenzeitlich außerhalb geändert. Bitte neu laden oder „Trotzdem speichern“ wählen.", "warn", 8000);
        return false;
      }
      const w = await D.handle.createWritable();
      await w.write(text); await w.close();
      const f2 = await D.handle.getFile();
      D.lastMod = f2.lastModified; D.dirty = false; D.savedAt = new Date(); D.err = null; D.overwriteOk = false;
      wdocStatus();
      if (!silent) toast("In " + D.name + " gespeichert.", "ok");
      return true;
    } catch (e) {
      D.err = "Speichern fehlgeschlagen: " + e.message; wdocStatus();
      toast(D.err, "err", 8000); return false;
    }
  }
  download(D.name || "wartungsdoku.wtgml", text, "application/xml;charset=utf-8");
  D.dirty = false; D.savedAt = new Date(); wdocStatus();
  if (!silent) toast("Als Download gespeichert: " + D.name, "ok");
  return true;
}
export const FS_OK = () => typeof window.showOpenFilePicker === "function";
/* Öffnen über den Dateidialog des Browsers. Der Dialog kann auf manchen Rechnern scheitern, ohne dass die
   Seite den Grund erfährt (Abbruch nach der Auswahl oder gar keine Antwort) – das darf nie still passieren. */
const PICK_HINT = () => WDSVC.ok ? "Bitte „Über die .exe öffnen“ benutzen – das geht ohne den Browser-Dialog." : "Die Datei stattdessen ins Fenster ziehen.";
export async function wdocPickAndLink() {
  if (!FS_OK()) { $("#wdIn") && $("#wdIn").click(); return; }
  let handle = null, settled = false, hang = null;
  /* kommt nach dem Schließen des Dialogs nichts zurück, Bescheid sagen */
  const onFocus = () => { hang = setTimeout(() => { if (!settled) toast("Der Browser liefert die gewählte Datei nicht. " + PICK_HINT(), "warn", 12000); }, 5000); };
  window.addEventListener("focus", onFocus, { once: true });
  try {
    [handle] = await window.showOpenFilePicker({ types: [{ description: "WTGML-Wartungsdoku", accept: { "application/xml": [".wtgml", ".xml"] } }], multiple: false });
  } catch (e) {
    if (e && e.name === "AbortError") toast("Keine Datei geöffnet. Falls du eine ausgewählt hattest, gibt der Browser sie nicht heraus. " + PICK_HINT(), "inf", 9000);
    else { toast("Der Dateidialog des Browsers geht hier nicht (" + (e && e.message || e) + "). " + PICK_HINT(), "warn", 10000); if (!WDSVC.ok && $("#wdIn")) $("#wdIn").click(); }
    return;
  } finally { settled = true; clearTimeout(hang); window.removeEventListener("focus", onFocus); }
  try { await wdocLinkHandle(handle, true); }
  catch (e) { toast("Öffnen fehlgeschlagen: " + (e && e.message || e), "err", 8000); }
}
async function wdocLinkHandle(handle, ask) {
  const f = await handle.getFile();
  const D = wdocOpen(decodeBytes(new Uint8Array(await f.arrayBuffer())), f.name, handle);
  D.lastMod = f.lastModified;
  /* erst zeigen, dann nach dem Schreibrecht fragen – die Rückfrage des Browsers darf das Öffnen nicht aufhalten */
  idbPut("wdHandle", handle);
  go("wartung", { tab: "doc" });
  if (ask) await wdocRequestWrite(D);
  if (WDOC.cur !== D) return;
  toast(D.writable ? "Verknüpft: " + f.name + " – Änderungen werden direkt in die Datei geschrieben." : "Geöffnet: " + f.name + " (nur lesen) – oben „Zum Bearbeiten verknüpfen“ wählen.", D.writable ? "ok" : "warn", 6000);
}
async function wdocRequestWrite(D) {
  if (!D.handle || !D.handle.requestPermission) return false;
  try {
    const p = await D.handle.requestPermission({ mode: "readwrite" });
    D.writable = p === "granted";
  } catch (e) { D.writable = false; }
  wdocStatus();
  return D.writable;
}
async function wdocReload() {
  const D = WDOC.cur; if (!D) return;
  if (D.svc) { const auto = D.auto; if (await wdSvcOpen(D.svc.pfad, true)) { WDOC.cur.auto = auto; toast("Neu geladen: " + WDOC.cur.name, "ok"); renderAll(); } return; }
  if (!D.handle) return;
  const f = await D.handle.getFile();
  const keep = { handle: D.handle, writable: D.writable, auto: D.auto };
  const N = wdocOpen(decodeBytes(new Uint8Array(await f.arrayBuffer())), f.name, keep.handle);
  N.writable = keep.writable; N.auto = keep.auto; N.lastMod = f.lastModified;
  toast("Neu geladen: " + f.name, "ok");
  renderAll();
}
export function wdocStatus() {
  const el = $("#wdStatus"); if (!el) return;
  const D = WDOC.cur;
  el.innerHTML = "";
  if (!D) return;
  const t = D.savedAt ? D.savedAt.toLocaleTimeString("de-DE") : "";
  let cls = "inf", ic = "info", msg;
  if (D.err) { cls = "err"; ic = "error"; msg = D.err; }
  else if (D.writable) { cls = D.dirty ? "warn" : "ok"; ic = D.dirty ? "clock" : "check"; msg = "Verknüpft mit " + D.name + (D.svc ? " (über die Werkbank-.exe)" : "") + (D.dirty ? " · ungespeicherte Änderungen" + (D.auto ? " · wird gleich gespeichert" : "") : t ? " · gespeichert " + t : " · keine Änderungen"); }
  else { cls = D.dirty ? "warn" : "inf"; msg = D.name + (D.handle ? " · nur lesen – zum direkten Speichern verknüpfen" : " · nicht verknüpft – Speichern lädt eine neue Datei herunter") + (D.dirty ? " · ungespeicherte Änderungen" : ""); }
  el.className = "infobar " + cls;
  el.appendChild(icon(ic));
  el.appendChild(h("div", { class: "grow", title: D.svc ? D.svc.pfad : null }, msg));
  if (D.err && (D.handle || D.svc)) el.appendChild(h("div", { class: "row" }, btn("Neu laden", "upload", () => wdocReload(), "sm"), btn("Trotzdem speichern", "download", () => { D.overwriteOk = true; D.err = null; wdocSave(D); }, "sm")));
  else if (D.handle && !D.writable) el.appendChild(btn("Zum Bearbeiten verknüpfen", "lock", async () => { if (await wdocRequestWrite(D)) { const f = await D.handle.getFile(); D.lastMod = f.lastModified; toast("Verknüpft – Änderungen werden direkt gespeichert.", "ok"); if (D.dirty) wdocSave(D, true); } }, "sm accent"));
  else if (D.writable) el.appendChild(chk("automatisch speichern", D.auto, v => { D.auto = v; store.set("wdAuto", v); if (v && D.dirty) wdocSave(D, true); }));
}
window.addEventListener("beforeunload", e => { if (WDOC.cur && WDOC.cur.dirty) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && WDOC.cur) { e.preventDefault(); wdocSave(WDOC.cur); } });

/* ---------- Wartungsdoku über die Werkbank-.exe (Dienst) ----------
   Zweiter Weg zum direkten Speichern, unabhängig vom Dateizugriff des Browsers: die .exe liest und schreibt
   die .wtgml selbst (Routen /api/wd/…, nur für die eigene Seite). Geht, wenn die Werkbank über die .exe
   geöffnet ist (http://localhost:47902) und die .exe diese Routen kennt (Dienst ab 0.4). */
export const WDSVC = { ok: null, checking: null };
export async function wdSvc(what, body, ms) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms || 20000);
  try {
    const opts = { signal: ctl.signal, headers: { "X-Werkbank": "1" } };
    if (body !== undefined) Object.assign(opts, { method: "POST", headers: { "X-Werkbank": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const r = await fetch(SERVICE_BASE + "/api/wd/" + what, opts);
    return await r.json();
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "die Werkbank-.exe antwortet nicht" : "die Werkbank-.exe ist nicht erreichbar – läuft sie noch?");
  } finally { clearTimeout(timer); }
}
/* Kann die .exe das? (einmal fragen; ohne .exe oder aus der Datei heraus: nein) */
export function wdSvcCheck() {
  if (WDSVC.ok != null) return Promise.resolve(WDSVC.ok);
  if (location.protocol === "file:") { WDSVC.ok = false; return Promise.resolve(false); }
  if (!WDSVC.checking) WDSVC.checking = fetch(SERVICE_BASE + "/api/health").then(r => r.json()).then(j => !!(j && j.wd), () => false)
    .then(v => { WDSVC.ok = v; WDSVC.checking = null; return v; });
  return WDSVC.checking;
}
const b64Bytes = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
/* Datei über die .exe öffnen und verknüpfen */
export async function wdSvcOpen(pfad, quiet) {
  if (!quiet && WDOC.cur && WDOC.cur.dirty && !confirm("Die geöffnete Wartungsdoku hat ungespeicherte Änderungen. Trotzdem eine andere öffnen?")) return false;
  let r;
  try { r = await wdSvc("lesen?pfad=" + encodeURIComponent(pfad), undefined, 30000); }
  catch (e) { toast("Öffnen fehlgeschlagen: " + e.message, "err", 8000); return false; }
  if (!r || !r.ok) { toast("Öffnen fehlgeschlagen: " + ((r && r.err) || "keine Antwort"), "err", 8000); return false; }
  let D;
  try { D = wdocOpen(decodeBytes(b64Bytes(r.data)), r.name, null); }
  catch (e) { toast(r.name + ": " + e.message, "err", 8000); return false; }
  D.svc = { pfad: r.pfad, mtime: r.mtime }; D.writable = true;
  const rec = [r.pfad, ...store.get("wdSvcRecent", []).filter(p => p !== r.pfad)].slice(0, 6);
  store.set("wdSvcRecent", rec);
  if (!quiet) { toast("Verknüpft: " + r.name + " – Änderungen werden direkt in die Datei geschrieben.", "ok", 6000); go("wartung", { tab: "doc" }); }
  return true;
}

/* ---------- Dateigriff merken (IndexedDB) ---------- */
function idb() {
  return new Promise((res, rej) => {
    try { const r = indexedDB.open("ddcwb", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
    catch (e) { rej(e); }
  });
}
async function idbPut(k, v) { try { const db = await idb(); db.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch (e) {} }
async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch (e) { return null; } }

/* ---------- Datum im WTGML-Format (2025-07-15+02:00) ---------- */
export function wDate(d) {
  d = d || new Date();
  const p = n => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + (off >= 0 ? "+" : "-") + p(Math.floor(Math.abs(off) / 60)) + ":" + p(Math.abs(off) % 60);
}
const wDateShow = v => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "." + m[2] + "." + m[1] : v || ""; };
export const wDateFromInput = v => { if (!v) return null; const [y, mo, d] = v.split("-").map(Number); return wDate(new Date(y, mo - 1, d, 12)); };
export const wDateToInput = v => { const m = String(v || "").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ""; };

/* ---------- ISP aus Generator-Text ins Dokument einfügen ---------- */
export function wdocInsertIsp(D, bteEl, ispText, replaceSameName) {
  const frag = new DOMParser().parseFromString('<r xmlns="' + WTG_NS + '">' + ispText + "</r>", "application/xml");
  if (frag.getElementsByTagName("parsererror").length) throw new Error("ISP konnte nicht erzeugt werden.");
  const isp = D.doc.importNode(frag.documentElement.firstElementChild, true);
  const name = wtxt(isp, "ispBezeichnung").trim();
  const old = wkids(bteEl, "Isp").find(x => wtxt(x, "ispBezeichnung").trim() === name);
  if (old && replaceSameName) {
    isp.setAttribute("sortId", old.getAttribute("sortId") || "1");
    const cm = wkid(old, "ispComment"); if (cm && !wkid(isp, "ispComment")) wplace(isp, cm);   // ISP-Kommentar bleibt erhalten
    bteEl.replaceChild(isp, old);
  }
  else {
    const nr = Math.max(0, ...wkids(bteEl, "Isp").map(x => parseInt(x.getAttribute("sortId"), 10) || 0)) + 1;
    isp.setAttribute("sortId", String(nr));
    bteEl.appendChild(isp);
  }
  return isp;
}


/* ---------- Als Dateiformat anmelden ---------- */
FORMATS.add({
  id: "wtgml", order: 30, icon: "doc", label: "Wartungsdoku-Vorlage",
  desc: "*.wtgml – Wartungsdokumentation aus dem Wartungsprogramm, leer oder ausgefüllt. Wird verknüpft und direkt bearbeitet.",
  exts: ["wtgml", "xml"],
  sniff: (name, head) => /<([\w-]+:)?Maintenance[\s>]/.test(head) || name.toLowerCase().endsWith(".wtgml"),
  open(text, f, handle) {
    if (!addTemplate(text, f.name, handle)) return null;
    APP.wdTab = "doc";
    return { view: "wartung", msg: "Wartungsdoku geöffnet: " + WDOC.cur.name + (WDOC.cur.handle ? " – zum direkten Speichern im Tab „Wartungsdoku“ verknüpfen." : "") };
  }
});
