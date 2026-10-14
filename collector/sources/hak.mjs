// HAK (Hrvatski autoklub): câmeras das autoestradas, fronteiras, pontes e portos de balsa da
// Croácia. O portal oficial lista as câmeras por grupo (nome, tipo e imagem), sem coordenadas.
// A posição sai do OpenStreetMap: o trevo, o pedágio, o túnel, a ponte ou o posto de fronteira
// com o mesmo nome (os pontos do OSM ficam em cache por 30 dias). O que não casar vai para o
// Nominatim pelo nome do lugar (posição aproximada).
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fetchText, fetchJSON, clean, decodeXml, pool } from "../lib/util.mjs";
import { geocodeAll, kmBetween, saveGeocode } from "../lib/geocode.mjs";

const B = "https://www.hak.hr/info/kamere/";
const GROUPS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "D8", "GP", "TP", "MT", "HC", "MJ"];
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const Q = [
  `[out:json][timeout:150];area["ISO3166-1"="HR"][admin_level=2]->.hr;(node["highway"="motorway_junction"](area.hr);nwr["barrier"="toll_booth"](area.hr);nwr["highway"~"^(rest_area|services)$"](area.hr););out center tags;`,
  `[out:json][timeout:150];area["ISO3166-1"="HR"][admin_level=2]->.hr;(way["tunnel"]["name"](area.hr);way["tunnel"]["tunnel:name"](area.hr);way["bridge"]["bridge:name"](area.hr);way["bridge"]["name"]["highway"~"motorway|trunk|primary"](area.hr);nwr["barrier"="border_control"](area.hr);nwr["amenity"="ferry_terminal"](area.hr););out center tags;`,
];

// lista das câmeras de cada grupo: [{ id, group, tip, name }]
export function parseGroup(html, group) {
  const out = [];
  const re = /<li data-tip="([A-Z]*)"[^>]*>\s*<div class="profile-img-container">\s*<img class="cam[^"]*" data-id="(\d+)"[^>]*alt="([^"]*)"/g;
  for (const m of html.matchAll(re)) out.push({ id: m[2], group, tip: m[1], name: clean(decodeXml(m[3]), 100) });
  return out;
}

// nome sem acentos, sem a palavra do tipo de lugar e com "Sv."/"II" padronizados
const TYPEWORDS = /\b(cvor|naplatna postaja|naplata|np|tunel|tunnel|most|vijadukt|viadukt|odmoriste|odmaraliste|granicni prijelaz|granicni prelaz|gp|trajektna luka|trajektno pristaniste|trajektni terminal|luka|pristaniste|petlja|prilaz|ulaz|izlaz|portal|kartice|enc|bihamk)\b/g;
export function norm(s) {
  return String(s || "").toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\bsv(eti|eta|eto|\.)?(?=\s|$)/g, "sv").replace(/\bii\b/g, "2").replace(/\biii\b/g, "3").replace(/\bi\b/g, "1")
    .replace(TYPEWORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
// variantes do nome da câmera para procurar: inteiro, sem o parêntese, antes do " - " e da vírgula
function variants(name) {
  const v = new Set([norm(name), norm(name.replace(/\(.*?\)/g, " ")), norm(name.split(/\s+-\s+|,/)[0]), norm((name.match(/\(([^)]+)\)/) || [])[1] || "")]);
  return [...v].filter((x) => x.length >= 3);
}

const KIND = (t) => t.highway === "motorway_junction" ? "junction" : t.barrier === "toll_booth" ? "toll" : /rest_area|services/.test(t.highway || "") ? "rest"
  : t.barrier === "border_control" ? "border" : t.amenity === "ferry_terminal" ? "ferry" : t.tunnel ? "tunnel" : t.bridge ? "bridge" : "";
// tipo da câmera na HAK → tipos de lugar do OSM, na ordem de preferência
const PREF = {
  CV: ["junction", "toll", "rest"], NC: ["toll", "junction", "rest"], AC: ["junction", "toll", "rest"], SG: ["junction", "toll", "border"], PZ: ["junction", "toll", "border"],
  TU: ["tunnel", "junction"], VT: ["bridge", "junction", "tunnel"], MT: ["bridge", "junction"], OD: ["rest", "junction", "toll"], GP: ["border"],
  TP: ["ferry"], TL: ["ferry"], LK: ["ferry"], MJ: [],
};

export function indexOsm(elements) {
  const idx = new Map();
  for (const e of elements || []) {
    const t = e.tags || {}, kind = KIND(t), lat = e.lat ?? (e.center && e.center.lat), lng = e.lon ?? (e.center && e.center.lon);
    if (!kind || !Number.isFinite(lat)) continue;
    for (const k of ["name", "long_name", "alt_name", "official_name", "tunnel:name", "bridge:name", "name:hr", "short_name"]) {
      const n = norm(t[k]);
      if (n.length < 3) continue;
      if (!idx.has(n)) idx.set(n, []);
      idx.get(n).push({ kind, lat, lng });
    }
  }
  return idx;
}

// posição de cada câmera; as do mesmo grupo vêm em ordem de estrada, então, havendo dois
// lugares com o mesmo nome, fica o mais perto da câmera anterior
export function matchCams(cams, idx) {
  let last = null, lastGroup = "";
  for (const c of cams) {
    if (c.group !== lastGroup) { last = null; lastGroup = c.group; }
    const kinds = PREF[c.tip] || ["junction", "toll", "tunnel", "bridge", "border", "ferry", "rest"];
    let best = null;
    for (const v of variants(c.name)) {
      const found = (idx.get(v) || []).filter((p) => kinds.includes(p.kind));
      if (!found.length) continue;
      found.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (last ? kmBetween([a.lat, a.lng], last) - kmBetween([b.lat, b.lng], last) : 0));
      best = found[0];
      break;
    }
    if (best) { c.lat = best.lat; c.lng = best.lng; c.how = best.kind; last = [best.lat, best.lng]; }
  }
  return cams;
}

async function osmPoints(cacheDir, warn) {
  const file = join(cacheDir || "collector/.cache", "hak-osm.json");
  try { if (Date.now() - (await stat(file)).mtimeMs < 30 * 86400e3) return JSON.parse(await readFile(file, "utf8")); } catch { /* consulta de novo */ }
  const els = [];
  for (const q of Q) {
    let ok = false;
    for (const ep of OVERPASS) {
      try {
        const j = await fetchJSON(ep, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 200000, retries: 0 });
        els.push(...((j && j.elements) || []).map((e) => ({ tags: e.tags, lat: e.lat ?? (e.center && e.center.lat), lon: e.lon ?? (e.center && e.center.lon) })));
        ok = true;
        break;
      } catch (e) { warn("Overpass: " + e.message); }
    }
    if (!ok) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return els; } } // cache velho é melhor que nada
  }
  try { await writeFile(file, JSON.stringify(els)); } catch { /* sem cache em disco */ }
  return els;
}

export default [{
  id: "hak", name: "HAK — câmeras das estradas da Croácia", org: "Hrvatski autoklub (HAK)", country: "HR", type: "trafego", home: B,
  attr: "HAK — Hrvatski autoklub (posições: © colaboradores do OpenStreetMap)", lic: "imagens públicas do portal da HAK",
  timeout: 14 * 60000,
  run: async (ctx) => {
    const cams = [];
    await pool(GROUPS, 4, async (g) => {
      try { cams.push(...parseGroup(await fetchText(B + "grupa/" + g, { timeout: 60000 }), g)); } catch (e) { ctx.warn(g + ": " + e.message); }
    });
    cams.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || 0);
    matchCams(cams, indexOsm(await osmPoints(ctx.cache, ctx.warn)));
    // sem par no OSM: o nome do lugar no Nominatim (cidade, porto, fronteira)
    let approx = 0;
    for (const c of cams) {
      if (Number.isFinite(c.lat)) continue;
      const q = c.name.replace(/\(.*?\)|"[^"]*"/g, " ").replace(/\s+-\s+.*$/, "").trim();
      // fronteira: o posto pode estar do lado bósnio, sérvio, esloveno, húngaro ou montenegrino
      const p = c.tip === "GP"
        ? ((await geocodeAll("granični prijelaz " + q, { cache: ctx.cache, cc: "hr,ba,rs,si,hu,me" }))[0] || (await geocodeAll(q, { cache: ctx.cache, cc: "hr,ba,rs,si,hu,me" }))[0])
        : (await geocodeAll(q + ", Hrvatska", { cache: ctx.cache, cc: "hr" }))[0];
      if (p) { c.lat = p[0]; c.lng = p[1]; c.approx = true; approx++; }
    }
    await saveGeocode();
    const seen = new Set(), out = [];
    for (const c of cams) {
      if (!Number.isFinite(c.lat) || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, img: B + c.id + ".jpg", page: B + "grupa/" + c.group,
        where: (c.group.startsWith("A") ? "Autocesta " + c.group : c.group === "GP" ? "Granični prijelaz" : c.group === "TP" ? "Trajektna luka" : "Hrvatska") + (c.approx ? " (posição aproximada)" : ""),
        type: /^(TP|TL|LK)$/.test(c.tip) ? "porto" : c.tip === "GP" ? "fronteira" : c.tip === "MJ" ? "cidade" : "trafego" });
    }
    const lost = cams.length - out.length - (cams.length - seen.size);
    if (approx || lost > 0) ctx.warn(`${cams.length} câmeras: ${approx} posicionadas pelo nome do lugar, ${Math.max(0, cams.filter((c) => !Number.isFinite(c.lat)).length)} sem posição`);
    return out;
  },
}];
