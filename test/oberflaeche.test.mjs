/* Rauchtest: gebaute Oberfläche im Browser öffnen, Beispiel-Sicherung laden,
   jede Ansicht einmal anklicken. Schlägt fehl bei JavaScript-Fehlern. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIXTURE = path.join(ROOT, "test", "fixtures", "beispiel-datasave.xml");

test("alle Ansichten öffnen ohne Fehler", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("file://" + HTML);
    await page.setInputFiles("#fileIn", FIXTURE);
    await page.waitForFunction(() => document.body.innerText.includes("Testzentrale Halle"));
    const n = (await page.$$(".nav-item")).length;
    assert.ok(n >= 8, "Navigation unvollständig: " + n);
    /* Titel „Nr: Zentralenname“ (aus dem Dateikopf) im Auswahlfeld oben und auf der Startkarte */
    assert.equal(await page.$eval("#tbStation option:checked", o => o.textContent), "12: Testzentrale Halle");
    await page.click(".nav-item:has-text('Start')");
    assert.equal(await page.$eval(".card .station .nm", e => e.textContent), "12: Testzentrale Halle");
    assert.equal(await page.$$eval(".nav-item", els => els.some(e => /Vergleich/.test(e.textContent))), false, "Vergleich noch in der Navigation");
    for (let i = 0; i < n; i++) {
      const item = (await page.$$(".nav-item"))[i];
      const label = (await item.textContent()).trim();
      await item.click();
      await page.waitForTimeout(200);
      assert.deepEqual(errors, [], "Fehler in Ansicht „" + label + "“");
    }
    await page.click(".nav-item:has-text('Datenpunkte')");
    const text = await page.innerText("#app");
    assert.match(text, /RLT1 Zulufttemperatur/);
    assert.match(text, /RLT1 Heizventil/);
  } finally {
    await browser.close();
  }
});
