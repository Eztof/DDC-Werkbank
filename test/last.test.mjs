/* Lasttest: große künstliche Sicherung (60 Module, ~1.900 Klemmen) laden,
   jede Ansicht muss zügig aufgehen; Sprung zu einer Klemme weit unten in der
   Liste und Strg+F (Liste vollständig) müssen funktionieren. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { grosseSicherung } from "./lib/gross-sicherung.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");

test("große Sicherung: Laden und Ansichten in vertretbarer Zeit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddcwb-"));
  const file = path.join(dir, "datasave.xml");
  fs.writeFileSync(file, grosseSicherung(60));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("file://" + HTML);
    let t = Date.now();
    await page.setInputFiles("#fileIn", file);
    await page.waitForFunction(() => document.body.innerText.includes("Lasttest Klinikum"), null, { timeout: 60000 });
    const times = { laden: Date.now() - t };
    for (const v of ["overview", "points", "program", "findings", "sched", "wartung", "online"]) {
      t = Date.now();
      await page.click(`.nav-item[data-view='${v}']`);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
      times[v] = Date.now() - t;
    }
    console.log("Zeiten (ms):", JSON.stringify(times));
    for (const [k, ms] of Object.entries(times)) assert.ok(ms < 4000, `${k} zu langsam: ${ms} ms`);

    /* Datenpunkte: Liste wird schrittweise gebaut, Strg+F zeichnet den Rest */
    await page.click(".nav-item[data-view='points']");
    const before = await page.$$eval(".grid tbody tr", r => r.length);
    assert.ok(before < 1900, "Liste sollte schrittweise aufgebaut werden (" + before + " Zeilen sofort)");
    await page.keyboard.press("Control+f");
    const after = await page.$$eval(".grid tbody tr", r => r.length);
    assert.ok(after > 1500, "nach Strg+F nicht vollständig: " + after);

    /* Sprung aus der Suche zu einer Klemme weit unten */
    await page.fill(".tb-search input", "RLT58_TF_04");
    await page.waitForSelector(".search-pop .it");
    await page.click(".search-pop .it >> nth=0");
    await page.waitForSelector("tr.on[data-uid='058/00/00/P.04']");
    assert.ok(await page.isVisible("tr.on[data-uid='058/00/00/P.04']"));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
