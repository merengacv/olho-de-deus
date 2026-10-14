// Quilômetros das rodovias federais concedidas (ANTT, dados abertos): a posição de cada
// marco quilométrico (a cada ~200 m) de BR-101/RJ, BR-163/MT etc. Serve para pôr no mapa as
// câmeras que as concessionárias só descrevem por "rodovia + km". O arquivo oficial é um KMZ
// de ~10 MB (KML de ~550 MB): é lido aos pedaços uma vez e vira um índice pequeno no cache
// (collector/.cache/antt-km.json), renovado a cada 45 dias.
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { UA } from "./util.mjs";
import { unzip } from "./zip.mjs";

export const ANTT_KMZ = "https://dados.antt.gov.br/dataset/9c0951da-0ca9-43b8-b158-f8bd591209c1/resource/588d468c-0f91-4055-bd26-9c64b09d9656/download/dados_quilometo_principal.kmz";
let index = null, loading = null;

// "BR-101/RJ", "BR 101/RJ", "BR101/ES" → "101/RJ"
export function roadKey(s) {
  const m = String(s || "").toUpperCase().match(/BR\s*-?\s*0*(\d{1,3})\s*\/\s*([A-Z]{2})/);
  return m ? m[1] + "/" + m[2] : "";
}

// lê o KML aos pedaços: { "101/RJ": [[km, lat, lng], ...] } (sentido crescente; o
// decrescente só entra onde o crescente não tem marco)
export async function buildIndex(kmz) {
  const kml = unzip(kmz).find((x) => /\.kml$/i.test(x.name));
  if (!kml) throw new Error("KMZ da ANTT sem KML");
  const up = new Map(), down = new Map(), dec = new TextDecoder("utf-8");
  const cell = (re, s) => { const m = s.match(re); return m ? m[1].trim() : ""; };
  let rest = "";
  await kml.eachChunk((d) => {
    const buf = rest + dec.decode(d, { stream: true });
    let pos = 0, i;
    while ((i = buf.indexOf("</Placemark>", pos)) >= 0) {
      const pm = buf.slice(pos, i);
      pos = i + 12;
      const road = roadKey(cell(/<td>rodovia<\/td>\s*<td>([^<]*)</, pm)), km = parseFloat(cell(/<td>km_m<\/td>\s*<td>([^<]*)</, pm).replace(",", "."));
      const co = pm.match(/<coordinates>\s*(-?[\d.]+),(-?[\d.]+)/);
      if (!road || !Number.isFinite(km) || !co) continue;
      const lat = Math.round(+co[2] * 1e5) / 1e5, lng = Math.round(+co[1] * 1e5) / 1e5;
      const m = /decresc/i.test(cell(/<td>sentido<\/td>\s*<td>([^<]*)</, pm)) ? down : up;
      if (!m.has(road)) m.set(road, new Map());
      m.get(road).set(Math.round(km * 10), [Math.round(km * 10) / 10, lat, lng]);
    }
    rest = buf.slice(pos);
  });
  const out = {};
  for (const road of new Set([...up.keys(), ...down.keys()])) {
    const a = up.get(road) || new Map(), b = down.get(road) || new Map();
    for (const [k, v] of b) if (!a.has(k)) a.set(k, v);
    out[road] = [...a.values()].sort((x, y) => x[0] - y[0]);
  }
  return out;
}

async function load(opt = {}) {
  if (index) return index;
  if (!loading) loading = (async () => {
    const file = join(opt.cache || "collector/.cache", "antt-km.json");
    try { if (Date.now() - (await stat(file)).mtimeMs < 45 * 86400e3) return JSON.parse(await readFile(file, "utf8")); } catch { /* baixa de novo */ }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 300000);
    try {
      const r = await fetch(ANTT_KMZ, { headers: { "User-Agent": UA }, signal: ctl.signal }).catch((e) => { throw new Error(e.name === "AbortError" ? "tempo esgotado" : (e.cause && e.cause.code) || e.message); });
      if (!r.ok) throw new Error("ANTT: HTTP " + r.status);
      const idx = await buildIndex(Buffer.from(await r.arrayBuffer()));
      try { await writeFile(file, JSON.stringify(idx)); } catch { /* sem cache em disco */ }
      return idx;
    } catch (e) {
      try { return JSON.parse(await readFile(file, "utf8")); } catch { throw e; } // índice velho é melhor que nada
    } finally { clearTimeout(timer); }
  })();
  index = await loading;
  return index;
}

// posição do km de uma rodovia federal concedida (interpola entre os marcos vizinhos);
// null se a rodovia não está na tabela ou o km fica a mais de 1 km de um marco
export async function kmPosition(road, km, opt = {}) {
  let idx;
  try { idx = await load(opt); } catch (e) { loading = null; throw new Error("tabela de km da ANTT indisponível: " + e.message); }
  const pts = idx[roadKey(road)];
  if (!pts || !pts.length || !Number.isFinite(km)) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= km) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  if (km < a[0] - 1 || km > b[0] + 1 || (b[0] - a[0] > 2 && km > a[0] + 1 && km < b[0] - 1)) return null;
  const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (km - a[0]) / (b[0] - a[0])));
  return [Math.round((a[1] + (b[1] - a[1]) * t) * 1e5) / 1e5, Math.round((a[2] + (b[2] - a[2]) * t) * 1e5) / 1e5];
}
