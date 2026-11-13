/* Reiter „DDC3000 sichern“ im Demo-Modus: Sicherung läuft, Ergebnis öffnet
   sich als Zentrale, alle Ansichten gehen ohne Fehler; .p90 lässt sich auch
   als Datei öffnen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");

test("DDC3000 sichern (Demo) → öffnen → alle Ansichten", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("file://" + HTML);
    await page.click(".nav-item:has-text('DDC3000 sichern')");
    await page.waitForSelector("text=Noch keine Sicherung gelesen");
    await page.click("label:has-text('Demo-Modus') input");
    await page.click("button:has-text('Demo-Sicherung starten')");
    await page.waitForSelector("button:has-text('In der Werkbank öffnen')", { timeout: 60000 });
    assert.match(await page.innerText(".page-body"), /Fertig: 4 Geräte/);
    assert.match(await page.innerText(".page-body"), /SBM45/);
    /* Herunterladen liefert die .p90 */
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Herunterladen')")]);
    assert.match(dl.suggestedFilename(), /^DDC-Sicherung_.*\.p90$/);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p90-")), dl.suggestedFilename());
    await dl.saveAs(file);
    assert.match(fs.readFileSync(file, "utf8"), /^# P90-Sicherung/);
    /* .wwf für SPEnterprise */
    const [dw] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Als .wwf für SPEnterprise')")]);
    assert.match(dw.suggestedFilename(), /\.wwf$/);
    const wf = path.join(path.dirname(file), dw.suggestedFilename());
    await dw.saveAs(wf);
    assert.match(fs.readFileSync(wf, "latin1"), /^\{\\rtf1[\s\S]*Z      NR=2    ; TYP=DDC3000/);
    await page.click("button:has-text('In der Werkbank öffnen')");
    await page.waitForFunction(() => /^2: /.test((document.querySelector("#tbStation option:checked") || {}).textContent || ""));
    const n = (await page.$$(".nav-item")).length;
    for (let i = 0; i < n; i++) {
      const item = (await page.$$(".nav-item"))[i];
      const label = (await item.textContent()).trim();
      await item.click();
      await page.waitForTimeout(150);
      assert.deepEqual(errors, [], "Fehler in Ansicht „" + label + "“");
    }
    await page.click(".nav-item:has-text('Datenpunkte')");
    const text = await page.innerText("#app");
    assert.match(text, /Außentemperatur/);
    assert.match(text, /Rücklauf Heizung/);
    /* dieselbe Datei noch einmal über „Öffnen“ → „bereits geladen“, keine Fehler */
    await page.setInputFiles("#fileIn", file);
    await page.waitForSelector("text=bereits geladen");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("DDC3000 sichern: DDC antwortet nicht → klare Meldung, keine leere Datei", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__saved = 0;
      const port = {
        getInfo: () => ({ usbVendorId: 0x067b, usbProductId: 0x2303 }), readable: null, writable: null,
        async open() { this.readable = new ReadableStream({ start() {} }); this.writable = new WritableStream({ write() {} }); },
        async setSignals() {}, async close() {}
      };
      Object.defineProperty(navigator, "serial", { value: { getPorts: async () => [port], requestPort: async () => port } });
      /* Dateidialog, der nie zurückkommt – darf den Start nicht aufhalten */
      window.showSaveFilePicker = () => new Promise(() => {});
    });
    await page.goto("file://" + HTML);
    await page.click(".nav-item:has-text('DDC3000 sichern')");
    await page.waitForSelector("button:has-text('Sicherung starten'):not([disabled])");
    await page.click("button:has-text('Sicherung starten')");
    await page.waitForSelector("text=COM-Port öffnen", { timeout: 3000 });
    await page.waitForSelector("text=Die DDC antwortet nicht", { timeout: 40000 });
    const t = await page.innerText(".page-body");
    assert.match(t, /Keine Verbindung zur DDC/);
    assert.match(t, /Klemme 58 → Pin 2/);
    assert.equal(await page.$("button:has-text('In der Werkbank öffnen')"), null);
    assert.equal(await page.$("button:has-text('Herunterladen')"), null, "keine leere .p90");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("Ordner mit .p90 und .wwf laden: Zentralen heißen nach Datei bzw. Namen in der .wwf, nicht nach dem Ordner", async () => {
  const { P90Link } = await import("../src/ui/p90/link.js");
  const { createBackup } = await import("../src/ui/p90/backup.js");
  const { SimDDC } = await import("../src/ui/p90/sim.js");
  const { toWwf } = await import("../src/ui/model/p90.js");
  const link = new P90Link(new SimDDC({ demo: true }));
  const r = await createBackup(link, { definitions: true });
  await link.close();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wb-ordner-")), "wwf");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "DDC-Sicherung_2026-11-12_12-21.p90"), r.text);
  fs.writeFileSync(path.join(dir, "Heizzentrale_Z2.wwf"), toWwf(r.text, "Heizzentrale Nord")[0].rtf, "latin1");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("file://" + HTML);
    await page.setInputFiles("#dirIn", dir);
    await page.waitForFunction(() => document.querySelectorAll("#tbStation option").length >= 2);
    const names = await page.$$eval("#tbStation option", L => L.map(o => o.textContent.trim()));
    assert.ok(names.some(n => n.startsWith("2: DDC-Sicherung_2026-11-12_12-21")), "P90: Dateiname im Titel – " + names.join(" | "));
    assert.ok(names.some(n => n.startsWith("2: Heizzentrale Nord")), ".wwf: Name aus der Datei – " + names.join(" | "));
    assert.ok(!names.some(n => /^2: wwf\b/.test(n)), "Ordnername darf nicht der Titel sein – " + names.join(" | "));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
