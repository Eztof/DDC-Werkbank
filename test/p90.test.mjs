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
import { parseP1, parseP90 } from "../src/ui/model/p90.js";

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
