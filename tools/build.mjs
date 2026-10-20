/* =========================================================================
   Build: src/ui → eine einzige DDC-Werkbank/ui/DDC-Werkbank.html
   (CSS und JS eingebettet, läuft per Doppelklick auch ohne Dienst)
   Aufruf: npm run build      (--watch: bei jeder Änderung neu bauen)
   ========================================================================= */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "src", "ui");
const OUT = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

async function build() {
  const js = await esbuild.build({
    entryPoints: [path.join(UI, "main.js")],
    bundle: true, write: false, format: "iife", target: "es2020",
    charset: "utf8", legalComments: "none", logLevel: "warning",
    define: { __WB_VERSION__: JSON.stringify(PKG.version) }
  });
  const stylesDir = path.join(UI, "styles");
  const css = fs.readdirSync(stylesDir).filter(f => f.endsWith(".css")).sort()
    .map(f => fs.readFileSync(path.join(stylesDir, f), "utf8")).join("");
  const code = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = fs.readFileSync(path.join(UI, "index.html"), "utf8")
    .replace("<!-- STYLES -->", () => css.replace(/\n$/, ""))
    .replace("<!-- SCRIPTS -->", () => code.replace(/\n$/, ""));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log("gebaut: " + path.relative(ROOT, OUT) + " (" + Math.round(html.length / 1024) + " KB)");
}

await build();
if (process.argv.includes("--watch")) {
  let t = null;
  fs.watch(UI, { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => build().catch(e => console.error(e.message)), 150); });
  console.log("beobachte src/ui …");
}
