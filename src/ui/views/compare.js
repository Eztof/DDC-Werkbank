import { VIEWS } from "../core/views.js";
import { $, csv, download, h, natCmp, norm, safeName, trunc } from "../core/util.js";
import { nodePlace } from "../model/model.js";
import { APP, btn, byCid, chk, emptyState, icon, openNode, pageHead, renderAll, searchBox, selectEl, stationLabel } from "../shell/shell.js";

/* =========================================================================
   Ansicht: Vergleich zweier Sicherungen
   ========================================================================= */
function cmpGroupLabel(A, B, nid, key) {
  const n = (nid && (A.nodes.get(nid) || B.nodes.get(nid))) || null;
  const C = n ? (A.nodes.get(nid) ? A : B) : A;
  if (n) return { id: nid, label: (n.name ? n.name + " · " : "") + n.addr, place: n.pin ? "Klemme " + n.pin.klemme : nodePlace(C, n) };
  const m = key.match(/^K(\d+)\|([^|]+)/);
  if (m) return { id: "K" + m[1] + "|" + m[2].split("/")[0], label: "Parameter " + m[2].split("/")[0], place: m[1] === "0" ? "Grundgerät" : "Kreis " + m[1] };
  return { id: key.split("|")[0], label: key.split("|")[0], place: "" };
}
function diffCentrals(A, B) {
  const keys = new Set([...A.flat.keys(), ...B.flat.keys()]);
  const rows = [];
  for (const k of keys) {
    const a = A.flat.get(k), b = B.flat.get(k);
    const va = a ? String(a.val) : null, vb = b ? String(b.val) : null;
    if (va === vb) continue;
    const st = a && b ? "chg" : a ? "onlyA" : "onlyB";
    const g = cmpGroupLabel(A, B, (a || b).nid, k);
    rows.push({ key: k, st, label: (a || b).label, va, vb, g, isText: /\|Text$|\(Text\)$/.test(k) || / · Text$/.test((a || b).label) });
  }
  rows.sort((x, y) => natCmp(x.g.place, y.g.place) || natCmp(x.g.id, y.g.id) || natCmp(x.key, y.key));
  return rows;
}

VIEWS.compare = {
  render(root) {
    const S = APP.cmp;
    if (!S.show) Object.assign(S, { show: new Set(["chg", "onlyA", "onlyB"]), q: "", noText: false });
    root.appendChild(pageHead("Vergleich", "Zwei Sicherungen gegenüberstellen – was wurde zwischen den Ständen geändert?"));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    if (APP.centrals.length < 2) {
      body.appendChild(h("div", { class: "card" }, emptyState("compare", "Für den Vergleich werden zwei Sicherungen gebraucht",
        "Zum Beispiel die Sicherung vor und nach einer Inbetriebnahme oder Wartung derselben Zentrale. Es werden Parameter, Texte, Verknüpfungen und Zeitprogramme verglichen; Messwerte und Zähler bleiben außen vor.",
        h("div", { class: "row", style: { justifyContent: "center", marginTop: "14px" } }, btn("Dateien öffnen", "file", () => $("#fileIn").click(), "accent"), btn("Ordner öffnen", "folder", () => $("#dirIn").click())))));
      return;
    }
    if (!byCid(S.a)) S.a = APP.cur || APP.centrals[0].cid;
    if (!byCid(S.b) || S.b === S.a) {
      const A0 = byCid(S.a);
      const same = APP.centrals.find(c => c.cid !== S.a && c.format === A0.format && c.meta.centralAddr === A0.meta.centralAddr);
      S.b = (same || APP.centrals.find(c => c.cid !== S.a)).cid;
    }
    const A = byCid(S.a), B = byCid(S.b);
    const opts = APP.centrals.map(c => [c.cid, stationLabel(c) + (c.meta.stamp && !stationLabel(c).includes(c.meta.stamp) ? " · " + c.meta.stamp : "")]);
    body.appendChild(h("div", { class: "card", style: { marginBottom: "12px" } },
      h("div", { class: "row" },
        h("span", { class: "pill err" }, "A"), selectEl(opts, S.a, v => { S.a = v; renderAll(); }),
        btn(null, "swap", () => { [S.a, S.b] = [S.b, S.a]; renderAll(); }, "subtle", "A und B tauschen"),
        h("span", { class: "pill ok" }, "B"), selectEl(opts, S.b, v => { S.b = v; renderAll(); })),
      A.format !== B.format ? h("div", { class: "infobar warn", style: { marginTop: "12px" } }, icon("alert"), h("div", { class: "small" }, "Die beiden Sicherungen haben unterschiedliche Formate – ein Vergleich ist kaum aussagekräftig.")) :
        A.meta.centralAddr !== B.meta.centralAddr ? h("div", { class: "infobar inf", style: { marginTop: "12px" } }, icon("info"), h("div", { class: "small" }, "Unterschiedliche Zentralen (" + A.meta.centralAddr + " / " + B.meta.centralAddr + ") – sinnvoll z. B. für baugleiche Anlagen.")) : null));
    if (A === B) { body.appendChild(emptyState("compare", "A und B sind dieselbe Sicherung")); return; }
    const rows = diffCentrals(A, B);
    const cnt = { chg: 0, onlyA: 0, onlyB: 0 }; rows.forEach(r => cnt[r.st]++);
    const lbl = { chg: "geändert", onlyA: "nur in A", onlyB: "nur in B" };
    const cls = { chg: "warn", onlyA: "err", onlyB: "ok" };
    const wrap = h("div");
    body.appendChild(h("div", { class: "row", style: { marginBottom: "12px" } },
      ...["chg", "onlyA", "onlyB"].map(k => h("span", { class: "chip" + (S.show.has(k) ? " on" : ""), onclick: e => { S.show.has(k) ? S.show.delete(k) : S.show.add(k); e.currentTarget.classList.toggle("on"); draw(); } },
        h("span", { class: "sw-dot", style: { background: `var(--${cls[k]})` } }), lbl[k], h("span", { class: "n" }, cnt[k]))),
      h("span", { class: "sep" }),
      chk("Texte ausblenden", S.noText, v => { S.noText = v; draw(); }),
      searchBox("Parameter, Baustein, Wert …", S.q, v => { S.q = v; draw(); }),
      h("span", { class: "grow" }),
      btn("CSV", "download", () => download(safeName(A.meta.name) + "_Vergleich.csv", csv([["Status", "Ort", "Baustein", "Parameter", "A: " + A.meta.name, "B: " + B.meta.name], ...filtered().map(r => [lbl[r.st], r.g.place, r.g.label, r.label, r.va ?? "", r.vb ?? ""])]), "text/csv;charset=utf-8"))));
    body.appendChild(wrap);
    function filtered() {
      const q = norm(S.q);
      return rows.filter(r => S.show.has(r.st) && !(S.noText && r.isText) && (!q || norm([r.g.label, r.g.place, r.label, r.va, r.vb].join(" ")).includes(q)));
    }
    function draw() {
      wrap.innerHTML = "";
      const list = filtered();
      if (!rows.length) { wrap.appendChild(h("div", { class: "card" }, emptyState("check", "Keine Unterschiede", "Parameter, Texte und Verknüpfungen sind in beiden Sicherungen gleich."))); return; }
      if (!list.length) { wrap.appendChild(emptyState("filter", "Keine Unterschiede für diesen Filter")); return; }
      const t = h("table", { class: "grid card-t" });
      t.appendChild(h("thead", null, h("tr", null, h("th", { style: { width: "110px" } }, "Status"), h("th", null, "Parameter"), h("th", null, "A · " + trunc(A.meta.name, 30)), h("th", null, "B · " + trunc(B.meta.name, 30)))));
      const tb = h("tbody");
      let last = null, n = 0;
      for (const r of list) {
        if (++n > 2500) { tb.appendChild(h("tr", null, h("td", { colspan: 4, class: "muted" }, "… " + (list.length - 2500) + " weitere – bitte filtern"))); break; }
        if (r.g.id !== last) {
          last = r.g.id;
          const C = A.nodes.has(r.g.id) ? A : B.nodes.has(r.g.id) ? B : null;
          tb.appendChild(h("tr", { class: "grp-row" }, h("td", { colspan: 4 }, C ? h("a", { onclick: () => openNode(C.cid, r.g.id) }, r.g.label) : r.g.label, r.g.place ? h("span", { class: "faint" }, "  ·  " + r.g.place) : null)));
        }
        tb.appendChild(h("tr", null, h("td", null, h("span", { class: "pill " + cls[r.st] }, lbl[r.st])), h("td", { class: "small" }, r.label),
          h("td", { class: "diff-a" }, r.va ?? h("span", { class: "faint" }, "–")), h("td", { class: "diff-b" }, r.vb ?? h("span", { class: "faint" }, "–"))));
      }
      t.appendChild(tb);
      wrap.appendChild(h("div", { class: "card tight" }, t));
    }
    draw();
  }
};

