/* Online „K&P direkt“: Zentralen-Liste mit IP aus der Sicherung, Passwort 2460 vorbelegt,
   Intervall einstellbar, Verbinden, Klemmenwerte lesen, in Datenpunkte übernehmen,
   Explorer navigieren, Trennen räumt die Live-Werte weg. Dienst wird im Browser nachgebildet. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIXTURE = path.join(ROOT, "test", "fixtures", "beispiel-datasave.xml");

test("K&P direkt: anmelden, Klemmen lesen, Datenpunkte, Explorer, trennen", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    let connected = false, seenAddr = null, reads = 0; const asked = new Set();
    await page.route("http://localhost:47902/**", async route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const J = o => route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
      if (p === "/api/health") return J({ ok: true, version: "test" });
      if (p === "/api/config") return J({ centrals: [], settings: {} });
      if (p === "/api/kp/status") return J({ ok: true, salt: true, from: "test", port: 18090, sessions: [] });
      if (p === "/api/kp/verbinden") { if (body.pass !== "2460") return J({ ok: false, err: "Anmeldung abgelehnt (#25)", login: true }); connected = true; return J({ ok: true, host: 12, language: "de" }); }
      if (p === "/api/kp/trennen") { connected = false; return J({ ok: true }); }
      if (p === "/api/kp/lesen") { if (!connected) return J({ ok: false, login: true, err: "nicht angemeldet" }); reads++; body.adressen.forEach(a => asked.add(a)); return J({ ok: true, values: body.adressen.map(a => a.includes("CAI.01") ? { a, ok: true, pv: "33.3", v: 33.3, unit: "°C" } : { a, ok: true, pv: "Ein", v: true, unit: "" }) }); }
      if (p === "/api/kp/explorer") { seenAddr = body.adresse; return J({ ok: true, address: body.adresse, count: 1, items: [{ a: "001", n: "001", t: "IO_Modul", txt: "E/A-Modul 1", pv: null, unit: "", kids: true }] }); }
      if (p.startsWith("/api/data/")) return J({ ok: true, data: null });
      return J({ ok: false, err: "unbekannt" });
    });
    await page.goto("file://" + HTML);
    await page.setInputFiles("#fileIn", FIXTURE);
    await page.waitForFunction(() => document.body.innerText.includes("Testzentrale Halle"));
    await page.click(".nav-item:has-text('K&P direkt')");
    await page.waitForFunction(() => document.body.innerText.includes("Nicht verbunden"));

    // Liste der Zentralen: IP aus der Sicherung, Passwort vorbelegt
    assert.equal(await page.inputValue(".kp-list tbody input.in"), "192.168.3.212");
    assert.equal(await page.inputValue("input[placeholder='Passwort']"), "2460");

    // Falsches Passwort → Fehler
    await page.fill("input[placeholder='Benutzer']", "service");
    await page.fill("input[placeholder='Passwort']", "falsch");
    await page.click(".kp-list button:has-text('Verbinden')");
    await page.waitForFunction(() => document.body.innerText.includes("Anmeldung abgelehnt"));

    // Richtig → Klemmenwerte („Alle verbinden“)
    await page.fill("input[placeholder='Passwort']", "2460");
    await page.click("button:has-text('Alle verbinden')");
    await page.waitForFunction(() => /von \d+ Klemmen antworten/.test(document.body.innerText));
    assert.match(await page.innerText("body"), /33,3/);
    assert.match(await page.innerText(".kp-list"), /verbunden/);

    // Intervall einstellbar: 1 s → Auto-Abfrage liest wiederholt
    await page.fill("input[title='Abfrage-Intervall in Sekunden']", "1");
    await page.press("input[title='Abfrage-Intervall in Sekunden']", "Tab");
    await page.check("label:has-text('automatisch alle') input");
    const r0 = reads;
    for (let i = 0; i < 40 && reads < r0 + 2; i++) await page.waitForTimeout(100);
    assert.ok(reads >= r0 + 2, "Auto-Abfrage im 1-s-Takt");
    await page.uncheck("label:has-text('automatisch alle') input");
    assert.equal(await page.evaluate(() => localStorage.getItem("ddcwb.kpInterval")), "1");

    // In Datenpunkten sichtbar
    await page.click(".nav-item:has-text('Datenpunkte')");
    assert.match(await page.innerText("tr[data-uid='001/00/00/P.01']"), /33,3/);

    // Explorer
    await page.click(".nav-item:has-text('K&P direkt')");
    await page.click("button:has-text('Explorer')");
    await page.waitForFunction(() => document.body.innerText.includes("E/A-Modul 1"));
    assert.equal(seenAddr, "//");

    // Programm & Wirkkette: Live-Werte in der Wirkkette und in der Diagnose
    await page.evaluate(() => DDCWerkbank.openNode(DDCWerkbank.curC().cid, "001/00/00/P.01", "down"));
    await page.waitForFunction(() => [...document.querySelectorAll("svg text.lv")].some(t => t.textContent.includes("33,3")));
    await page.waitForFunction(() => [...document.querySelectorAll(".checklist code.lv")].some(t => t.textContent.includes("33,3")));
    assert.match(await page.innerText(".checklist"), /Hervorgehobene Werte sind live/);
    // auch Parameter anderer Bausteine werden über ihre Adresse angefordert
    await page.waitForFunction(() => document.querySelectorAll("svg text.lv").length > 1);
    const notPin = a => !/\/(CAI|CDI|CDO|CAO)\.\d+\/[bkKYy]$/.test(a);
    for (let i = 0; i < 30 && ![...asked].some(notPin); i++) await page.waitForTimeout(100);
    assert.ok([...asked].some(a => !/\/(CAI|CDI|CDO|CAO)\.\d+\/[bkKYy]$/.test(a)), "nur Klemmen angefragt: " + [...asked].join(", "));

    // Trennen räumt Live-Werte weg
    await page.click(".nav-item:has-text('K&P direkt')");
    await page.click(".kp-list button:has-text('Trennen')");
    await page.waitForFunction(() => document.body.innerText.includes("Nicht verbunden"));
    await page.evaluate(() => DDCWerkbank.openNode(DDCWerkbank.curC().cid, "001/00/00/P.01", "down"));
    await page.waitForSelector(".checklist");
    assert.equal(await page.locator("svg text.lv").count(), 0);
    assert.match(await page.innerText(".checklist"), /keine Live-Ansicht/);
    await page.click(".nav-item:has-text('Datenpunkte')");
    assert.doesNotMatch(await page.innerText("tr[data-uid='001/00/00/P.01']"), /33,3/);

    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
