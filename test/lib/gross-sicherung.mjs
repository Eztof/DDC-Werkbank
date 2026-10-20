/* Erzeugt eine große künstliche DDC4000-Sicherung (D4PML) für Last-Tests.
   mods Module mit je 32 Klemmen und je einer Anlage mit Logik, Reglern,
   Aggregaten, Zeitprogrammen und Verknüpfungen auf die Klemmen. */
export function grosseSicherung(mods = 60) {
  const L = [];
  const pad = (n, w) => String(n).padStart(w, "0");
  L.push('<?xml version="1.0" encoding="UTF-8"?>', '<D4PML Version="1.2">',
    '<Header><Identity CentralAddr="7" BacnetDevId="4007"/><Version applRev="1.9.3" build="77" defdataRev="5"/><InvokeID>20260115T0930</InvokeID></Header>',
    '<Content><Central Addr="7">',
    '<Module Addr="000" Type="DDC4200"><Text>Lasttest Klinikum</Text><Plant Addr="00" Type="SY"><Text>System</Text><Group Addr="00" Type="SY"><Text>System</Text>',
    '<Object Addr="SY.01" Type="SY_Modul"><Para Addr="899"><Value Type="Text">1.9.3</Value></Para></Object>',
    '<Object Addr="SY.03" Type="SY_Clock"><Para Addr="1"><Value Type="Int">1768469400</Value></Para></Object>',
    '</Group></Plant></Module>');
  let bac = 1;
  for (let m = 1; m <= mods; m++) {
    const ma = pad(m, 3), anl = "RLT" + m;
    L.push(`<Module Addr="${ma}" Type="IO_Modul"><Text>E/A-Modul ${m}</Text><Plant Addr="00" Type="P"><Text>Klemmen</Text><Group Addr="00" Type="P"><Text>Klemmen</Text>`);
    for (let p = 1; p <= 32; p++) {
      const pa = "P." + pad(p, 2), k = p % 4;
      const txt = `${anl}_${["TF", "BM", "ST", "SV"][k]}_${pad(p, 2)} ${["Temperatur", "Betrieb", "Ansteuerung", "Stellsignal"][k]} ${p}`;
      if (k === 0) L.push(`<Object Addr="${pa}" Type="P"><Text>${txt}</Text><Para Addr="1"><Value Type="Int">3</Value></Para><SubObj Addr="CAI.01" Type="CAI"><Para Addr="b"><Text>Temp ${p}</Text><Value Type="Float" Unit="62">${(18 + p / 10).toFixed(1)}</Value>` +
        (p % 8 === 0 ? `<FuncObj Addr="1" Type="F019"><Para Addr="C"><Value Type="Float" Unit="62">2.5</Value></Para></FuncObj>` : "") +
        `<FuncObj Addr="2" Type="FB_AI"><Text>${txt}</Text><Para Addr="ObjId"><Value Type="Int">${bac++}</Value></Para></FuncObj></Para></SubObj></Object>`);
      else if (k === 1) L.push(`<Object Addr="${pa}" Type="P"><Text>${txt}</Text><Para Addr="1"><Value Type="Int">1</Value></Para><SubObj Addr="CDI.01" Type="CDI"><Para Addr="k"><Text>Betrieb</Text><Value Type="Bool">1</Value>` +
        `<FuncObj Addr="2" Type="FB_BI"><Para Addr="ObjId"><Value Type="Int">${bac++}</Value></Para></FuncObj></Para></SubObj></Object>`);
      else if (k === 2) L.push(`<Object Addr="${pa}" Type="P"><Text>${txt}</Text><Para Addr="1"><Value Type="Int">2</Value></Para><SubObj Addr="CDO.01" Type="CDO"><Para Addr="K"><Text>Ansteuerung</Text><Value Type="Bool">0</Value>` +
        `<FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">//${ma}/01/01/M.${pad(p, 2)}/6</Value></Para></FuncObj></Para></SubObj></Object>`);
      else L.push(`<Object Addr="${pa}" Type="P"><Text>${txt}</Text><Para Addr="1"><Value Type="Int">4</Value></Para><SubObj Addr="CAO.01" Type="CAO"><Para Addr="Y"><Text>Stellsignal</Text><Value Type="Float" Unit="98">35</Value>` +
        `<FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">//${ma}/01/01/R.${pad(p, 2)}/2</Value></Para></FuncObj></Para></SubObj></Object>`);
    }
    L.push(`</Group></Plant><Plant Addr="01" Type="RLT"><Text>${anl} Lüftung</Text><Group Addr="01" Type="RG"><Text>Regelung</Text>`);
    L.push(`<Object Addr="S118.01" Type="S118"><Text>Zeitprogramm ${anl}</Text><SubObj Addr="CSched.01" Type="CSched"><Schedule><DayList WeekDay="mo"><DayEntry Time="06:00:00" Value="1"/><DayEntry Time="18:00:00" Value="0"/></DayList></Schedule><Para Addr="ObjId"><Value Type="Int">${m}</Value></Para></SubObj></Object>`);
    for (let p = 1; p <= 32; p++) {
      const k = p % 4, pp = pad(p, 2);
      if (k === 2) L.push(`<Object Addr="M.${pp}" Type="M"><Text>Freigabe ${p}</Text><Para Addr="5"><Value Type="Text">e1 &amp; e2</Value></Para>` +
        `<Para Addr="1"><FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">//${ma}/01/01/S118.01/actValue</Value></Para></FuncObj></Para>` +
        `<Para Addr="2"><FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">//${ma}/00/00/P.${pad(p - 1, 2)}/CDI.01/k</Value></Para></FuncObj></Para><Para Addr="6"><Value Type="Bool">1</Value></Para></Object>`);
      if (k === 3) L.push(`<Object Addr="R.${pp}" Type="S066"><Text>Regler ${p}</Text><Para Addr="4839"><FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">//${ma}/00/00/P.${pad(p - 3, 2)}/CAI.01/b</Value></Para></FuncObj></Para>` +
        `<Para Addr="8610"><Value Type="Float" Unit="62">20</Value></Para><Para Addr="2"><Value Type="Float" Unit="98">40</Value></Para></Object>`);
    }
    L.push(`<Object Addr="H601.01" Type="H601"><Text>Ventilator ${anl}</Text><Para Addr="1"><Value Type="Bool">1</Value><FuncObj Addr="1" Type="FSource"><Para Addr="1"><Value Type="Source">//${ma}/01/01/M.02/6</Value></Para></FuncObj></Para><Para Addr="10"><Value Type="Int">${m % 10 === 0 ? 0 : 9}</Value></Para></Object>`);
    L.push("</Group></Plant></Module>");
  }
  L.push("</Central></Content></D4PML>");
  return L.join("\n");
}
