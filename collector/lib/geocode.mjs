// Geocodificação de endereços com o Nominatim (OpenStreetMap), para câmeras que os
// portais oficiais só descrevem pelo nome da rua. Segue a política de uso do Nominatim:
// no máximo 1 pedido por segundo, identificação do programa e resultados guardados em
// cache (collector/.cache/geocode.json), então cada endereço é consultado uma vez só.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchJSON } from "./util.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cache = null, file = null, dirty = false, last = 0, chain = Promise.resolve();

async function load(dir) {
  if (cache) return;
  file = join(dir || "collector/.cache", "geocode.json");
  try { cache = JSON.parse(await readFile(file, "utf8")); } catch { cache = {}; }
}

// até 15 resultados; dedupe=0 devolve cada trecho de uma rua (ajuda a achar cruzamentos)
async function ask(q, cc) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=15&dedupe=0&countrycodes=" + encodeURIComponent(cc) + "&q=" + encodeURIComponent(q);
  const j = await fetchJSON(url, { timeout: 20000, retries: 1, headers: { "Accept-Language": "pt-BR" } });
  return Array.isArray(j) ? j.map((r) => [Math.round(+r.lat * 1e5) / 1e5, Math.round(+r.lon * 1e5) / 1e5]).filter((p) => p.every(Number.isFinite)) : [];
}

export const kmBetween = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180)) * 111.2;

// devolve a lista de pontos achados ([[lat, lng], ...], vazia se nada); "near" ([lat, lng, km])
// descarta os que ficam longe demais da cidade
export function geocodeAll(q, opt = {}) {
  const run = async () => {
    await load(opt.cache);
    const key = (opt.cc || "br") + "|" + String(q).toLowerCase().replace(/\s+/g, " ").trim();
    let res = Array.isArray(cache[key]) ? cache[key] : undefined;
    if (res === undefined) {
      try { res = await ask(q, opt.cc || "br"); } catch { return []; } // erro de rede: tenta de novo na próxima coleta
      cache[key] = res; dirty = true;
    }
    return opt.near ? res.filter((p) => kmBetween(p, opt.near) <= opt.near[2]) : res;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => null);
  return p;
}

// Cruzamento de duas ruas ("Av. A com Rua B"): pergunta ao Overpass (OpenStreetMap) pelo
// nó que as duas vias têm em comum perto da cidade. Devolve [lat, lng] ou null.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const VOWEL = { a: "[aáàâã]", e: "[eéê]", i: "[ií]", o: "[oóôõ]", u: "[uúü]", c: "[cç]" };
function streetRe(s) {
  const base = String(s).replace(/^(rua|avenida|travessa|alameda|estrada|rodovia|pra[cç]a|largo|viaduto|ponte)\s+/i, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, " ").trim().toLowerCase();
  return "(^| )" + base.split(/\s+/).map((w) => w.split("").map((ch) => VOWEL[ch] || ch).join("")).join(" +") + "$";
}
export function intersection(a, b, center, opt = {}) {
  const run = async () => {
    await load(opt.cache);
    const key = "x|" + [a, b].map((x) => String(x).toLowerCase()).sort().join("|") + "|" + center.slice(0, 2).map((v) => v.toFixed(2)).join(",");
    if (key in cache) return cache[key];
    const r = Math.round((center[2] || 12) * 1000), at = `(around:${r},${center[0]},${center[1]})`;
    const q = `[out:json][timeout:25];way${at}["highway"]["name"~"${streetRe(a)}",i]->.a;way${at}["highway"]["name"~"${streetRe(b)}",i]->.b;node(w.a)(w.b);out 10;`;
    let res;
    for (const ep of OVERPASS) {
      try {
        const j = await fetchJSON(ep, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 40000, retries: 0 });
        const pts = ((j && j.elements) || []).filter((e) => Number.isFinite(e.lat)).map((e) => [Math.round(e.lat * 1e5) / 1e5, Math.round(e.lon * 1e5) / 1e5]);
        pts.sort((p, q2) => kmBetween(p, center) - kmBetween(q2, center));
        res = pts[0] || null;
        break;
      } catch { /* tenta o próximo servidor */ }
    }
    if (res === undefined) return null; // sem resposta: tenta de novo na próxima coleta
    cache[key] = res; dirty = true;
    return res;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => null);
  return p;
}

export async function geocode(q, opt = {}) {
  const all = await geocodeAll(q, opt);
  return all[0] || null;
}

export async function saveGeocode() {
  await chain.catch(() => null);
  if (dirty && file) { try { await writeFile(file, JSON.stringify(cache)); dirty = false; } catch { /* sem cache em disco */ } }
}
