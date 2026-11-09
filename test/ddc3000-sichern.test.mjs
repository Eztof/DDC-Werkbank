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
