/* Wartungsdoku, Reiter „Dokument“: Farben in der Leiste (offen / fertig ohne Mangel / fertig mit Mangel)
   und ISP-Kommentar (<ispComment><title/><body/></ispComment>) bearbeiten und zurückschreiben. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIX = f => path.join(ROOT, "test", "fixtures", f);

test("Wartungsdoku: Statusfarben und ISP-Kommentar", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", d => d.accept());
    await page.goto("file://" + HTML);
    await page.setInputFiles("#fileIn", [FIX("beispiel-wartung.wtgml")]);
    await page.click(".nav-item[data-view='wartung']");
    await page.click(".pivot button[data-tab='doc']");
    const states = () => page.$$eval(".rail .rail-item", els => els.map(e => (e.className.match(/st-(\w+)/) || [])[1]));
    const st0 = await states();
    assert.ok(st0.length >= 2 && st0.every(Boolean), "Statusklassen fehlen: " + st0);
    assert.equal(st0[0], "open", "ISP mit offenen Prüfungen muss rot sein");
    assert.doesNotMatch(await page.innerText("#content"), /Anlagenzustand/);

    // ISP wählen, alles auf Ja → grün (kein Mangel); Gesamtzustand/Kommentar ändern die Farbe nicht
    await page.click(".rail .rail-item >> nth=0");
    await page.click("button:has-text('Alle offenen Prüfungen: Ja')");
    assert.ok((await states()).every(s => s === "ok"), "fertig ohne Mangel muss grün sein: " + await states());
    // ein Mangel → Anlage und ISP rot
    await page.click(".rail .rail-item >> nth=1");
    await page.selectOption("select.exsel >> nth=0", "Mangel");
    const st1 = await states();
    assert.equal(st1[0], "mangel"); assert.equal(st1[1], "mangel");
    await page.click(".rail .rail-item >> nth=0");

    // ISP-Kommentar eintragen → grün, im XML an der richtigen Stelle
    await page.fill(".wd-zustand textarea", "Wartung durchgeführt <&> alles gut");
    const xml = await page.evaluate(() => DDCWerkbank.wartung.text());
    assert.match(xml, /<\/facility>\s*<ispComment>\s*<title>Wartung<\/title>\s*<body>Wartung durchgeführt &lt;&amp;&gt; alles gut<\/body>\s*<\/ispComment>\s*<\/Isp>/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
