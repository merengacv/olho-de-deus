// Sonda de fontes: roda no GitHub Actions (que tem internet livre) e grava um
// relatório JSON com o que cada endereço respondeu, mais amostras do conteúdo.
// Serve para conferir, antes de usar, se um servidor de mapas libera CORS, se uma
// API de câmeras responde e qual o formato. A chave do Windy vem do segredo do
// repositório e nunca é gravada no relatório.
//
// Uso: node collector/probe.mjs collector/probes.json out
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const [, , specPath = "collector/probes.json", outDir = "out"] = process.argv;
const ORIGIN = "https://merengacv.github.io";
const UA = "OlhoDeDeus/3 (+https://github.com/merengacv/olho-de-deus; coleta diaria de cameras publicas)";
const KEEP_HEADERS = ["content-type", "content-length", "access-control-allow-origin", "x-frame-options",
  "content-security-policy", "cache-control", "last-modified", "server", "location", "retry-after", "content-encoding"];
const KEY = process.env.WINDY_API_KEY || "";

function summarizeJSON(v, depth = 0) {
  if (Array.isArray(v)) return { type: "array", length: v.length, first: depth < 4 && v.length ? summarizeJSON(v[0], depth + 1) : undefined };
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    const out = { type: "object", keys: keys.slice(0, 50) };
    if (depth < 4) for (const k of keys.slice(0, 16)) {
      const x = v[k];
      if (x && typeof x === "object") out[k] = summarizeJSON(x, depth + 1);
      else out[k] = typeof x === "string" ? x.slice(0, 200) : x;
    }
    return out;
  }
  return typeof v === "string" ? v.slice(0, 200) : v;
}
// chaves com cara de segredo (Google Maps etc.) também saem: o GitHub recusa o envio
const SECRET = /AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk_(live|test)_[0-9A-Za-z]{16,}|gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,}|xox[abprs]-[0-9A-Za-z-]{10,}|sk\.eyJ[0-9A-Za-z._-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|AccountKey=[0-9A-Za-z+\/=]{40,}|SG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}/g;
const scrub = (s) => (KEY ? String(s).split(KEY).join("[CHAVE]") : String(s)).replace(SECRET, "[CHAVE]");

async function hit(p) {
  const headers = { "User-Agent": UA, Accept: p.accept || "*/*", ...(p.noOrigin ? {} : { Origin: ORIGIN }), ...(p.headers || {}) };
  if (p.windy) { if (!KEY) return { id: p.id, error: "WINDY_API_KEY ausente" }; headers["x-windy-api-key"] = KEY; }
  let body = p.body;
  if (body && typeof body === "object") { body = JSON.stringify(body); headers["Content-Type"] = headers["Content-Type"] || "application/json"; }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), p.timeout || 30000);
  const t0 = Date.now();
  try {
    const r = await fetch(p.url, { method: p.method || (body ? "POST" : "GET"), headers, body, redirect: p.redirect || "follow", signal: ctl.signal });
    const h = {};
    for (const k of KEEP_HEADERS) { const v = r.headers.get(k); if (v != null) h[k] = v.slice(0, 300); }
    const buf = Buffer.from(await r.arrayBuffer());
    const res = { id: p.id, url: scrub(p.url), status: r.status, finalUrl: r.url !== p.url ? scrub(r.url) : undefined, ms: Date.now() - t0, bytes: buf.length, headers: h };
    const ct = (h["content-type"] || "").toLowerCase();
    const looksText = /json|text|xml|javascript|html|geo/.test(ct) || p.text || p.json;
    if (looksText) {
      const txt = buf.toString("utf8");
      res._text = txt;
      if (/json/.test(ct) || p.json || /^\s*[\[{]/.test(txt)) {
        try { const j = JSON.parse(txt); res.json = summarizeJSON(j); res._json = j; } catch { res.head = scrub(txt.slice(0, p.head || 800)); }
      } else res.head = scrub(txt.slice(0, p.head || 800));
      if (p.grep) {
        res.grep = {};
        for (const g of p.grep) {
          const re = new RegExp(g, "gi"), seen = new Set();
          let m; while ((m = re.exec(txt)) && seen.size < (p.grepMax || 40)) seen.add(scrub(m[0].slice(0, 260)));
          res.grep[g] = [...seen];
        }
      }
    } else res.magic = buf.subarray(0, 8).toString("hex");
    return res;
  } catch (e) {
    return { id: p.id, url: scrub(p.url), error: String(e && (e.cause && (e.cause.code || e.cause.message)) || e && e.message || e), ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

// Windy: lista + testa as URLs de imagem/player devolvidas (com e sem token).
async function windyChain(p) {
  const list = await hit(p);
  const out = [list];
  const w = list._json && list._json.webcams && list._json.webcams[0];
  if (!w) return out;
  const img = w.images && w.images.current || {};
  const tests = [];
  if (img.preview) { tests.push(["preview_token", img.preview]); tests.push(["preview_semtoken", img.preview.split("?")[0]]); }
  if (img.thumbnail) tests.push(["thumb_token", img.thumbnail]);
  if (w.player && w.player.day) tests.push(["player_day", w.player.day]);
  tests.push(["imgproxy_plain", `https://imgproxy.windy.com/_/preview/plain/current/${w.webcamId}/original.jpg`]);
  tests.push(["imgproxy_full", `https://imgproxy.windy.com/_/full/plain/current/${w.webcamId}/original.jpg`]);
  for (const [name, url] of tests) out.push(await hit({ id: p.id + ":" + name, url, noOrigin: false, timeout: 20000 }));
  return out;
}

// Roda um leitor do coletor (ex.: "brasil:santos") na rede do Actions e grava a contagem,
// avisos e uma amostra. Serve para testar um leitor novo antes de ligar na coleta.
async function runSource(p) {
  const [file, id] = p.source.split(":"), t0 = Date.now(), warns = [];
  try {
    const mod = await import("./sources/" + file + ".mjs");
    const src = (mod.default || []).find((s) => s.id === id);
    if (!src) return { id: p.id, error: "leitor não encontrado: " + p.source };
    const out = await src.run({ warn: (m) => warns.push(String(m).slice(0, 300)), partial: [] });
    const arr = Array.isArray(out) ? out : [];
    return { id: p.id, source: p.source, count: arr.length, ms: Date.now() - t0, warns: warns.slice(0, 30), sample: JSON.parse(scrub(JSON.stringify(arr.slice(0, p.sample || 25)))) };
  } catch (e) {
    return { id: p.id, source: p.source, error: scrub(String(e && e.stack || e).slice(0, 1500)), ms: Date.now() - t0, warns: warns.slice(0, 30) };
  }
}

const spec = JSON.parse(await readFile(specPath, "utf8"));
await mkdir(join(outDir, "samples"), { recursive: true });
const results = [];
const queue = spec.probes.slice();
const workers = Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const p = queue.shift();
    const rs = p.source ? [await runSource(p)] : p.windyChain ? await windyChain(p) : [await hit(p)];
    for (const r of rs) {
      const save = p.save || (r.id.includes(":") ? 2000 : 0);
      if (r._text && save) await writeFile(join(outDir, "samples", r.id.replace(/[^\w.-]+/g, "_") + ".txt"), scrub(r._text.slice(0, save)));
      if (r._json && p.full) r.full = JSON.parse(scrub(JSON.stringify(r._json)));
      delete r._text; delete r._json;
      results.push(r);
    }
  }
});
await Promise.all(workers);
const order = new Map(spec.probes.map((p, i) => [p.id, i]));
results.sort((a, b) => (order.get(a.id.split(":")[0]) - order.get(b.id.split(":")[0])) || a.id.localeCompare(b.id));
await writeFile(join(outDir, "probe.json"), scrub(JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 1)));
for (const r of results) console.log(String(r.status || r.count || r.error).slice(0, 30).padEnd(10), r.id, r.headers ? (r.headers["access-control-allow-origin"] || "-") : "");
