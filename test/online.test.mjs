/* Verknüpfung Online → Datenpunkte: Der Dienst wird im Browser nachgebildet,
   die gelesenen Live-Werte müssen danach in der Datenpunkt-Liste stehen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIXTURE = path.join(ROOT, "test", "fixtures", "beispiel-datasave.xml");

const API = {
  "/api/health": { ok: true, service: "DDC-Werkbank", version: "test", data: true },
  "/api/config": { centrals: [], settings: {} },
  "/api/identify": { ok: true, inst: 4012, name: "Z12_Halle", model: "DDC4200", firmware: "1.9.3", software: "", vendor: 7 },
  "/api/live": { ok: true, values: [{ type: 0, inst: 1, ok: true, value: 22.75 }] },
  "/api/data/befunde": { ok: true, data: null }, "/api/data/verknuepfung": { ok: true, data: null }, "/api/data/einstellungen": { ok: true, data: null }
};

test("Live-Werte aus Online erscheinen in den Datenpunkten, Trennen räumt sie weg", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("http://localhost:47902/**", route => {
      const p = new URL(route.request().url()).pathname;
      route.fulfill({ contentType: "application/json", body: JSON.stringify(API[p] || { ok: false, err: "unbekannt" }) });
    });
    await page.goto("file://" + HTML);
    await page.setInputFiles("#fileIn", FIXTURE);
    await page.waitForFunction(() => document.body.innerText.includes("Testzentrale Halle"));
    await page.click(".nav-item:has-text('Online')");
    await page.fill("input[placeholder^='z. B.']", "192.168.24.210");
    await page.click("button:has-text('Verbinden')");
    await page.waitForFunction(() => document.body.innerText.includes("1 von 1 Objekten antworten"));
    await page.click(".nav-item:has-text('Datenpunkte')");
    const row = await page.innerText("tr[data-uid='001/00/00/P.01']");
    assert.match(row, /22,8 °C/);

    // Trennen: Verbindung weg, Live-Werte aus den Datenpunkten entfernt
    await page.click(".nav-item:has-text('Online')");
    await page.click("button:has-text('Trennen')");
    await page.waitForFunction(() => document.body.innerText.includes("Nicht verbunden"));
    assert.equal(await page.locator("button:has-text('Trennen')").count(), 0);
    await page.click(".nav-item:has-text('Datenpunkte')");
    assert.doesNotMatch(await page.innerText("tr[data-uid='001/00/00/P.01']"), /22,8 °C/);

    // Erneut verbinden geht
    await page.click(".nav-item:has-text('Online')");
    await page.click("button:has-text('Verbinden')");
    await page.waitForFunction(() => document.body.innerText.includes("1 von 1 Objekten antworten"));
    assert.equal(await page.locator("button:has-text('Trennen')").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
