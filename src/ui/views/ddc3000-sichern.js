import { VIEWS } from "../core/ext.js";
import { h, store } from "../core/util.js";
import { btn, chk, emptyState, icon, loadFiles, pageHead, selectEl, toast } from "../shell/shell.js";
import { P90Link } from "../p90/link.js";
import { createBackup } from "../p90/backup.js";
import { knownPorts, openSerial, pickPort, portLabel, serialSupported } from "../p90/serial.js";
import { SimDDC } from "../p90/sim.js";
import { clearMakro, makroCount } from "../model/d3makro.js";

/* =========================================================================
   DDC3000 sichern – Datensicherung einer Kieback&Peter DDC3000 über RS232
   (P90-Protokoll, wie das K&P-Programm SPClientDDC). Läuft direkt im
   Browser über Web Serial (Chrome/Edge), ohne Dienst. Erfasst alle
   Zentralen am Zentralenbus mit allen Geräten, Menüs und Parameterwerten,
   optional die Definitionen. Sendet NUR Lesebefehle.
   Ergebnis: .p90-Datei, die die Werkbank wie jede Sicherung öffnet.
   ========================================================================= */
const MAX_LOG = 400;
const S = {
  ports: [], portIdx: store.get("p90Port", 0), baud: store.get("p90Baud", 9600),
  defs: store.get("p90Defs", true), demo: false,
  running: false, ac: null, prog: null, devices: [], log: [], result: null, file: null, err: "",
  _root: null
};
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + "-" + p(d.getMinutes()); };
const fileName = () => "DDC-Sicherung_" + stamp() + ".p90";
const tstr = () => new Date().toLocaleTimeString("de-DE", { hour12: false });

function addLog(text, cls) {
  S.log.push({ t: tstr(), text, cls });
  if (S.log.length > MAX_LOG) S.log.splice(0, S.log.length - MAX_LOG);
  const box = S._root && S._root.querySelector(".p90-log");
  if (box) { box.appendChild(logLine(S.log[S.log.length - 1])); while (box.childNodes.length > MAX_LOG) box.firstChild.remove(); box.scrollTop = box.scrollHeight; }
}
const logLine = l => h("div", { class: l.cls || "" }, h("span", { class: "muted" }, l.t + " "), l.text);

async function refreshPorts() { S.ports = await knownPorts(); }

/* ---------- Ablauf ---------- */
async function start() {
  if (S.running) return;
  /* Speicherort gleich beim Klick wählen (der Browser verlangt dafür einen Klick) */
  let handle = null;
  if (!S.demo && window.showSaveFilePicker) {
    try { handle = await window.showSaveFilePicker({ suggestedName: fileName(), startIn: "desktop", types: [{ description: "P90-Sicherung", accept: { "text/plain": [".p90"] } }] }); }
    catch (e) { if (e.name === "AbortError") return; }
  }
  S.running = true; S.err = ""; S.result = null; S.file = null; S.devices = []; S.log = []; S.prog = { text: "Verbinde …", done: 0, total: 0 };
  S.ac = new AbortController();
  paint();
  let transport = null, link = null;
  try {
    if (S.demo) transport = new SimDDC({ valuesPerDevice: 12, demo: true });
    else {
      const port = S.ports[S.portIdx];
      if (!port) throw new Error("Kein COM-Port gewählt.");
      transport = await openSerial(port, { baudRate: +S.baud || 9600 });
    }
    link = new P90Link(transport);
    link.on("log", (lvl, t) => addLog(t, lvl === "error" ? "err" : lvl === "warn" ? "warn" : ""));
    link.on("frame", (ev, dir) => { if (ev.type === "block") addLog((dir === "rx" ? "DDC ← " : "PC → ") + (ev.ok ? "" : "[Prüfsumme falsch] ") + ev.text, dir === "rx" ? "rx" : "tx"); });
    const r = await createBackup(link, { definitions: S.defs, signal: S.ac.signal, onProgress: onProgress });
    S.result = r;
    S.file = { name: handle ? handle.name : fileName(), text: r.text };
    if (r.devices.length || r.aborted) {
      if (handle) {
        try { const w = await handle.createWritable(); await w.write(r.text); await w.close(); S.file.saved = true; toast("Sicherung gespeichert: " + handle.name, "ok", 6000); }
        catch (e) { S.err = "Speichern fehlgeschlagen: " + e.message + " – bitte „Herunterladen“ benutzen."; }
      }
    }
  } catch (e) {
    S.err = e.message || String(e);
    addLog(S.err, "err");
  } finally {
    try { if (link) await link.close(); else if (transport && transport.close) await transport.close(); } catch (e) { /* egal */ }
    S.running = false; S.ac = null;
    paint();
  }
}
function onProgress(p) {
  S.prog = { ...S.prog, ...p };
  if (p.phase === "geraet" && p.device) {
    let d = S.devices.find(x => x.addr === p.device);
    if (!d) { d = { addr: p.device, name: (p.text.match(/: \S+ (.+?)(?: – |$)/) || [])[1] || "", st: "läuft", cls: "run" }; S.devices.push(d); }
    if (p.ok != null) { d.st = p.text.split(" – ").pop(); d.cls = p.ok ? "ok" : "err"; }
    else d.st = p.count ? p.count + " Werte …" : "Menüs …";
  }
  paintProgress();
}
function stop() { if (S.ac) { S.ac.abort(); S.prog = { ...S.prog, text: "Abbruch – warte, bis die DDC aufhört zu senden (bis ca. 10 s) …" }; paintProgress(); } }

function download() {
  if (!S.file) return;
  const a = h("a", { href: URL.createObjectURL(new Blob([S.file.text], { type: "text/plain;charset=utf-8" })), download: S.file.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function openInWerkbank() {
  if (!S.file) return;
  loadFiles([new File([S.file.text], S.file.name, { type: "text/plain" })]);
}

/* ---------- Darstellung ---------- */
function paintProgress() {
  const root = S._root; if (!root || !document.body.contains(root)) return;
  const pr = root.querySelector(".p90-prog");
  if (pr) pr.replaceWith(progressBox());
  const dl = root.querySelector(".p90-devs");
  if (dl) dl.replaceWith(deviceList());
}
function progressBox() {
  const p = S.prog;
  if (!p) return h("div", { class: "p90-prog" });
  const pct = p.total ? Math.round((p.done || 0) / p.total * 100) : 0;
  return h("div", { class: "p90-prog" },
    h("div", { class: "row" }, S.running ? h("span", { class: "spin" }) : icon(S.err || (S.result && S.result.aborted) ? "alert" : "check"), h("span", null, p.text || "")),
    p.total ? h("div", { class: "p90-bar", title: pct + " %" }, h("span", { style: { width: pct + "%" } })) : null);
}
function deviceList() {
  if (!S.devices.length) return h("div", { class: "p90-devs" });
  return h("div", { class: "p90-devs grid-wrap", style: { maxHeight: "34vh" } }, h("table", { class: "grid card-t" },
    h("thead", null, h("tr", null, h("th", null, "Adresse"), h("th", null, "Gerät"), h("th", null, "Stand"))),
    h("tbody", null, S.devices.map(d => h("tr", null, h("td", { class: "mono" }, d.addr), h("td", null, d.name),
      h("td", null, h("span", { class: "pill " + (d.cls === "ok" ? "ok" : d.cls === "err" ? "err" : "inf") }, d.st)))))));
}

function settingsCard() {
  const card = h("div", { class: "card" }, h("h3", null, icon("cpu"), "Verbindung"));
  if (!serialSupported()) card.appendChild(h("div", { class: "infobar warn", style: { marginBottom: "10px" } }, h("span", { class: "i" }, icon("alert")),
    h("div", null, "Dieser Browser kann nicht auf COM-Ports zugreifen. Bitte die Werkbank in ", h("b", null, "Microsoft Edge"), " oder ", h("b", null, "Google Chrome"), " öffnen. Der Demo-Modus geht trotzdem.")));
  const portOpts = S.ports.map((p, i) => [String(i), portLabel(p, i)]);
  if (S.portIdx >= S.ports.length) S.portIdx = 0;
  const dis = S.running;
  const portSel = portOpts.length ? selectEl(portOpts, String(S.portIdx), v => { S.portIdx = +v; store.set("p90Port", S.portIdx); }) : h("span", { class: "muted small" }, "noch kein Port freigegeben");
  const add = btn("Port auswählen …", "plus", async () => {
    try { const p = await pickPort(); await refreshPorts(); S.portIdx = Math.max(0, S.ports.indexOf(p)); store.set("p90Port", S.portIdx); paint(); }
    catch (e) { if (e.name !== "NotFoundError") toast("Port: " + e.message, "err"); }
  }, "", "COM-Port (USB-Seriell-Adapter) für die Werkbank freigeben");
  if (!serialSupported() || dis) add.disabled = true;
  if (dis && portSel.tagName === "SELECT") portSel.disabled = true;
  const baud = selectEl([["9600", "9600"], ["4800", "4800"], ["19200", "19200"], ["2400", "2400"], ["1200", "1200"]], String(S.baud), v => { S.baud = +v; store.set("p90Baud", S.baud); });
  baud.disabled = dis;
  const defs = chk("Definitionen mitsichern (Parameternamen und -arten; ca. 4 Minuten je Zentrale länger)", S.defs, v => { S.defs = v; store.set("p90Defs", v); });
  const demo = chk("Demo-Modus (nachgebaute DDC, ohne Hardware)", S.demo, v => { S.demo = v; paint(); });
  for (const l of [defs, demo]) l.querySelector("input").disabled = dis;
  card.appendChild(h("div", { class: "fields" },
    h("label", null, "COM-Port"), h("div", { class: "row" }, portSel, add),
    h("label", null, "Baudrate"), h("div", { class: "row" }, baud, h("span", { class: "muted small" }, "DDC-Parameter 4600 „P90 Baudrate“, meist 9600")),
    h("label", null, ""), defs,
    h("label", null, ""), demo));
  const go = btn(S.demo ? "Demo-Sicherung starten" : "Sicherung starten", "download", start, "accent");
  go.disabled = dis || (!S.demo && (!serialSupported() || !S.ports.length));
  const ab = btn("Abbrechen", "stop", stop);
  ab.disabled = !dis;
  card.appendChild(h("div", { class: "row", style: { marginTop: "14px" } }, go, ab,
    h("span", { class: "muted small" }, "Nur Lesebefehle. Anschluss DDC3200: Klemme 58 → Pin 2, 59 → Pin 3, 60 → Pin 5 (9-polig).")));
  const mk = makroCount();
  card.appendChild(h("div", { class: "row muted small", style: { marginTop: "10px" } },
    mk ? "Vorlagen der Schnellparametrierung: " + mk + " geladen – ergänzen Namen und Arten bei Sicherungen ohne Definitionen."
       : "Tipp: Ordner „makro.sp“ aus PS4000 (system\\makro.sp, auch als ZIP) einmal in die Werkbank ziehen – dann haben auch Sicherungen ohne Definitionen Namen und Arten.",
    mk ? btn("Vorlagen entfernen", "trash", () => { clearMakro(); paint(); }, "sm") : null));
  return card;
}

function resultCard() {
  const card = h("div", { class: "card" }, h("h3", null, icon("list"), "Ablauf"));
  card.appendChild(progressBox());
  if (S.err) card.appendChild(h("div", { class: "infobar err", style: { margin: "10px 0" } }, h("span", { class: "i" }, icon("error")), h("div", null, S.err)));
  if (S.file && !S.running) {
    const r = S.result || { devices: [] };
    card.appendChild(h("div", { class: "row", style: { margin: "10px 0" } },
      btn("In der Werkbank öffnen", "jump", openInWerkbank, "accent"),
      btn(S.file.saved ? "Nochmals herunterladen" : "Herunterladen", "download", download),
      h("span", { class: "muted small" }, (S.file.saved ? "Gespeichert als „" + S.file.name + "“. " : "") + r.devices.length + " Geräte" + (r.failed ? ", " + r.failed + " mit Fehler" : "") + (r.aborted ? " – abgebrochen, Datei ist unvollständig" : ""))));
  }
  card.appendChild(deviceList());
  const lg = h("div", { class: "p90-log mono small" }, S.log.map(logLine));
  card.appendChild(h("details", { style: { marginTop: "10px" }, open: S.running || null }, h("summary", { class: "muted small" }, "Telegramme (letzte " + MAX_LOG + ")"), lg));
  setTimeout(() => { lg.scrollTop = lg.scrollHeight; }, 0);
  return card;
}

function paint() {
  const root = S._root; if (!root) return;
  root.innerHTML = "";
  root.appendChild(settingsCard());
  if (S.prog || S.file) root.appendChild(h("div", { style: { height: "14px" } }));
  if (S.prog || S.file) root.appendChild(resultCard());
  else root.appendChild(h("div", { class: "card", style: { marginTop: "14px" } }, emptyState("cpu", "Noch keine Sicherung gelesen",
    "Adapter anstecken, „Port auswählen …“, dann „Sicherung starten“. Eine programmierte DDC3200 mit 30 Geräten braucht mit Definitionen etwa 13 Minuten. Die .p90-Datei öffnet die Werkbank wie jede andere Sicherung.")));
}

VIEWS.add({
  id: "ddc3000-sichern", label: "DDC3000 sichern", icon: "cpu", group: 3, order: 330,
  render(root) {
    root.appendChild(pageHead("DDC3000 sichern", "Datensicherung einer DDC3000 über RS232 (P90) – alle Zentralen am Bus, alle Geräte, Menüs und Werte. Rein lesend."));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    S._root = body;
    paint();
    if (serialSupported() && !S.running) refreshPorts().then(() => { if (S._root === body) paint(); });
  }
});

export const p90State = S;   // für Tests/Erweiterungen
