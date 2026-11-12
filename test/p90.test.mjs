/* DDC3000 über P90 (RS232): Protokoll, Sicherung mit nachgebauter DDC,
   Einlesen der .p90 als Zentrale. Ohne Hardware, ohne Browser.
   (Übernommen aus p90/test/run-tests.js und erweitert.) */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/ui/p90/protocol.js";
import * as cp850 from "../src/ui/p90/cp850.js";
import { P90Link, LOGIN_IDENT } from "../src/ui/p90/link.js";
import { createBackup, parseBackup } from "../src/ui/p90/backup.js";
import { SimDDC } from "../src/ui/p90/sim.js";
import { parseP1, parseP90, toWwf } from "../src/ui/model/p90.js";

const txt = b => P.asciiText(b);

test("CRC und Block wie von der echten DDC", () => {
  // echter Mitschnitt: <STX>G0 0000 000000000000000 32 96 6.740 A 1 2 DDC001<CR><ETX>EA8A<SUB>
  const b = P.buildBlock("G0 0000 000000000000000 32 96 6.740 A 1 2 DDC001\r");
  assert.equal(txt(b.slice(-5, -1)), "EA8A");
  assert.equal(txt(P.buildBlock("G0 " + LOGIN_IDENT).slice(-5, -1)), "9512");
  assert.equal(P.hex4(P.crc16(Uint8Array.from("123456789", c => c.charCodeAt(0)))), "31C3");
});

test("CP850 verlustfrei (alle 256 Zeichen)", () => {
  const all = Uint8Array.from([...Array(256).keys()]);
  assert.deepEqual(cp850.encode(cp850.decode(all)), all);
  assert.equal(cp850.decode([0x4c, 0x9a, 0x46]), "LÜF");
  assert.equal(cp850.decode([0xe1]), "ß");
});

test("Parser: Block, Steuerzeichen, falsche Prüfsumme", () => {
  const evs = []; const pr = new P.FrameParser(e => evs.push(e));
  const blk = P.buildBlock("Z5 1.1.0 03.11.26 15:19\r");
  pr.push(Uint8Array.from([0x16, 0x06, ...blk.slice(0, 7)])); pr.push(blk.slice(7));
  const bad = blk.slice(); bad[bad.length - 2] ^= 1; pr.push(bad);
  assert.deepEqual(evs.map(e => e.type + ":" + (e.name || e.ok)), ["ctrl:ACK", "block:true", "block:false"]);
  assert.equal(evs[1].text, "Z5 1.1.0 03.11.26 15:19");
});

test("Sicherung komplett (mit Definitionen)", async () => {
  const link = new P90Link(new SimDDC());
  const phases = new Set();
  const r = await createBackup(link, { definitions: true, onProgress: p => phases.add(p.phase) });
  assert.equal(r.aborted, false);
  assert.deepEqual(r.zentralen, ["1.2.0"]);
  assert.deepEqual(r.devices.map(d => d.addr), ["1.2.0", "1.2.1", "1.2.701", "1.2.801"]);
  assert.equal(r.failed, 0);
  assert.ok(r.text.includes("[Gerät 1.2.1 LÜFTUNG 31 110]"));
  assert.ok(r.text.includes("p1 1.2.1 5100/1 28.5 108 0F 00 WT Becken Zulüfter Soll"));
  assert.ok(!/^Z5 /m.test(r.text), "unaufgeforderte Z5 dürfen nicht in die Datei");
  assert.ok(r.text.includes("[Definitionen 1.2.0 D0 Parameterdefinitionen]"));
  assert.ok(r.text.includes("D5 32 5100"));
  for (const ph of ["login", "zentralen", "geraete", "geraet", "definitionen", "fertig"]) assert.ok(phases.has(ph), ph);
  const parsed = parseBackup(r.text);
  assert.equal(parsed.devices.length, 4);
  assert.equal(parsed.devices[1].values.length, 22);
  assert.equal(parsed.definitions.D1.length, 2);
  await link.close();
});

test("Gerät mit Fehler wird markiert, Rest läuft weiter", async () => {
  const link = new P90Link(new SimDDC({ failDevice: "1.2.701" }));
  const r = await createBackup(link, { definitions: false });
  assert.equal(r.failed, 1);
  assert.equal(r.devices.find(d => d.addr === "1.2.701").ok, false);
  assert.ok(r.text.includes("Ende p0: Z6 110 p0 1.2.701 */*"));
  assert.deepEqual(parseBackup(r.text).devices.filter(d => !d.ok).map(d => d.addr), ["1.2.701"]);
  await link.close();
});

test("NAK der DDC -> Block wird wiederholt; kaputter Block der DDC -> NAK, DDC wiederholt", async () => {
  const link = new P90Link(new SimDDC({ nakFirst: true, corruptOnce: true }));
  const r = await createBackup(link, { definitions: false });
  assert.equal(r.aborted, false);
  assert.equal(r.failed, 0);
  await link.close();
});

test("Abbruch mitten in einer Liste: DDC hört auf, Ergebnis markiert", async () => {
  const sim = new SimDDC({ valuesPerDevice: 3000 });
  const link = new P90Link(sim);
  const ac = new AbortController();
  link.on("frame", (ev, dir) => { if (dir === "rx" && ev.type === "block" && /k200\//.test(ev.text)) ac.abort(); });
  const r = await createBackup(link, { definitions: false, signal: ac.signal });
  assert.equal(r.aborted, true);
  assert.ok(r.text.includes("# ABGEBROCHEN"));
  assert.equal(sim.gaveUp, 1, "DDC hat die Liste aufgegeben");
  await link.close();
});

test("Alte Sicherungsdatei aus dem HTML-Tool (CP850-Zeichen roh) wird richtig gelesen", () => {
  const old = "# P90-Sicherung (Kieback&Peter DDC3000)\r\n# Geräte: 1\r\n\r\n[Gerät 1.2.1 L\u009aFTUNG 31 110]\r\nm1 1.2.1 238/1 03\r\np1 1.2.1 k4/1 0 0F 00 Lftg. Zul\u0081fter\r\n";
  const r = parseBackup(old);
  assert.equal(r.devices[0].name, "LÜFTUNG");
  assert.equal(r.devices[0].values[0], "p1 1.2.1 k4/1 0 0F 00 Lftg. Zulüfter");
  assert.equal(r.header["Geräte"], "1");
});

test("p1-Zeilen zerlegen (Wert, Einheit, Status, Klartext, Verknüpfung, Text)", () => {
  let r = parseP1("p1 1.2.1 5100/1 28.5 108 0F 00 WT Beckenwasser Temp. Beckenwasser Soll");
  assert.deepEqual([r.base, r.inst, r.val, r.unit, r.st, r.gt], ["5100", 1, "28.5", "108", "00", "WT Beckenwasser Temp. Beckenwasser Soll"]);
  r = parseP1("p1 1.1.0 b2/1 ???? 0 0F 20");
  assert.deepEqual([r.val, r.unit, r.st, r.gt], ["????", "0", "20", ""]);
  r = parseP1("p1 1.2.0 2150/1 002.710 B7/01 N AND 002.000 M28/01 N --- 0F 00");
  assert.equal(r.val, "002.710 B7/01 N AND 002.000 M28/01 N ---"); assert.equal(r.unit, "");
  r = parseP1('p1 1.1.0 2141/1 "01712521002" 0F 00');
  assert.deepEqual([r.val, r.quoted, r.st], ["01712521002", true, "00"]);
  r = parseP1("p1 1.2.0 1014/1 00:00-24:00 --- --- --- 0F 00");
  assert.equal(r.val, "00:00-24:00 --- --- ---");
  r = parseP1("p1 1.2.0 N/1 1 0F 00 Schwimmb.WWB Wochenprogramm");
  assert.deepEqual([r.base, r.val, r.gt], ["N", "1", "Schwimmb.WWB Wochenprogramm"]);
});

test("Demo-Sicherung → Zentrale wie aus der .wwf (Klemmen, Verknüpfungen, Wochenprogramm)", async () => {
  const link = new P90Link(new SimDDC({ demo: true }));
  const r = await createBackup(link, { definitions: true });
  await link.close();
  const C = parseP90(r.text, "Demo", "demo.p90");
  assert.equal(C.format, "DDC3000");
  assert.equal(C.meta.centralAddr, "2");
  assert.equal(C.meta.stationType, "DDC3200");
  const pin = k => C.pins.find(p => p.klemme === k);
  assert.equal(pin("b1").name, "Außentemperatur");
  assert.equal(pin("b1").value.stored.text, "8.4 °C");
  assert.equal(pin("b2").value.invalid, true, "Status 20 = ungültig");
  assert.equal(pin("y1").kind, "AA");
  assert.equal(pin("k3").kind, "BA");
  assert.equal(pin("k2").kind, "frei");
  assert.equal(pin("701/b7").name, "Rücklauf Heizung");
  assert.ok(C.edges.some(e => e.from === "0:k1" && e.to === "0:m1" && e.inv), "Merker M1 = NOT k1 …");
  assert.equal(C.nodes.get("0:m1").formula, "(NOT e1) AND e2");
  assert.ok(C.edges.some(e => e.from === "1:RK" && e.to === "0:y1"), "Ausgang y1 aus Regelkreis 1");
  assert.ok(C.edges.some(e => e.from === "0:N1" && e.to === "1:RK" && e.toPara === "5115"), "Regelkreis nutzt Wochenprogramm 1");
  const s = C.schedules[0];
  assert.equal(s.name, "Lüftung Halle");
  assert.deepEqual(s.days[0].entries.map(e => e.time), ["06:00", "22:00"]);
  assert.deepEqual(s.days[6].entries, []);
  assert.ok(C.system.some(x => x.k === "P2141/1" && x.v === "01712521002"));
  assert.equal(C.nodes.get("1:RK").paras.find(p => p.addr === "5100").range, "5.00 … 30.00");
});

test("Ohne Definitionen: Art wird aus dem Wert geschätzt; mehrere Zentralen am Bus", () => {
  const text = [
    "# P90-Sicherung (Kieback&Peter DDC3000)", "# Erstellt: 3.11.2026, 16:31:10", "# Geräte: 3", "# Zeichensatz: UTF-8 (Klartexte der DDC aus CP850 umgewandelt)", "",
    "[Gerät 1.1.0 DDC3200 32 96]", "p1 1.1.0 b1/1 12.5 108 0F 00 Außen", "p1 1.1.0 k1/1 1 0F 00 Pumpe Betrieb", "# Ende m0: Z6 000 m0 1.1.0 */* | Ende p0: Z6 000 p0 1.1.0 */*", "",
    "[Gerät 1.2.0 DDC3200 32 96]", "p1 1.2.0 b4/1 55.0 108 0F 00 Vorlauf", "p1 1.2.0 Y2/1 002.000 b4/01 N --- 0F 00 ", "p1 1.2.0 y2/1 30.0 0 0F 00 Ventil", "# Ende m0: Z6 000 m0 1.2.0 */* | Ende p0: Z6 110 p0 1.2.0 */*", "",
    "[Gerät 1.2.1 HEIZUNG 31 111]", "p1 1.2.1 5100/1 60.0 108 0F 00 Vorlauf Soll", ""
  ].join("\r\n");
  const L = parseP90(text, "Bus", "bus.p90");
  assert.equal(L.length, 2);
  assert.deepEqual(L.map(C => C.meta.centralAddr), ["1", "2"]);
  assert.equal(L[0].pins.find(p => p.klemme === "b1").kind, "AE");
  assert.equal(L[0].pins.find(p => p.klemme === "k1").kind, "BE");
  assert.equal(L[1].pins.find(p => p.klemme === "y2").kind, "AA");
  assert.ok(L[1].edges.some(e => e.from === "0:b4" && e.to === "0:y2"));
  assert.ok(L[1].system.some(x => x.k === "Geräte mit Fehler" && x.v === "1.2.0"));
  assert.match(L[0].meta.format, /ohne Definitionen/);
});

test(".EZR/.PRO (reine Antwortzeilen des K&P-Programms, CP850 roh) wird gelesen", async () => {
  /* Bytes wie in der Datei: CP850, als Windows-1252 eingelesen (so macht es die Werkbank bei Nicht-UTF-8) */
  const raw = [
    "t1 1.0.0 32 93 00 ", "p1 1.0.0 899/1 6.200 0 0F 00 ", "p1 1.0.0 2039/1 754 13 0F 00 ", "m1 1.0.0 69/1 03",
    "p1 1.0.0 2030/1 00030000 0f 00 akt. Treiber f\u0081r P90BDD ", "p1 1.0.0 1301/1 \"\" 0F 00 16.02.15  11:10 UTC Startup",
    "t1 1.0.1 16 74 40 Raum A002", "t1 1.0.121 16 74 00 BR DT Regierungspr\u0084sident",
    "p1 1.0.1 4401/1 001.000 M465/01 0F 00 ", "p1 1.0.1 6450/1 ???? 108 0F 20 Raum A002 Temp. Raum", "p1 1.0.1 8510/1 1.5 109 0F 00 ",
    "p1 1.0.121 6450/1 21.3 108 0F 00 "
  ].join("\r\n") + "\r\n";
  const text = new TextDecoder("windows-1252").decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
  const C = parseP90(text, "SICHER", "SICHER.EZR");
  assert.equal(C.meta.centralAddr, "1", "Adresse 1.0.x → Zentrale 1 (Verknüpfungen nennen 001.000)");
  assert.equal(C.meta.stationType, "DDC3035");
  assert.match(C.meta.format, /\.EZR/);
  assert.deepEqual(C.modules.map(m => [m.addr, m.type, m.name]), [["0", "DDC3035", "Grundgerät"], ["1", "EZR30", "Raum A002"], ["121", "EZR30", "BR DT Regierungspräsident"]]);
  assert.ok(C.edges.some(e => e.from === "0:m465" && e.to === "1:RK" && e.toPara === "4401"), "Quelle ohne N/I");
  const rk = C.nodes.get("1:RK");
  assert.equal(rk.paras.find(p => p.addr === "8510").values[0].text, "1.5 K");
  assert.ok(C.system.some(x => x.v === "754 min"));
  assert.ok(C.system.some(x => x.k === "P1301" && /Startup/.test(x.v)));
  assert.ok(C.system.some(x => /Treiber für P90BDD/.test(x.k)), "Umlaut aus CP850, Attribut klein geschrieben (0f)");
});

test(".wwf: Wochenprogramm BEG1=Mo =Di … =So (Montag nicht verschoben)", async () => {
  const { parseDDC3000 } = await import("../src/ui/model/ddc3000.js");
  const W = ["Z      NR=1    ; TYP=DDC3000    ; K=Heizzentrale", "B      NR=1    ; TYP=DDC3200    ; K=",
    "N      NR=1    ; K=", "     !     MO     DI     MI     DO     FR     SA     SO  ",
    "     BEG1=05:00 =06:00 =06:00 =06:00 =06:00 =--:-- =--:--", "     END1=16:00 =16:00 =16:00 =16:00 =15:00 =--:-- =--:--",
    "DM      P=N/1       ; K=     !Kl. Süd/Ost Zeitprogramm", "       GT=Kl. Süd/Ost Zeitprogramm"].join("\n");
  const s = parseDDC3000(W, "x", "x.wwf").schedules[0];
  assert.deepEqual(s.days.map(d => d.entries.map(e => e.time).join("-")), ["05:00-16:00", "06:00-16:00", "06:00-16:00", "06:00-16:00", "06:00-15:00", "", ""]);
});

test("Vorlagen der Schnellparametrierung (makro.sp) ergänzen Art, Einheit und Namen ohne Definitionen", async () => {
  globalThis.localStorage = globalThis.localStorage || { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; } };
  const M = await import("../src/ui/model/d3makro.js");
  /* selbst geschriebene Beispiel-Vorlage im Aufbau der Originale (die echten Dateien gehören K&P und liegen nicht im Repo) */
  const mak = ["#def _ANL Anlage", "#def _RK Regelkreis", "#def _X Zusatz", "K    NR=   ;  TYP=EZR30",
    "AX     P=8230                          ; K=_ANL _RK Temp. Soll Komfort", "       W=20      ; Z=",
    "AI     P=6450                          ; K=_ANL _RK Temp. Raum", "       E=°C      ; Z=   ; SMIN=     ; SMAX=",
    "DS     P=3829                          ; K=! Synchronisation _X", "       W=0       ; Z="].join("\r\n");
  const tab = M.parseMakro(mak);
  assert.deepEqual(tab["8230"], ["AX", "", "Temp. Soll Komfort"]);
  assert.deepEqual(tab["6450"], ["AI", "°C", "Temp. Raum"]);
  assert.deepEqual(tab["3829"], ["DS", "", "Synchronisation Zusatz"]);
  M.clearMakro();
  M.makroTable().files["DDC3000/EZR30"] = tab;
  assert.equal(M.makroDef("EZR31", "6450").name, "Temp. Raum");
  const text = ["t1 1.0.0 32 93 00 ", "t1 1.0.1 16 75 00 Raum 1", "p1 1.0.1 8230/1 21.0 108 0F 00 ", "p1 1.0.1 3829/1 0 0F 00 ", ""].join("\r\n");
  const C = parseP90(text, "EZR", "x.EZR");
  const rk = C.nodes.get("1:RK");
  assert.deepEqual(rk.paras.find(p => p.addr === "8230").texts, ["Temp. Soll Komfort"]);
  assert.deepEqual(rk.paras.find(p => p.addr === "3829").texts, ["Synchronisation Zusatz"]);
  M.clearMakro();
});

test(".p90 → .PRO (wie SPClientDDC: t1/m1/p1, CP850)", async () => {
  const { toPro } = await import("../src/ui/p90/backup.js");
  const link = new P90Link(new SimDDC());
  const r = await createBackup(link, { definitions: true });
  await link.close();
  const bytes = toPro(r.text);
  const t = cp850.decode(bytes);
  const lines = t.split("\r\n");
  assert.equal(lines[0], "t1 1.2.0 32 96 00 ");
  assert.ok(lines.includes("t1 1.2.1 31 110 00 "));
  assert.ok(lines.includes("p1 1.2.1 5100/1 28.5 108 0F 00 WT Becken Zulüfter Soll"));
  assert.ok(!/^(#|\[|D1 )/m.test(t), "keine Kopfzeilen/Definitionen");
  assert.ok(bytes.includes(0x81), "ü als CP850-Byte 0x81");
  /* und wieder einlesbar wie eine .EZR */
  const back = parseBackup(new TextDecoder("windows-1252").decode(bytes));
  assert.equal(back.devices.length, 4);
  assert.equal(back.devices[1].values.length, 22);
});

test(".p90 → .wwf für SPEnterprise: Aufbau wie das Original, wieder eingelesen dasselbe Modell", async () => {
  const { toWwf } = await import("../src/ui/model/p90.js");
  const { parseDDC3000 } = await import("../src/ui/model/ddc3000.js");
  const link = new P90Link(new SimDDC({ demo: true }));
  const r = await createBackup(link, { definitions: true });
  await link.close();
  const L = toWwf(r.text, "Demo Halle");
  assert.equal(L.length, 1);
  const w = L[0].rtf;
  assert.match(w, /^\{\\rtf1\\ansi\\ansicpg1252\\deff0\{\\fonttbl\{\\f0\\fmodern\\fprq1\\fcharset0 Courier New;\}\}\r\n/);
  assert.ok(w.includes("Z      NR=2    ; TYP=DDC3000    ; K=Demo Halle\\par\r\n"));
  assert.ok(w.includes("AI      P=b1        ; K=     !Au\\'dfentemperatur\\par\r\n        E=\\'b0C   ; Z=     ; SMIN=     ; SMAX=\\par\r\n"));
  assert.ok(w.includes("       V2=2.0 T1/1Nand   ; T2=\\par"));
  assert.ok(w.includes("       TZ=E 0:00:30      ; T2=\\par"));
  assert.ok(w.includes("DM      P=N         ; K=     !L\\'fcftung Halle\\par"));
  assert.ok(w.endsWith("}\r\n\0"));
  assert.ok(!/[^\x00-\x7f]/.test(w), "nur ASCII, Umlaute als \\'xx");
  const sig = C => ({ pins: C.pins.map(p => p.klemme + ":" + p.kind + ":" + p.name).sort(), edges: C.edges.map(e => e.from + ">" + e.to + "." + e.toPara + (e.inv ? "!" : "")).sort(), sched: C.schedules.map(s => JSON.stringify(s.days)) });
  assert.deepEqual(sig(parseDDC3000(w, "x", "x.wwf")), sig(parseP90(r.text, "x", "x.p90")));
});

test(".wwf für SPEnterprise: nichts, woran das Übersetzen hängen bleibt", async () => {
  const { toWwf } = await import("../src/ui/model/p90.js");
  const text = [
    "# P90-Sicherung (Kieback&Peter DDC3000)", "# Zeichensatz: UTF-8 (Klartexte der DDC aus CP850 umgewandelt)", "",
    "[Gerät 1.3.0 DDC3200 32 96]",
    "m1 1.3.0 69/1 03", "m1 1.3.0 117/1 03", "m1 1.3.0 116/1 03",
    "p1 1.3.0 b1/1 12.5 108 0F 00 Außen_Fühler",
    "p1 1.3.0 1207/1 1 0 0F 00 Task Betriebszustand",
    "p1 1.3.0 2030/1 0 0 0F 00 ",
    "p1 1.3.0 Y2/1 000.000 0000/00 N --- 0F 00 ",
    "p1 1.3.0 Y3/1 001.000 b1/01 N --- 0F 00 ",
    "p1 1.3.0 1014/1 06:00-14:00 --- --- --- 0F 00 ",
    "p1 1.3.0 1015/1 06:00-14:00 15:00-18:00 --- --- 0F 00 ",
    "p1 1.3.0 501/1 PAN 0000 31.12-01.01 0F 00 ",
    "p1 1.3.0 502/1 --- 0F 00 ",
    "",
    "[Gerät 1.3.1 EZR30 16 1]",
    "m1 1.3.1 74/1 03",
    "p1 1.3.1 1014/1 07:00-16:00 --- --- --- 0F 00 ",
    ""
  ].join("\r\n");
  const w = toWwf(text, "DDC-Sicherung 2026-11-10_08-52")[0].rtf.replace(/\\par\r\n/g, "\n");
  assert.ok(!w.includes("_"), "kein Unterstrich (Platzhalter in SPEnterprise)");
  assert.match(w, /^Z {6}NR=3 {4}; TYP=DDC3000 {4}; K=DDC-Sicherung 2026-11-10 08-52$/m);
  assert.match(w, /!Au\\'dfen F\\'fchler/);
  assert.doesNotMatch(w, /P=(1207|2030)\b/, "Systemparameter, die SPEnterprise ablehnt");
  assert.doesNotMatch(w, /000\.000|0\.0 0\/0/, "leere Verknüpfung nicht als Quelle");
  assert.match(w, /V1=1\.0 b1\/1N/);
  assert.doesNotMatch(w, /P=(1014|1015|501|502)\b/, "Nutzzeiten/Jahresprogramm nicht als Parameter");
  /* Wochenprogramm direkt hinter seinem Menü 117/x, Jahresprogramm hinter 116/x */
  const iM117 = w.indexOf("M      NR=117/1"), iN = w.indexOf("N      NR=1"), iM116 = w.indexOf("M      NR=116/1"), iJ = w.indexOf("J      NR=1");
  assert.ok(iM117 >= 0 && iM117 < iN && iN < iM116 && iM116 < iJ, "Reihenfolge M117 → N → M116 → J");
  assert.match(w, /BEG1=06:00 =06:00 =--:--/);
  assert.match(w, /BEG2=--:-- =15:00 =--:--/);
  assert.match(w, /JDP01=31\.12  =01\.01      =A        =N        =0000/);
  /* Raumregler: eigenes Wochenprogramm hinter Menü 74/x */
  const iK = w.indexOf("K      NR=1"), iM74 = w.indexOf("M      NR=74/1"), iN2 = w.indexOf("N      NR=1", iK);
  assert.ok(iK > 0 && iK < iM74 && iM74 < iN2);
  assert.match(w.slice(iN2), /BEG1=07:00 =--:--/);
});

test(".wwf: Regeln der Schnellparametrierung (Grenzen, „-“, Textlänge, Regelkreis-Definitionen)", () => {
  const p90 = [
    "# P90-Sicherung (Kieback&Peter DDC3000)", "",
    "[Gerät 1.1.0 DDC3200 32 96]", "t1 1.1.0 32 96 00 D3200",
    "p1 1.1.0 1090/1 6 0F 00 ", "p1 1.1.0 1422/1 10 0 0F 04 ", "p1 1.1.0 1511/1 0 0 0F 00 1.0.0/0",
    'p1 1.1.0 2119/1 "Disconnect          0000" 0F 00 ',
    "[Gerät 1.1.3 HEIZUNG 31 111]", "t1 1.1.3 31 111 00 HEIZUNG",
    "p1 1.1.3 5125/1 0 12 0F 80 Vorhalt", "p1 1.1.3 5169/1 6.1 108 0F 00 ", "",
    "[Definitionen 1.1.0 D0 Parameterdefinitionen]",
    "D1 32 1090 3 80 127 0 0 0 03 0F 0000 SyM: Sub-Bus",
    "D1 32 1422 2 02 999 1 10 0 03 0F 0000 Alarm-Verbindung",
    "D1 32 1511-1520 2 07 100000000 0 0 0 43 0F 0000 Z-Bus Top-20 #%(1)",
    "D1 32 2119 4 10 - - - 0 43 0F 0000 Modem Zustand",
    "D1 32 5125 2 02 299 1 20 12 A3 0F 0000 Vorhalt",
    "D1 32 5169 1 8B 100.00 -50.00 0.00 108 42 0F 0000 TAmittel",
    ""
  ].join("\r\n");
  const t = toWwf(p90, "T")[0].rtf.replace(/\r/g, "").replace(/\\par\n?/g, "\n");
  assert.match(t, /AX {6}P=1090 [^\n]*\n {8}W=6 [^\n]*\n {7}UG= {5}; OG=\n/, "Format 0x80 → keine Grenzen");
  assert.match(t, /P=1422 [^\n]*\n[^\n]*\n {7}UG=1 {4}; OG=999/);
  assert.doesNotMatch(t, /P=1511/, "Z-Bus-Statistik weglassen");
  assert.match(t, /TX {6}P=2119\n {8}W=Disconnect\n/, "höchstens 16 Zeichen");
  assert.match(t, /AX {6}P=5125 [^\n]*\n {8}W=- {4}; E=s/, "Status 0x80 → „-“");
  assert.match(t, /AI {6}P=5169 {6}; K= {5}!TAmittel/, "Regelkreis nutzt die Definitionen der Zentrale");
});
