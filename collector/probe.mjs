// Sonda de fontes: roda no GitHub Actions (que tem internet livre) e grava um
// relatório JSON com o que cada endereço respondeu. Serve para conferir, antes
// de usar, se um servidor de mapas libera CORS, se uma API de câmeras responde,
// qual o formato do JSON, etc. A chave do Windy vem do segredo do repositório e
// nunca é gravada no relatório.
//
// Uso: node collector/probe.mjs collector/probes.json out/probe.json
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const [, , specPath = "collector/probes.json", outPath = "out/probe.json"] = process.argv;
const ORIGIN = "https://merengacv.github.io";
const UA = "OlhoDeDeus/3 (+https://github.com/merengacv/olho-de-deus; sondagem diaria de fontes publicas)";
const KEEP_HEADERS = ["content-type", "content-length", "access-control-allow-origin", "x-frame-options",
  "content-security-policy", "cache-control", "last-modified", "server", "location", "retry-after"];

function summarizeJSON(v, depth = 0) {
  if (Array.isArray(v)) return { type: "array", length: v.length, first: depth < 3 && v.length ? summarizeJSON(v[0], depth + 1) : undefined };
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    const out = { type: "object", keys: keys.slice(0, 40) };
    if (depth < 3) for (const k of keys.slice(0, 12)) {
      const x = v[k];
      if (x && typeof x === "object") out[k] = summarizeJSON(x, depth + 1);
      else out[k] = typeof x === "string" ? x.slice(0, 160) : x;
    }
    return out;
  }
  return typeof v === "string" ? v.slice(0, 200) : v;
}

async function runProbe(p) {
  const headers = { "User-Agent": UA, Origin: ORIGIN, Accept: p.accept || "*/*", ...(p.headers || {}) };
  if (p.windy) {
    if (!process.env.WINDY_API_KEY) return { id: p.id, error: "WINDY_API_KEY ausente no ambiente" };
    headers["x-windy-api-key"] = process.env.WINDY_API_KEY;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), p.timeout || 25000);
  const t0 = Date.now();
  try {
    const r = await fetch(p.url, { method: p.method || "GET", headers, body: p.body, redirect: p.redirect || "follow", signal: ctl.signal });
    const h = {};
    for (const k of KEEP_HEADERS) { const v = r.headers.get(k); if (v != null) h[k] = v.slice(0, 300); }
    const buf = Buffer.from(await r.arrayBuffer());
    const res = { id: p.id, url: p.url, status: r.status, finalUrl: r.url !== p.url ? r.url : undefined, ms: Date.now() - t0, bytes: buf.length, headers: h };
    const ct = (h["content-type"] || "").toLowerCase();
    const isText = /json|text|xml|javascript|html/.test(ct) || p.text;
    if (isText) {
      const txt = buf.toString("utf8");
      if (/json/.test(ct) || p.json) {
        try { res.json = summarizeJSON(JSON.parse(txt)); if (p.full) res.full = JSON.parse(txt); } catch { res.head = txt.slice(0, p.head || 600); }
      } else res.head = txt.slice(0, p.head || 600);
      if (p.grep) {
        res.grep = {};
        for (const g of p.grep) {
          const re = new RegExp(g, "gi"), seen = new Set();
          let m; while ((m = re.exec(txt)) && seen.size < (p.grepMax || 40)) seen.add(m[0].slice(0, 220));
          res.grep[g] = [...seen];
        }
      }
    } else {
      res.magic = buf.subarray(0, 4).toString("hex");
    }
    return res;
  } catch (e) {
    return { id: p.id, url: p.url, error: String(e && (e.cause && e.cause.code) || e && e.message || e), ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

const spec = JSON.parse(await readFile(specPath, "utf8"));
const out = { ranAt: new Date().toISOString(), results: [] };
const queue = spec.probes.slice();
const workers = Array.from({ length: 6 }, async () => {
  while (queue.length) { const p = queue.shift(); out.results.push(await runProbe(p)); }
});
await Promise.all(workers);
out.results.sort((a, b) => spec.probes.findIndex((p) => p.id === a.id) - spec.probes.findIndex((p) => p.id === b.id));
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(out, null, 1));
for (const r of out.results) console.log(String(r.status || r.error).padEnd(8), r.id, r.headers ? (r.headers["access-control-allow-origin"] || "-") : "");
