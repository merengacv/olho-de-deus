// Coletor diário de câmeras públicas. Roda no GitHub Actions.
//
// 1. Lê cada fonte oficial direto da origem (pasta sources/).
// 2. Se uma fonte falhar, usa a última coleta boa (cache) para não sumir do mapa.
// 3. Completa com o catálogo-semente aberto, só para o que ainda não foi lido direto.
// 4. Remove duplicatas, descobre o país de cada câmera e grava os arquivos do site:
//      data/cams/meta.js   índice (fontes, países, tipos)
//      data/cams/pts.js    posições de todas as câmeras (para desenhar o mapa)
//      data/cams/c/N.js    detalhes (nome, endereços de imagem/vídeo), 1000 por arquivo
//      data/cams/report.json  relatório da coleta
//
// Uso: node collector/collect.mjs --out site/data/cams --cache collector/.cache [--only id1,id2] [--no-seed] [--offline]
// --offline: não consulta as fontes, remonta o banco com a última coleta guardada (para
// publicar só uma mudança do site sem esperar a coleta inteira).
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { countryAt } from "./lib/countries.mjs";
import { isHttp, clean } from "./lib/util.mjs";
import ibi511 from "./sources/ibi511.mjs";
import usa from "./sources/usa.mjs";
import canada from "./sources/canada.mjs";
import europe from "./sources/europe.mjs";
import asiapac from "./sources/asiapac.mjs";
import global from "./sources/global.mjs";
import portais from "./sources/portais.mjs";
import brasil from "./sources/brasil.mjs";
import paginas from "./sources/paginas.mjs";
import { loadSeed, seedSourceName } from "./sources/seed.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? a.concat([[x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]]) : a), []));
const OUT = args.out || "site/data/cams", CACHE = args.cache || "collector/.cache";
const ONLY = args.only ? new Set(String(args.only).split(",")) : null;
// prazo das fontes diretas (minutos): depois dele, quem não respondeu entra com a última coleta boa
const DEADLINE = Date.now() + (Number(args.deadline) || 38) * 60000;
const OFFLINE = !!args.offline;
const CHUNK = 1000;
export const TYPES = ["trafego", "clima", "cidade", "natureza", "praia", "montanha", "rio", "porto", "aviacao", "vulcao", "ciencia", "fauna", "fronteira", "ferrovia", "ceu", "portal"];
const T0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...m);

const SOURCES = [...ibi511, ...usa, ...canada, ...europe, ...asiapac, ...brasil, ...paginas, ...global, ...portais].filter((s) => !ONLY || ONLY.has(s.id));

// ---------- normalização ----------
const BUST = /^(t|v|_|ts|time|timestamp|rand|r|cache|nocache|cb|dummy|x)$/i;
function urlKey(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (BUST.test(k)) x.searchParams.delete(k);
    return (x.hostname.replace(/^www\./, "") + x.pathname + (x.search || "")).toLowerCase();
  } catch { return String(u).toLowerCase(); }
}
function hostKey(u) {
  try { const x = new URL(u); const h = x.hostname.replace(/^www\./, "").toLowerCase(); return /amazonaws\.com$|blob\.core\.windows\.net$|cloudfront\.net$/.test(h) ? h + "/" + x.pathname.split("/")[1] : h; }
  catch { return ""; }
}
const mediaOf = (c) => c.img || c.hls || c.mp4 || c.emb || c.page || "";
function norm(c, src) {
  if (!c) return null;
  const lat = Number(c.lat), lng = Number(c.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)) return null;
  const o = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, name: clean(c.name, 120) || "Câmera", s: src.id };
  for (const k of ["img", "hls", "mp4", "emb", "page"]) if (c[k] && isHttp(c[k])) o[k] = String(c[k]).trim();
  if (o.hls && !/^https:/i.test(o.hls)) delete o.hls;
  if (o.mp4 && !/^https:/i.test(o.mp4)) delete o.mp4;
  if (!mediaOf(o)) return null;
  o.id = clean(c.id != null ? c.id : mediaOf(o), 120);
  o.t = TYPES.includes(c.type) ? c.type : TYPES.includes(src.type) ? src.type : "cidade";
  const cc = String(c.cc || "").toUpperCase();
  o.cc = /^[A-Z]{2}$/.test(cc) ? cc : /^[A-Z]{2}$/.test(src.country || "") ? src.country : "";
  if (c.where) o.where = clean(c.where, 80);
  if (c.dir) o.dir = clean(c.dir, 24);
  return o;
}

// ---------- execução das fontes ----------
async function readCache(id) { try { return JSON.parse(await readFile(join(CACHE, id + ".json"), "utf8")); } catch { return null; } }
async function writeCache(id, data) { try { await writeFile(join(CACHE, id + ".json"), JSON.stringify(data)); } catch { /* sem cache */ } }
function withTimeout(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("fonte demorou demais")), ms); })]).finally(() => clearTimeout(timer));
}

async function runSource(src) {
  const t = Date.now(), warns = [];
  const rec = { id: src.id, name: src.name, org: src.org, cc: src.country || "", home: src.home, lic: src.lic, attr: src.attr, type: src.type, live: src.live };
  if (OFFLINE) {
    const cached = (await readCache(src.id)) || [];
    Object.assign(rec, { ok: cached.length > 0, from: "cache", n: cached.length, ms: 0, warns: ["modo rápido: última coleta guardada"] });
    return [rec, cached];
  }
  try {
    const left = DEADLINE - Date.now();
    if (left < 5000) throw new Error("sem tempo nesta coleta (prazo geral esgotado)");
    // ctx.partial: regiões que falharam hoje (a fonte devolve só parte); delas fica a coleta anterior
    const ctx = { warn: (m) => warns.push(m), partial: [], cache: CACHE };
    const raw = await withTimeout(src.run(ctx), Math.min(src.timeout || 15 * 60000, left));
    const cams = (raw || []).map((c) => norm(c, src)).filter(Boolean);
    if (ctx.partial.length) {
      const old = (await readCache(src.id)) || [], ids = new Set(cams.map((c) => c.id));
      const inBox = (c) => ctx.partial.some(([so, we, no, ea]) => c.lat >= so && c.lat <= no && c.lng >= we && c.lng <= ea);
      let added = 0;
      for (const c of old) if (!ids.has(c.id) && inBox(c)) { cams.push(c); added++; }
      if (added) warns.push(`${added} câmeras de regiões que falharam vieram da coleta anterior`);
    }
    if (!cams.length) throw new Error("nenhuma câmera válida na resposta");
    await writeCache(src.id, cams);
    Object.assign(rec, { ok: true, from: "origem", n: cams.length, ms: Date.now() - t, warns: warns.slice(0, 5), sample: cams.slice(0, 2) });
    return [rec, cams];
  } catch (e) {
    const cached = await readCache(src.id);
    Object.assign(rec, { ok: false, err: String(e && e.message || e).slice(0, 300), ms: Date.now() - t, warns: warns.slice(0, 5) });
    if (cached && cached.length) { rec.from = "cache"; rec.n = cached.length; return [rec, cached]; }
    rec.n = 0;
    return [rec, []];
  }
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  log(`${SOURCES.length} fontes diretas`);
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < SOURCES.length) {
      const src = SOURCES[i++];
      const r = await runSource(src);
      log(`${r[0].ok ? "ok " : r[0].from === "cache" ? "cache" : "ERRO"} ${src.id}: ${r[0].n}${r[0].err ? " — " + r[0].err : ""}`);
      results.push(r);
    }
  }));

  // Fontes "agregadoras" (OpenStreetMap, Wikidata) têm um punhado de câmeras de cada
  // site: não servem para dizer que um site inteiro já foi lido, e só entram onde
  // ainda não houver câmera (vêm por último).
  const sources = [], all = [], covered = new Set(), later = [];
  const cell = (c) => Math.round(c.lat * 4500) + ":" + Math.round(c.lng * 4500);
  for (const [rec, cams] of results) {
    sources.push(rec);
    const src = SOURCES.find((x) => x.id === rec.id) || {};
    if (src.aggregate) { later.push([rec, cams]); continue; }
    for (const c of cams) { all.push(c); covered.add(hostKey(mediaOf(c))); }
  }

  // ---------- semente ----------
  if (!args["no-seed"] && (!ONLY || args.seed)) {
    try {
      const bySrc = await loadSeed(log);
      // pontos já cobertos por fontes diretas (células de ~25 m): a mesma câmera com outro endereço
      const taken = new Set(all.map(cell));
      let used = 0, dropped = 0, samePoint = 0;
      for (const [src, cams] of bySrc) {
        const keep = cams.filter((c) => {
          if (covered.has(hostKey(mediaOf(c)))) return false;
          if (taken.has(cell(c))) { samePoint++; return false; }
          return true;
        });
        dropped += cams.length - keep.length;
        if (!keep.length) continue;
        const nm = seedSourceName(src, keep);
        // id único (duas redes da semente podem ter o mesmo nome curto)
        let sid = "s-" + src.replace(/^opencctv_/, "");
        while (sources.some((x) => x.id === sid)) sid += "_";
        const rec = { id: sid, name: nm.name, org: nm.org || nm.host, cc: "", home: nm.host ? "https://" + nm.host + "/" : "", lic: "catálogo aberto Argus (MIT); imagens dos respectivos donos", attr: nm.org || nm.host, seed: true };
        const ok = keep.map((c) => norm(c, rec)).filter(Boolean);
        rec.n = ok.length; rec.ok = true; rec.from = "semente";
        if (ok.length) { sources.push(rec); all.push(...ok); used += ok.length; }
      }
      log(`semente: ${used} usadas, ${dropped} já cobertas por fontes diretas (${samePoint} no mesmo ponto)`);
      await writeCache("_seed_ok", { at: new Date().toISOString(), used });
    } catch (e) {
      log("semente falhou: " + e.message);
      sources.push({ id: "s-erro", name: "Catálogo-semente", ok: false, err: e.message, n: 0 });
    }
  }

  // ---------- agregadoras: só onde ainda não há câmera ----------
  {
    const taken = new Set(all.map(cell));
    for (const [rec, cams] of later) {
      let kept = 0;
      for (const c of cams) { const k = cell(c); if (taken.has(k)) continue; taken.add(k); all.push(c); kept++; }
      rec.kept = kept;
    }
  }

  // ---------- duplicatas e países ----------
  const seen = new Map();
  let uniq = [];
  for (const c of all) {
    const k = urlKey(mediaOf(c));
    if (seen.has(k)) continue;
    seen.set(k, 1);
    if (!c.cc) c.cc = countryAt(c.lat, c.lng) || "";
    uniq.push(c);
  }
  log(`${all.length} câmeras, ${uniq.length} sem duplicatas`);
  // a mesma câmera em duas fontes (página oficial com vídeo + rede que só dá o link): fica a
  // com vídeo/imagem; se a posição dela era aproximada (nome sem endereço), herda a da outra
  {
    const key = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const linkOnly = new Map(), drop = new Set();
    for (const c of uniq) if (!mediaOf({ ...c, page: "" })) { const k = key(c.name); if (k.length >= 5) { if (!linkOnly.has(k)) linkOnly.set(k, []); linkOnly.get(k).push(c); } }
    for (const c of uniq) {
      if (!linkOnly.size || !mediaOf({ ...c, page: "" })) continue;
      for (const o of linkOnly.get(key(c.name.split(" — ").pop())) || []) {
        if (drop.has(o) || o.s === c.s || Math.hypot(o.lat - c.lat, (o.lng - c.lng) * Math.cos((c.lat * Math.PI) / 180)) * 111 > 3) continue;
        drop.add(o);
        if (/posição aproximada/.test(c.where || "")) { c.lat = o.lat; c.lng = o.lng; c.where = c.where.replace(/\s*\(posição aproximada\)/, ""); }
      }
    }
    if (drop.size) { uniq = uniq.filter((c) => !drop.has(c)); log(`${drop.size} câmeras só com link já vinham com imagem de outra fonte`); }
  }
  // mesma fonte, mesmo nome, mesmo lugar: são vistas diferentes do mesmo poste
  const views = new Map();
  for (const c of uniq) {
    const k = c.s + "|" + c.name + "|" + c.lat.toFixed(3) + "|" + c.lng.toFixed(3);
    const n = (views.get(k) || 0) + 1;
    views.set(k, n);
    if (n > 1) c.name = clean(c.name + (c.dir ? " · " + c.dir : " · vista " + n), 120);
  }

  // ---------- ordenação (país, depois proximidade) ----------
  const morton = (lat, lng) => {
    let x = Math.floor((lng + 180) / 360 * 65535), y = Math.floor((lat + 90) / 180 * 65535), m = 0;
    for (let b = 15; b >= 0; b--) m = m * 4 + (((x >> b) & 1) << 1 | ((y >> b) & 1));
    return m;
  };
  for (const c of uniq) c._m = morton(c.lat, c.lng);
  uniq.sort((a, b) => (a.cc < b.cc ? -1 : a.cc > b.cc ? 1 : a._m - b._m));

  // ---------- saída ----------
  // índice de cada fonte na lista publicada (sem repetir ids: um id repetido desalinharia tudo)
  const srcIdx = new Map();
  for (const s of sources) if (s.n > 0 && !srcIdx.has(s.id)) srcIdx.set(s.id, srcIdx.size);
  const countries = [];
  const pts = { lat: [], lng: [], t: [], s: [], m: [] };
  uniq.forEach((c, k) => {
    if (!countries.length || countries[countries.length - 1][0] !== c.cc) countries.push([c.cc, k, 0]);
    countries[countries.length - 1][2]++;
    pts.lat.push(Math.round(c.lat * 1e4)); pts.lng.push(Math.round(c.lng * 1e4));
    pts.t.push(TYPES.indexOf(c.t)); pts.s.push(srcIdx.get(c.s) ?? 0);
    pts.m.push((c.img ? 1 : 0) | (c.hls ? 2 : 0) | (c.mp4 ? 4 : 0) | (c.emb ? 8 : 0) | (c.page ? 16 : 0));
  });
  const perSrc = new Map();
  for (const c of uniq) perSrc.set(c.s, (perSrc.get(c.s) || 0) + 1);
  const srcList = [...srcIdx.keys()].map((id) => {
    const s = sources.find((x) => x.id === id);
    return { id, name: s.name, org: s.org || "", cc: s.cc || "", home: s.home || "", lic: s.lic || "", attr: s.attr || "", n: perSrc.get(id) || 0, from: s.from, live: s.live || undefined, seed: s.seed || undefined };
  });
  // Os arquivos pesados ficam numa pasta com o carimbo da coleta (nome nunca se
  // repete): o navegador nunca mistura posições de hoje com detalhes de ontem.
  const generated = new Date().toISOString();
  const dir = "g" + generated.replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  const meta = { v: 2, generated, dir, total: uniq.length, chunk: CHUNK, types: TYPES, sources: srcList, countries };
  // posições em diferenças sucessivas (as câmeras vêm ordenadas por proximidade): arquivo bem menor
  const delta = (a) => a.map((v, k) => (k ? v - a[k - 1] : v));
  const ptsOut = { g: dir, enc: "d", lat: delta(pts.lat), lng: delta(pts.lng), t: pts.t, s: pts.s, m: pts.m };

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, dir, "c"), { recursive: true });
  await writeFile(join(OUT, "meta.js"), "window.__OLHO_CAMS_META=" + JSON.stringify(meta) + ";\n");
  await writeFile(join(OUT, dir, "pts.js"), "window.__OLHO_CAMS_PTS=" + JSON.stringify(ptsOut) + ";\n");
  for (let k = 0; k * CHUNK < uniq.length; k++) {
    const rows = uniq.slice(k * CHUNK, (k + 1) * CHUNK).map((c) => [c.id, c.name, c.img || "", c.hls || "", c.mp4 || "", c.emb || "", c.page || "", c.where || "", c.dir || ""]);
    await writeFile(join(OUT, dir, "c", k + ".js"), `window.__olhoChunk(${k},${JSON.stringify(rows)});\n`);
  }
  const report = { generated, dir, seconds: Math.round((Date.now() - T0) / 1000), total: uniq.length, raw: all.length,
    byCountry: Object.fromEntries(countries.map(([cc, , n]) => [cc || "??", n])),
    byType: Object.fromEntries(TYPES.map((t) => [t, uniq.filter((c) => c.t === t).length])),
    sources: sources.map(({ sample, ...s }) => ({ ...s, sample: sample && sample.slice(0, 1) })) };
  await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 1));
  log(`pronto: ${uniq.length} câmeras, ${countries.length} países, ${srcList.length} fontes`);
}

main().catch((e) => { console.error(e); process.exit(1); });
