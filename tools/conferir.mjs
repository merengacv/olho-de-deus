// Conferência do site publicado: abre o endereço num Chromium de verdade (no GitHub
// Actions, que tem internet), tira fotos de algumas vistas e grava um resumo.
// As fotos vão para o ramo "telas" do repositório.
//
// Uso: node tools/conferir.mjs https://merengacv.github.io/olho-de-deus/ telas
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [, , URL0 = "https://merengacv.github.io/olho-de-deus/", OUT = "telas"] = process.argv;
const url = URL0.replace(/\/?$/, "/") + "?debug";
await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = { url, when: new Date().toISOString(), steps: [], errors: [], console: [], requests: {}, cams: [], tiles: { n: 0, fail: 0, ms: [] } };
const step = (name, data) => { log.steps.push({ name, s: Math.round((Date.now() - T0) / 1000), ...data }); console.log(name, JSON.stringify(data || {}).slice(0, 600)); };
const pendingCams = new Map(); // pedidos do banco de câmeras ainda sem resposta
const save = () => {
  log.camsPending = [...pendingCams.values()].map((x) => ({ u: x.u, age: Date.now() - x.t0 }));
  const ms = log.tiles.ms.slice().sort((a, b) => a - b);
  log.tileStats = { n: log.tiles.n, fail: log.tiles.fail, p50: ms[ms.length >> 1] || 0, p90: ms[Math.floor(ms.length * 0.9)] || 0, max: ms[ms.length - 1] || 0 };
  return writeFile(join(OUT, "conferir.json"), JSON.stringify({ ...log, tiles: undefined }, null, 1));
};
// cada etapa é independente: uma falha não derruba as outras
const tryStep = async (name, fn) => { try { await fn(); } catch (e) { log.errors.push(name + ": " + String(e && e.message || e).slice(0, 400)); } await save(); };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const watch = (page, tag) => {
  const tileT = new Map();
  page.on("pageerror", (e) => log.errors.push(tag + " pageerror: " + String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.console.push(tag + ": " + m.text().slice(0, 400)); });
  page.on("request", (r) => {
    const u = r.url();
    if (/\/data\/cams\//.test(u)) pendingCams.set(r, { tag, u: u.replace(/^.*\/data\/cams\//, ""), t0: Date.now() });
    else if (/\/_t\//.test(u)) tileT.set(r, Date.now());
  });
  const done = async (r, fail) => {
    const x = pendingCams.get(r);
    if (x) {
      pendingCams.delete(r);
      const resp = fail ? null : await r.response().catch(() => null);
      log.cams.push({ tag, u: x.u, ms: Date.now() - x.t0, st: resp ? resp.status() : null, fail: fail || undefined, at: Math.round((x.t0 - T0) / 1000) });
    }
    const t = tileT.get(r);
    if (t != null) { tileT.delete(r); log.tiles.n++; if (fail) log.tiles.fail++; else log.tiles.ms.push(Date.now() - t); }
  };
  page.on("requestfinished", (r) => done(r, null));
  page.on("requestfailed", (r) => done(r, (r.failure() && r.failure().errorText) || "falhou"));
  page.on("response", (r) => {
    try {
      const u = new URL(r.url()), k = u.hostname + " " + r.status();
      log.requests[k] = (log.requests[k] || 0) + 1;
    } catch (e) { /* endereço estranho */ }
  });
  page.on("requestfailed", (r) => { try { const k = new URL(r.url()).hostname + " FALHOU " + (r.failure() && r.failure().errorText); log.requests[k] = (log.requests[k] || 0) + 1; } catch (e) { /* ok */ } });
};
const ready = (page) => page.waitForFunction(() => !!(window.__olho && window.__olho.globe() && ["ok", "error"].includes(window.__olho.CAMS.state)), null, { timeout: 120000 });
const state = (page) => page.evaluate(() => {
  const o = window.__olho, src = {}, C = o.CAMS;
  for (const [k, v] of Object.entries(o.S.src)) src[k] = { status: v.status, msg: v.msg, count: v.count, kind: v.kind };
  const E = o.engine();
  let tt = 0, tl = 0;
  if (E) E.children.forEach((m) => { if (m.isMesh && m.material && !(m.material.userData && m.material.userData.olhoNight === true)) { tt++; if (m.material.map && m.material.map.image) tl++; } });
  const ovl = {};
  for (const k in o.OVL || {}) { const L = o.OVL[k]; if (L) ovl[k] = { on: !!L.tileUrl, level: L.level, tiles: L.children.filter((m) => m.isMesh && m.visible).length }; }
  return { cams: C.state, n: C.n, windy: o.S.windy.length, ovl, basemap: o.S.basemap, level: E && E.level, tiles: tt, tilesLoaded: tl, pov: o.globe().pointOfView(),
    chunks: { ok: C.chunks.size, loading: [...C.loading.keys()].filter((k) => !C.chunks.has(k)), waiting: [...C.waiting.keys()] }, src };
});
// quadros por segundo do globo (no Actions o WebGL roda no processador, então é lento)
const fps = (page) => page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round((n / ((performance.now() - t0) / 1000)) * 10) / 10); };
  requestAnimationFrame(f);
})).catch(() => null);
// foto pelo protocolo do Chrome (não espera fontes) com o globo pausado (libera o processador)
const shot = async (page, file) => {
  await page.evaluate(() => { try { window.__olho.globe().pauseAnimation(); } catch (e) { /* sem globo */ } }).catch(() => {});
  try {
    await sleep(300);
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, file), Buffer.from(data, "base64"));
    await cdp.detach();
  } finally {
    await page.evaluate(() => { try { window.__olho.globe().resumeAnimation(); } catch (e) { /* sem globo */ } }).catch(() => {});
  }
};
// espera o dossiê sair do "carregando" (até 40 s)
const dossierReady = async (page, max = 40) => {
  for (let k = 0; k < max; k++) {
    const t = await page.evaluate(() => { const h = document.getElementById("d-name"); return h ? h.textContent : ""; }).catch(() => "");
    if (t && t !== "Câmera") return k;
    await sleep(1000);
  }
  return -1;
};
const dossierText = (page) => page.evaluate(() => (document.getElementById("dossier").innerText || "").slice(0, 700)).catch(() => "");
const fly = async (page, lat, lng, alt, wait) => {
  await page.evaluate(([a, b, c]) => { window.__olho.S.rotate = false; window.__olho.flyTo(a, b, c, 0); }, [lat, lng, alt]);
  await sleep(wait || 12000);
};
// espera os ladrilhos do mapa (até "max" s); devolve quantos segundos levou
const tilesReady = async (page, max = 30) => {
  for (let k = 0; k < max; k++) {
    const s = await state(page).catch(() => null);
    if (s && s.tiles > 0 && s.tilesLoaded >= s.tiles * 0.9) return k;
    await sleep(1000);
  }
  return -1;
};
const nearest = (page, lat, lng, video) => page.evaluate(([la, lo, v]) => {
  const o = window.__olho, c = o.CAMS;
  let best = -1, bd = 1e9;
  for (let k = 0; k < c.n; k++) { if (v && !(c.m[k] & 2)) continue; const d = Math.abs(c.lat[k] - la) + Math.abs(c.lng[k] - lo); if (d < bd) { bd = d; best = k; } }
  if (best >= 0) o.select("cam", o.camRef(best));
  return best;
}, [lat, lng, video]);

let page;
await tryStep("primeira-carga", async () => {
  // 1ª visita instala o service worker; a 2ª já usa os rótulos no satélite
  const p0 = await ctx.newPage();
  watch(p0, "p0");
  await p0.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await ready(p0);
  await sleep(6000);
  step("primeira", await state(p0));
  await shot(p0, "00-primeira-visita.png");
  await p0.close();
});
await tryStep("segunda-carga", async () => {
  page = await ctx.newPage();
  watch(page, "p1");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await ready(page);
  await sleep(10000);
  step("inicio", { ...(await state(page)), fps: await fps(page) });
  await shot(page, "01-globo.png");
});
if (page) {
  await tryStep("sao-paulo", async () => {
    await fly(page, -23.55, -46.63, 0.05, 3000);
    const w = await tilesReady(page, 40);
    step("sao-paulo", { tilesEm: w, fps: await fps(page), ...(await state(page)) });
    await shot(page, "02-sao-paulo.png");
  });
  await tryStep("nova-york", async () => {
    await fly(page, 40.758, -73.9855, 0.0012, 3000);
    const w = await tilesReady(page, 50);
    step("nova-york", { tilesEm: w, fps: await fps(page), ...(await state(page)) });
    await shot(page, "03-nova-york-rua.png");
  });
  await tryStep("camera-londres", async () => {
    const i = await nearest(page, 51.5074, -0.1278, false);
    const k = await dossierReady(page);
    let extra = {};
    if (k < 0) {
      // travou? pausa o globo e espera mais um pouco: separa "lento" de "travado"
      const before = await state(page);
      await page.evaluate(() => window.__olho.globe().pauseAnimation());
      const k2 = await dossierReady(page, 20);
      await page.evaluate(() => window.__olho.globe().resumeAnimation());
      extra = { travou: before.chunks, depoisDePausar: k2 };
    }
    await tilesReady(page, 20);
    step("camera-londres", { i, dossieEm: k, ...extra, dossier: await dossierText(page), ...(await state(page)) });
    await shot(page, "04-camera-londres.png");
  });
  await tryStep("camera-video", async () => {
    // uma câmera com vídeo ao vivo (HLS) perto de Nova York
    const i = await nearest(page, 40.75, -73.99, true);
    const k = await dossierReady(page);
    await sleep(15000);
    step("camera-video", { i, dossieEm: k, dossier: await dossierText(page),
      video: await page.evaluate(() => { const v = document.querySelector("#camMedia video"); return v ? { rs: v.readyState, t: v.currentTime, w: v.videoWidth, err: v.error && v.error.code } : null; }),
      ...(await state(page)) });
    await shot(page, "05-camera-video.png");
  });
  await tryStep("camera-brasil", async () => {
    // câmera do Brasil (DER-SP em São Paulo, se houver)
    const i = await nearest(page, -23.62, -46.68, false);
    const k = await dossierReady(page);
    await sleep(10000);
    step("camera-brasil", { i, dossieEm: k, dossier: await dossierText(page),
      media: await page.evaluate(() => { const m = document.getElementById("camMedia"); if (!m) return null; const im = m.querySelector("img"), v = m.querySelector("video"); return { img: im ? { w: im.naturalWidth, src: (im.currentSrc || "").slice(0, 120) } : null, video: v ? { rs: v.readyState, w: v.videoWidth } : null, msg: (m.innerText || "").slice(0, 120) }; }) });
    await shot(page, "05b-camera-brasil.png");
  });
  await tryStep("fundos", async () => {
    await page.evaluate(() => { const b = document.querySelector('[data-act="close"]'); if (b) b.click(); });
    await fly(page, 48.8566, 2.3522, 0.12, 3000);
    for (const [bm, file] of [["s2", "06-sem-nuvens.png"], ["gibs", "07-ontem-nasa.png"], ["dark", "08-tatico.png"], ["esri", null]]) {
      await page.evaluate((v) => { const b = document.querySelector('[data-act="basemap"][data-v="' + v + '"]'); if (b) b.click(); }, bm);
      const w = bm === "dark" ? (await sleep(4000), 0) : await tilesReady(page, 30);
      step("fundo-" + bm, { tilesEm: w, tiles: (await state(page)).tiles });
      if (file) await shot(page, file);
    }
  });
  await tryStep("aba-cameras", async () => {
    await page.evaluate(() => { const t = document.getElementById("tab-cams"); if (t) t.click(); });
    await fly(page, -23.0, -45.5, 0.4, 3000);
    await tilesReady(page, 30);
    await sleep(4000);
    await shot(page, "09-aba-cameras.png");
    step("fim-desktop", await state(page));
  });
}
await tryStep("celular", async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pt-BR" });
  const mp = await m.newPage();
  watch(mp, "cel");
  await mp.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await ready(mp);
  await sleep(12000);
  await shot(mp, "10-celular.png");
  await mp.evaluate(() => { const b = document.querySelector('#mbar [data-sheet="cams"]'); if (b) b.click(); });
  await sleep(4000);
  await shot(mp, "11-celular-cameras.png");
});
await save();
await browser.close();
