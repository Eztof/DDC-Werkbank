/* =========================================================================
   Online-Adressen der DDC4000/BMR-Zentrale (wie im Service-Tool):
   //Modul/Anlage/Gruppe/Objekt[/Unterobjekt]/Parameter
   Entspricht dem Pfad der Addr-Attribute in der Sicherung. Für DDC3000 und
   Bausteine anderer Zentralen gibt es keine Adresse (null).
   ========================================================================= */
const PRIM = { CAI: "b", CDI: "k", CDO: "K", CAO: "Y" };
const SEC = { CAO: "y", CDO: "k" };

export function nodeAddr(n) {
  if (!n || n.fmt !== "d4" || n.foreign || !n.mod || !n.addr) return null;
  return "//" + n.mod + "/" + n.plant + "/" + n.group + "/" + n.addr;
}
/* Parameter eines Bausteins (sub = Unterobjekt-Adresse oder "") */
export function paraAddr(n, sub, para) {
  const b = nodeAddr(n); if (!b || !para) return null;
  return b + (sub ? "/" + sub : "") + "/" + para;
}
/* Rest-Pfad einer Verknüpfungsquelle („CAI.01/b“ oder „6“) */
export function restAddr(n, rest) {
  const b = nodeAddr(n); if (!b || !rest) return null;
  return b + "/" + String(rest).replace(/^\/+/, "");
}
/* Live-Wert einer Klemme: Eingänge Messwert, Ausgänge wirksamer Stellwert */
export function pinAddr(C, p) {
  const n = C && C.nodes && C.nodes.get(p.nodeId); if (!n) return null;
  const sub = (n.subObjs || []).find(s => PRIM[s.type]); if (!sub) return null;
  const sec = SEC[sub.type] && sub.paras.some(x => x.addr === SEC[sub.type]) ? SEC[sub.type] : null;
  return paraAddr(n, sub.addr, (p.kind === "AA" || p.kind === "BA") && sec ? sec : PRIM[sub.type]);
}
