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
const log = { url, when: new Date().toISOString(), steps: [], errors: [], console: [], requests: {} };
const step = (name, data) => { log.steps.push({ name, at: new Date().toISOString(), ...data }); console.log(name, JSON.stringify(data || {}).slice(0, 400)); };
const save = () => writeFile(join(OUT, "conferir.json"), JSON.stringify(log, null, 1));
// cada etapa é independente: uma falha não derruba as outras
const tryStep = async (name, fn) => { try { await fn(); } catch (e) { log.errors.push(name + ": " + String(e && e.message || e).slice(0, 400)); } await save(); };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const watch = (page, tag) => {
  page.on("pageerror", (e) => log.errors.push(tag + " pageerror: " + String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.console.push(tag + ": " + m.text().slice(0, 400)); });
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
  const o = window.__olho, src = {};
  for (const [k, v] of Object.entries(o.S.src)) src[k] = { status: v.status, msg: v.msg, note: v.note, count: v.count, kind: v.kind };
  const E = o.engine();
  return { cams: o.CAMS.state, n: o.CAMS.n, windy: o.S.windy.length, sw: o.SW, basemap: o.S.basemap, level: E && E.level, tiles: E ? E.children.length : null, pov: o.globe().pointOfView(), src };
});
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
const dossierReady = async (page) => {
  for (let k = 0; k < 40; k++) {
    const t = await page.evaluate(() => { const h = document.getElementById("d-name"); return h ? h.textContent : ""; }).catch(() => "");
    if (t && t !== "Câmera") return t;
    await sleep(1000);
  }
  return "";
};
const fly = async (page, lat, lng, alt, wait) => {
  await page.evaluate(([a, b, c]) => { window.__olho.S.rotate = false; window.__olho.flyTo(a, b, c, 0); }, [lat, lng, alt]);
  await sleep(wait || 12000);
};

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
  await sleep(15000);
  step("inicio", await state(page));
  await shot(page, "01-globo.png");
});
if (page) {
  await tryStep("sao-paulo", async () => { await fly(page, -23.55, -46.63, 0.05); step("sao-paulo", await state(page)); await shot(page, "02-sao-paulo.png"); });
  await tryStep("nova-york", async () => { await fly(page, 40.758, -73.9855, 0.0012, 15000); step("nova-york", await state(page)); await shot(page, "03-nova-york-rua.png"); });
  await tryStep("camera-londres", async () => {
    const i = await page.evaluate(() => {
      const o = window.__olho, c = o.CAMS;
      let best = -1, bd = 1e9;
      for (let k = 0; k < c.n; k++) { const d = Math.abs(c.lat[k] - 51.5074) + Math.abs(c.lng[k] + 0.1278); if (d < bd) { bd = d; best = k; } }
      if (best >= 0) o.select("cam", o.camRef(best));
      return best;
    });
    await dossierReady(page);
    await sleep(8000);
    step("camera-londres", { i, dossier: await page.evaluate(() => (document.getElementById("dossier").innerText || "").slice(0, 600)) });
    await shot(page, "04-camera-londres.png");
  });
  await tryStep("camera-video", async () => {
    // uma câmera com vídeo ao vivo (HLS) perto de Nova York
    const i = await page.evaluate(() => {
      const o = window.__olho, c = o.CAMS;
      let best = -1, bd = 1e9;
      for (let k = 0; k < c.n; k++) { if (!(c.m[k] & 2)) continue; const d = Math.abs(c.lat[k] - 40.75) + Math.abs(c.lng[k] + 73.99); if (d < bd) { bd = d; best = k; } }
      if (best >= 0) o.select("cam", o.camRef(best));
      return best;
    });
    await dossierReady(page);
    await sleep(15000);
    step("camera-video", { i, dossier: await page.evaluate(() => (document.getElementById("dossier").innerText || "").slice(0, 600)),
      video: await page.evaluate(() => { const v = document.querySelector("#camMedia video"); return v ? { rs: v.readyState, t: v.currentTime, w: v.videoWidth } : null; }) });
    await shot(page, "05-camera-video.png");
  });
  await tryStep("fundos", async () => {
    await page.evaluate(() => { const b = document.querySelector('[data-act="close"]'); if (b) b.click(); });
    await fly(page, 48.8566, 2.3522, 0.12, 5000);
    for (const [bm, file] of [["s2", "06-sem-nuvens.png"], ["gibs", "07-ontem-nasa.png"], ["dark", "08-tatico.png"], ["esri", null]]) {
      await page.evaluate((v) => { const b = document.querySelector('[data-act="basemap"][data-v="' + v + '"]'); if (b) b.click(); }, bm);
      await sleep(10000);
      if (file) await shot(page, file);
    }
  });
  await tryStep("aba-cameras", async () => {
    await page.evaluate(() => { const t = document.getElementById("tab-cams"); if (t) t.click(); });
    await fly(page, -23.0, -45.5, 0.4, 8000);
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
