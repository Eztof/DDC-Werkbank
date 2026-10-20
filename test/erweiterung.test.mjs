/* Erweiterungen von außen: eine Prüfung, eine Ansicht, eine Datenpunkt-Spalte
   und eine Übersicht-Kachel über window.DDCWerkbankErweiterungen anmelden –
   ohne die Werkbank neu zu bauen. Außerdem: Prüfung ausschalten. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIXTURE = path.join(ROOT, "test", "fixtures", "beispiel-datasave.xml");

test("Erweiterungen über die Schnittstelle", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      window.DDCWerkbankErweiterungen = [function testErweiterung(api) {
        const R = api.register;
        R.CHECKS.add({ id: "test-pruefung", label: "Testprüfung", cat: "Test", run(C, add) { add("warn", null, "Testbefund für " + C.meta.name, "aus einer Erweiterung"); } });
        R.VIEWS.add({ id: "testansicht", label: "Testansicht", icon: "info", group: 3, order: 900, render(root) { root.appendChild(api.ui.h("div", { class: "page-body" }, "Hallo aus der Erweiterung")); } });
        R.PIN_COLUMNS.add({ id: "laenge", label: "Zeichen", order: 35, cls: "num", sort: p => (p.name || "").length, cell: (C, p) => String((p.name || "").length) });
        R.OVERVIEW_TILES.add({ id: "test", order: 5, tile: C => ({ icon: "info", title: "Testkachel", value: C.pins.length }) });
      }];
    });
    await page.goto("file://" + HTML);
    assert.equal(await page.evaluate(() => window.DDCWerkbank.erweiterungen.join(",")), "testErweiterung");
    await page.setInputFiles("#fileIn", FIXTURE);
    await page.waitForFunction(() => document.body.innerText.includes("Testzentrale Halle"));
    assert.match(await page.innerText("#content"), /Testkachel/);

    await page.click(".nav-item[data-view='findings']");
    await page.waitForSelector(".fgroup");
    assert.match(await page.innerText("#content"), /Testbefund für Testzentrale Halle/);

    /* Prüfung ausschalten → Befund verschwindet, wieder einschalten → da */
    await page.click("button:has-text('Prüfungen')");
    await page.click(".flyout .mi:has-text('Testprüfung')");
    assert.doesNotMatch(await page.innerText("#content"), /Testbefund/);
    await page.click("button:has-text('Prüfungen')");
    await page.click(".flyout .mi:has-text('Testprüfung')");
    assert.match(await page.innerText("#content"), /Testbefund/);

    await page.click(".nav-item[data-view='points']");
    assert.match(await page.innerText(".grid thead"), /Zeichen/);

    await page.click(".nav-item[data-view='testansicht']");
    assert.match(await page.innerText("#content"), /Hallo aus der Erweiterung/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("erweiterungen.js neben der HTML wird geladen", async () => {
  const fs = await import("node:fs"), os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddcwb-ext-"));
  fs.copyFileSync(HTML, path.join(dir, "DDC-Werkbank.html"));
  fs.writeFileSync(path.join(dir, "erweiterungen.js"),
    'DDCWerkbank.register.VIEWS.add({ id: "dateiansicht", label: "Aus Datei", icon: "file", group: 3, order: 910, render(root) { root.append("Erweiterung aus Datei"); } });\n');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("file://" + path.join(dir, "DDC-Werkbank.html"));
    await page.click(".nav-item[data-view='dateiansicht']");
    assert.match(await page.innerText("#content"), /Erweiterung aus Datei/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
