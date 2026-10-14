// Utilidades do coletor: rede, conversão de coordenadas, XML simples e limpeza.
export const UA = "OlhoDeDeus/3 (+https://github.com/merengacv/olho-de-deus; coleta diaria de cameras publicas)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, opt = {}) {
  const tries = opt.retries ?? 2;
  let last;
  for (let i = 0; i <= tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opt.timeout || 45000);
    try {
      const headers = { "User-Agent": UA, Accept: opt.accept || "*/*", ...(opt.headers || {}) };
      let body = opt.body;
      if (body && typeof body === "object" && !(body instanceof URLSearchParams)) {
        body = JSON.stringify(body);
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
      }
      const r = await fetch(url, { method: opt.method || (body ? "POST" : "GET"), headers, body, signal: ctl.signal, redirect: "follow" });
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error("HTTP " + r.status), { retry: true, status: r.status });
      if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status });
      if (opt.charset !== "auto") return await r.text();
      // páginas antigas em ISO-8859-1/Windows-1252: usa o charset do cabeçalho ou da <meta>
      const buf = await r.arrayBuffer();
      let cs = ((r.headers.get("content-type") || "").match(/charset=["']?([\w-]+)/i) || [])[1];
      if (!cs) cs = (new TextDecoder("latin1").decode(buf.slice(0, 4096)).match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
      try { return new TextDecoder(cs || "utf-8").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
    } catch (e) {
      last = e;
      const retry = e.retry || e.name === "AbortError" || /fetch failed|ECONNRESET|socket|ETIMEDOUT|EAI_AGAIN/i.test(String(e.message) + String(e.cause && e.cause.code));
      if (!retry || i === tries) break;
      await sleep(1500 * (i + 1));
    } finally { clearTimeout(timer); }
  }
  const msg = last && last.name === "AbortError" ? "tempo esgotado" : last && (last.cause && last.cause.code ? last.cause.code : last.message) || "falha";
  throw new Error(msg);
}

export async function fetchJSON(url, opt = {}) {
  const t = await fetchText(url, { accept: "application/json", ...opt });
  const s = t.replace(/^﻿/, "").trim();
  try { return JSON.parse(s); }
  catch {
    // JSONP: callback({...}) ou var x = {...};
    const m = s.match(/^[^({\[]*?[({\[]([\s\S]*)$/);
    const i = s.search(/[{\[]/), j = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch { /* segue */ } }
    throw new Error("JSON inválido" + (m ? "" : "") + ": " + s.slice(0, 80).replace(/\s+/g, " "));
  }
}

// Executa tarefas com concorrência limitada.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = e; } }
  }));
  return out;
}

// ---------- coordenadas ----------
export function mercToLatLng(x, y) {
  const R = 6378137;
  return [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, (x / R) * 180 / Math.PI];
}
// UTM (WGS84/ETRS89) -> [lat, lng]
export function utmToLatLng(E, N, zone, north = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, y = north ? N : N - 10000000;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), T1 = Math.tan(p1) ** 2, C1 = ep2 * Math.cos(p1) ** 2;
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return [lat * 180 / Math.PI, (zone - 1) * 6 - 180 + 3 + lon * 180 / Math.PI];
}
export function wktPoint(s) {
  const m = String(s || "").match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)/i);
  return m ? [parseFloat(m[2]), parseFloat(m[1])] : null;
}

// ---------- XML bem simples (para listas regulares) ----------
export function xmlBlocks(xml, tag) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  const out = []; let m;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}
export function xmlVal(block, tag) {
  const m = block.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`));
  return m ? decodeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()) : "";
}
export function xmlAttr(block, attr) {
  const m = block.match(new RegExp(`\\b${attr}="([^"]*)"`));
  return m ? decodeXml(m[1]) : "";
}
export function decodeXml(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
}

// ---------- limpeza ----------
export const clean = (s, max = 140) => String(s == null ? "" : s).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export function absUrl(u, base) {
  if (!u) return "";
  u = String(u).trim();
  if (!u) return "";
  try { return new URL(u, base).href; } catch { return ""; }
}
export const isHttp = (u) => /^https?:\/\/[^\s]+$/i.test(String(u || ""));
export function ytEmbed(u) {
  const m = String(u || "").match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&mute=1` : "";
}
