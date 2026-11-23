/* Wartungsdoku: Beispiel-Sicherung + Beispiel-WTGML laden, alle Reiter öffnen,
   Verknüpfung Doku ↔ Datenpunkte prüfen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIX = f => path.join(ROOT, "test", "fixtures", f);

test("Wartungsdoku: alle Reiter, Verknüpfung zu den Datenpunkten", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", d => d.accept());
    await page.goto("file://" + HTML);
    await page.setInputFiles("#fileIn", [FIX("beispiel-datasave.xml"), FIX("beispiel-wartung.wtgml")]);
    await page.waitForFunction(() => document.body.innerText.includes("Testzentrale Halle"));
    await page.click(".nav-item[data-view='wartung']");
    const tabs = await page.$$eval(".pivot button[data-tab]", b => b.map(x => x.dataset.tab));
    assert.ok(tabs.length >= 5, "Reiter fehlen: " + tabs.join(","));
    for (const t of tabs) {
      await page.click(`.pivot button[data-tab='${t}']`);
      await page.waitForTimeout(150);
      assert.deepEqual(errors, [], "Fehler im Reiter " + t);
    }
    await page.click(".pivot button[data-tab='doc']");
    const vals = await page.$$eval("#content input, #content textarea", els => els.map(e => e.value).join("|") + "|" + document.querySelector("#content").innerText);
    assert.match(vals, /RLT1 Zulufttemperatur/);
    await page.click(".nav-item[data-view='points']");
    const head = await page.innerText(".grid thead");
    assert.match(head, /Wartungsdoku/, "Spalte Wartungsdoku fehlt");
    const row = await page.innerText("tr[data-uid='001/00/00/P.01']");
    assert.match(row, /RLT 1 Halle/);
    await page.click("tr[data-uid='001/00/00/P.01']");
    await page.click(".drawer button:has-text('In der Wartungsdoku')");
    await page.waitForSelector(".pivot button[data-tab='doc'].on");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("Wartungsdoku: Fühlerkorrektur beim Abhaken wahlweise als Bemerkung", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", d => d.accept());
    await page.goto("file://" + HTML);
    await page.setInputFiles("#fileIn", [FIX("beispiel-datasave.xml"), FIX("beispiel-wartung.wtgml")]);
    await page.waitForFunction(() => document.body.innerText.includes("Testzentrale Halle"));
    const tick = async val => {
      await page.click(".nav-item[data-view='points']");
      await page.click("tr[data-uid='001/00/00/P.01']");
      await page.click(".drawer button:has-text('In der Wartungsdoku')");
      await page.waitForSelector(".pivot button[data-tab='doc'].on");
      await page.waitForFunction(() => [...document.querySelectorAll("#content tr")].some(tr => [...tr.querySelectorAll("input")].some(i => i.value === "RLT1 Zulufttemperatur")));
      await page.evaluate(v => {
        const tr = [...document.querySelectorAll("#content tr")].find(tr => [...tr.querySelectorAll("input")].some(i => i.value === "RLT1 Zulufttemperatur"));
        const sel = tr.querySelector("select.exsel"); sel.value = v; sel.dispatchEvent(new Event("change"));
      }, val);
      await page.waitForTimeout(150);
    };
    const opt = () => page.locator(".wd-korrbem input");
    /* aus (Vorgabe): nichts eingetragen */
    await page.click(".nav-item[data-view='wartung']");
    assert.equal(await opt().isChecked(), false);
    await tick("Ja");
    assert.doesNotMatch(await page.evaluate(() => DDCWerkbank.wartung.text()), /Fühlerkorrektur/);
    await tick("");
    /* an: Korrektur der verknüpften Klemme (+0,5 K) steht in der Bemerkung – einmal */
    await opt().check();
    await tick("Ja");
    await tick("");
    await tick("Ja");
    const t = await page.evaluate(() => DDCWerkbank.wartung.text());
    assert.match(t, /<jobBemerkung>[^<]*Fühlerkorrektur \+0[,.]5 K/);
    assert.equal((t.match(/Fühlerkorrektur/g) || []).length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
