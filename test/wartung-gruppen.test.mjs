/* Wartungsdoku: automatische Gruppierung nach Bezeichnung, Module (SBM/FBM/Raumregler) bei der Station,
   Eingabefeld „Typ“ im Info-Feld. Nur künstliche Daten. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIX = f => path.join(ROOT, "test", "fixtures", f);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ddcwb-wartung-"));

async function open(files) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto("file://" + HTML);
  await page.setInputFiles("#fileIn", files);
  await page.waitForFunction(() => window.DDCWerkbank.state.centrals.length >= 1);
  return { browser, page, errors };
}

test("Gruppierung nach Bezeichnung: Ortsvorsatz, Abkürzung, Tippfehler, Signalwörter", async () => {
  const f = path.join(TMP, "gruppen.p90");
  fs.writeFileSync(f, [
    "# P90-Sicherung (Kieback&Peter DDC3000)", "# Zeichensatz: UTF-8 (Klartexte der DDC aus CP850 umgewandelt)", "",
    "[Gerät 1.5.0 DDC3002 32 96]",
    "p1 1.5.0 b1/1 70.0 108 0F 00 BR DT BHKW Temp. Vorlauf",
    "p1 1.5.0 b2/1 50.0 108 0F 00 BR DT BHKW Temp. Rücklauf",
    "p1 1.5.0 k1/1 1 0F 00 BHKW Betrieb Teillast",
    "p1 1.5.0 b3/1 71.0 108 0F 00 Hydr. Weiche Primär Temp. Vorlauf",
    "p1 1.5.0 b4/1 45.0 108 0F 00 Hydr. Weiche sek. Temp. RL",
    "p1 1.5.0 b5/1 48.0 108 0F 00 Küche WWB Temp. unten",
    "p1 1.5.0 b6/1 58.0 108 0F 00 Kücke WWB Temp. oben",
    "p1 1.5.0 k2/1 0 0F 00 Küche WWB Ladepumpe Anf.",
    "p1 1.5.0 k3/1 0 0F 00 Notstromaggregat Betrieb",
    "p1 1.5.0 k4/1 0 0F 00 Notstromaggregat Störung",
    "p1 1.5.0 k5/1 0 0F 00 DT Notstromaggr. Betrieb",
    "p1 1.5.0 k6/1 0 0F 00 KONTAKT 6",
    "p1 1.5.0 y8/1 60.0 108 0F 00 Anf.Soll Fernw.",
    "p1 1.5.0 k7/1 0 0F 00 Anf.Fernpumpe BT-D",
    "p1 1.5.0 k8/1 0 0F 00 Altbau Schaltschr Ausfall Steuerspannung Störung",
    ...Array.from({ length: 10 }, (_, i) => `p1 1.5.0 b${20 + i}/1 20.0 108 0F 00 BT.C Kantine RLT Temp. ${i + 1}`),
    ...Array.from({ length: 4 }, (_, i) => `p1 1.5.0 b${30 + i}/1 20.0 108 0F 00 BT.C Küche RLT Temp. ${i + 1}`),
    "",
    "[Gerät 1.5.810 FBM14 29 83]",
    "p1 1.5.810 b1/1 44.2 150 0F 00 Öltank 1",
    "p1 1.5.810 b2/1 47.8 150 0F 00 Öltank 2",
    "p1 1.5.810 b3/1 42.1 150 0F 00 Tagestank Notstrom",
    "",
    "[Gerät 1.5.811 FBM14 29 83]",
    "p1 1.5.811 k1/1 0 0F 01 Öl Leckanlage Störung",
    "",
    "[Gerät 1.5.812 FBM14 29 83]",
    "p1 1.5.812 k1/1 0 0F 00 BT.C Kesselanl. Fernpumpe BT.D Störung",
    "p1 1.5.812 k2/1 0 0F 00 BT.C Kesselanl. Fernpumpe BT.D Betrieb",
    "p1 1.5.812 k3/1 0 0F 00 BT.C Pumpensumpf    Ölmelder",
    "p1 1.5.812 k4/1 0 0F 00 BT.C Benzinabscheider",
    ""
  ].join("\r\n"));
  const { browser, page, errors } = await open([f]);
  try {
    await page.click(".nav-item[data-view='wartung']");
    await page.waitForFunction(() => Object.keys(window.DDCWerkbank.state.wd || {}).length >= 1);
    const groups = await page.evaluate(() => {
      const A = window.DDCWerkbank.state, C = A.centrals[0], W = A.wd[C.cid];
      return Object.fromEntries(W.groups.map(g => [g.name, W.pins.filter(p => p.include && p.gid === g.gid).map(p => p.klemme).sort()]).filter(x => x[1].length));
    });
    assert.deepEqual(groups["BR DT BHKW"], ["b1", "b2", "k1"], "„BHKW …“ gehört zu „BR DT BHKW“: " + JSON.stringify(groups));
    assert.deepEqual(groups["Hydr. Weiche"], ["b3", "b4"]);
    assert.deepEqual(groups["Küche WWB"], ["b5", "b6", "k2"], "Tippfehler „Kücke“");
    assert.deepEqual(groups["Notstromaggregat"], ["k3", "k4", "k5"], "„DT Notstromaggr.“ = Notstromaggregat");
    assert.deepEqual(groups["Weitere Datenpunkte"], ["k6"]);
    assert.deepEqual(groups["Fernw."], ["812/k1", "812/k2", "k7", "y8"], "Fernw., Fernpumpe BT-D und Kesselanl. Fernpumpe BT.D = Fernwärme");
    assert.deepEqual(groups["BT.C Benzinabscheider"], ["812/k4"], "Einzelstücke unter reiner Ortsangabe nicht zusammenwerfen");
    assert.deepEqual(groups["BT.C Pumpensumpf"], ["812/k3"]);
    assert.deepEqual(groups["BT.C Kantine RLT"].length, 10);
    assert.deepEqual(groups["Öltank"], ["810/b1", "810/b2", "810/b3", "811/k1"], "Tagestank auf dem Öltank-Modul, „Öl Leckanlage“");
    assert.deepEqual(groups["Allgemein"], ["k8"], "Schaltschrank-Störung");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("Module bei der Station und Feld „Typ“ im Info-Feld (ältere Dokus bleiben gültig)", async () => {
  const xml = fs.readFileSync(FIX("beispiel-datasave.xml"), "utf8")
    .replace("</Central>", '<Module Addr="201" Type="FBM45" ResInfo="Active"><Text>FBM45 Lüftung Halle</Text></Module>' +
      '<Module Addr="301" Type="BACnet" ResInfo="Inactive"><Text>Partner</Text></Module></Central>');
  const f = path.join(TMP, "datasave.xml");
  fs.writeFileSync(f, xml);
  const { browser, page, errors } = await open([f, FIX("beispiel-wartung.wtgml")]);
  try {
    await page.waitForFunction(() => document.body.innerText.includes("Testzentrale Halle"));
    await page.click(".nav-item[data-view='wartung']");

    /* Aus Sicherung übernehmen: FBM ja, BACnet-Partner und interne E/A nein */
    await page.click(".pivot button[data-tab='gen']");
    assert.match(await page.innerText("#content"), /Module bei der Station aufführen \(1\)/);

    /* Dokument: bestehende Doku ohne Module → „Module ergänzen“ */
    await page.click(".pivot button[data-tab='doc']");
    await page.click(".rail .rail-item >> nth=0");
    await page.click("#content button:has-text('Module ergänzen (1)')");
    let doc = await page.evaluate(() => DDCWerkbank.wartung.text());
    assert.match(doc, /<facBezeichnung>Module<\/facBezeichnung>\s*<Artikel active="true" sortId="1">\s*<nummer>FBM45<\/nummer>/);
    assert.match(doc, /<value>Zentrale \d+ · Modul 201<\/value>/);
    assert.match(doc, /<artBezeichnung>Feldbusmodul<\/artBezeichnung>\s*<artKlartext>Lüftung Halle<\/artKlartext>/);
    assert.doesNotMatch(doc, /<nummer>(BACnet|IO_Modul)<\/nummer>/);
    assert.equal(await page.$("#content button:has-text('Module ergänzen')"), null, "nichts mehr zu ergänzen");

    /* Typ: „Typ: … · Klemme …“, ohne Typ wieder genau wie vorher */
    await page.click(".rail .rail-item:has-text('RLT 1 Halle')");
    const ty = page.locator("#content table.wdoc tbody tr input[placeholder='Typ']").first();
    await ty.fill("PT1000");
    await ty.press("Tab");
    doc = await page.evaluate(() => DDCWerkbank.wartung.text());
    assert.match(doc, /<value>Typ: PT1000 · Klemme 001\/P\.01<\/value>/);
    await page.click(".pivot button[data-tab='link']");
    assert.match(await page.innerText("#content"), /2 \/ 2/, "Klemme wird mit Typ weiter erkannt");
    await page.click(".pivot button[data-tab='doc']");
    const ty2 = page.locator("#content table.wdoc tbody tr input[placeholder='Typ']").first();
    assert.equal(await ty2.inputValue(), "PT1000");
    await ty2.fill("");
    await ty2.press("Tab");
    doc = await page.evaluate(() => DDCWerkbank.wartung.text());
    assert.match(doc, /<value>Klemme 001\/P\.01<\/value>/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("Programm-Klemme mit fremder Bezeichnung bekommt ihre eigene Gruppe (Ablüfter in „Lüftung Saal“)", async () => {
  const pin = (a, txt, sub, typ, para, src) => `<Object Addr="P.${a}" Type="P"><Text>${txt}</Text><Para Addr="1"><Value Type="Int">1</Value></Para>` +
    `<SubObj Addr="${sub}.01" Type="${sub}"><Para Addr="${para}"><Value Type="Bool">0</Value>` +
    (src ? `<FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">${src}</Value></Para></FuncObj>` : "") + `</Para></SubObj></Object>`;
  const xml = fs.readFileSync(FIX("beispiel-datasave.xml"), "utf8")
    .replace(/RLT1 /g, "RLT 1 ")
    .replace('<Object Addr="P.05" Type="P"><Text>Reserve</Text>',
      pin("06", "Lager Ablüfter Betrieb", "CDI", "CDI", "k") +
      pin("07", "Lager Ablüfter Freigabe", "CDO", "CDO", "K", "//001/01/01/M.02/Y") +
      pin("08", "Lager Abluft BSK 1", "CDI", "CDI", "k") +
      pin("09", "Heizkreis Nord Pumpe Freigabe", "CDO", "CDO", "K", "//001/02/01/M.01/Y") +
      '<Object Addr="P.05" Type="P"><Text>Reserve</Text>')
    .replace('<Object Addr="R.01" Type="S066">',
      '<Object Addr="M.02" Type="M"><Text>Freigabe Lager</Text><Para Addr="E1"><Text>Betrieb</Text>' +
      '<FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">//001/00/00/P.06/CDI.01/k</Value></Para></FuncObj></Para>' +
      '<Para Addr="Y"><Text>Freigabe</Text><Value Type="Bool">1</Value></Para></Object><Object Addr="R.01" Type="S066">')
    .replace(/<\/Plant>\s*<\/Module>\s*<\/Central>/, '</Plant><Plant Addr="02" Type="HK"><Text>Heizkreis Nord</Text><Group Addr="01" Type="RG"><Text>Regelung</Text>' +
      '<Object Addr="M.01" Type="M"><Text>Pumpe</Text><Para Addr="Y"><Text>Freigabe</Text><Value Type="Bool">1</Value></Para></Object></Group></Plant></Module></Central>');
  const f = path.join(TMP, "fremd.xml");
  fs.writeFileSync(f, xml);
  const { browser, page, errors } = await open([f]);
  try {
    await page.click(".nav-item[data-view='wartung']");
    await page.waitForFunction(() => Object.keys(window.DDCWerkbank.state.wd || {}).length >= 1);
    const groups = await page.evaluate(() => {
      const A = window.DDCWerkbank.state, C = A.centrals[0], W = A.wd[C.cid];
      return Object.fromEntries(W.groups.map(g => [g.name, W.pins.filter(p => p.include && p.gid === g.gid).map(p => p.klemme).sort()]).filter(x => x[1].length));
    });
    assert.deepEqual(groups["Lager"], ["001/P.06", "001/P.07", "001/P.08"], JSON.stringify(groups));
    assert.deepEqual(groups["RLT 1 Halle"], ["001/P.01", "001/P.02", "001/P.03", "001/P.04"]);
    assert.deepEqual(groups["Heizkreis Nord"], ["001/P.09"]);
    /* Papierkorb an einer Gruppe: Datenpunkte nach „Weitere Datenpunkte“, nicht in die erste Gruppe */
    await page.click(".pivot button[data-tab='gen']");
    await page.waitForSelector(".wgrp input.gn");
    await page.evaluate(() => {
      const g = [...document.querySelectorAll(".wgrp")].find(d => d.querySelector("input.gn").value === "Lager");
      g.querySelector("button[title^='Gruppe auflösen']").click();
    });
    const after = await page.evaluate(() => {
      const A = window.DDCWerkbank.state, W = A.wd[A.centrals[0].cid];
      return Object.fromEntries(W.groups.map(g => [g.name, W.pins.filter(p => p.include && p.gid === g.gid).map(p => p.klemme).sort()]).filter(x => x[1].length));
    });
    assert.equal(after["Lager"], undefined);
    assert.deepEqual(after["Weitere Datenpunkte"], ["001/P.06", "001/P.07", "001/P.08"]);
    assert.deepEqual(after["RLT 1 Halle"], ["001/P.01", "001/P.02", "001/P.03", "001/P.04"]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
