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
const log = { url, when: new Date().toISOString(), steps: [], errors: [], console: [] };
const step = (name, data) => { log.steps.push({ name, at: new Date().toISOString(), ...data }); console.log(name, JSON.stringify(data || {})); };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.console.push(m.text().slice(0, 300)); });
  const failed = {};
  page.on("requestfailed", (r) => { const h = new URL(r.url()).hostname; failed[h] = (failed[h] || 0) + 1; });
  const bad = {};
  page.on("response", (r) => { if (r.status() >= 400) { const h = new URL(r.url()).hostname + " " + r.status(); bad[h] = (bad[h] || 0) + 1; } });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__olho && window.__olho.globe()), null, { timeout: 90000 });
  await page.waitForFunction(() => ["ok", "error"].includes(window.__olho.CAMS.state), null, { timeout: 90000 }).catch(() => {});
  // segunda carga: o service worker já controla a página (rótulos no satélite)
  await sleep(4000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(window.__olho && window.__olho.globe()), null, { timeout: 90000 });
  await page.waitForFunction(() => ["ok", "error"].includes(window.__olho.CAMS.state), null, { timeout: 90000 }).catch(() => {});
  await sleep(12000);
  const state = () => page.evaluate(() => {
    const o = window.__olho, src = {};
    for (const [k, v] of Object.entries(o.S.src)) src[k] = { status: v.status, msg: v.msg, note: v.note, count: v.count };
    return { cams: o.CAMS.state, n: o.CAMS.n, windy: o.S.windy.length, sw: o.SW, basemap: o.S.basemap, level: o.engine() && o.engine().level, pov: o.globe().pointOfView(), src };
  });
  step("inicio", await state());
  await page.screenshot({ path: join(OUT, "01-globo.png") });

  const fly = async (lat, lng, alt, wait) => {
    await page.evaluate(([a, b, c]) => { window.__olho.S.rotate = false; window.__olho.flyTo(a, b, c, 0); }, [lat, lng, alt]);
    await sleep(wait || 12000);
  };
  await fly(-23.55, -46.63, 0.05);
  step("sao-paulo", await state());
  await page.screenshot({ path: join(OUT, "02-sao-paulo.png") });

  await fly(40.758, -73.9855, 0.0012);
  step("nova-york-perto", await state());
  await page.screenshot({ path: join(OUT, "03-nova-york-rua.png") });

  // uma câmera de Londres (TfL, imagem ao vivo)
  const cam = await page.evaluate(() => {
    const o = window.__olho, c = o.CAMS;
    let best = -1, bd = 1e9;
    for (let i = 0; i < c.n; i++) { const d = Math.abs(c.lat[i] - 51.5074) + Math.abs(c.lng[i] + 0.1278); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) o.select("cam", o.camRef(best));
    return best;
  });
  await sleep(12000);
  step("camera-londres", { i: cam, ...(await state()), dossier: await page.evaluate(() => (document.getElementById("dossier").innerText || "").slice(0, 500)) });
  await page.screenshot({ path: join(OUT, "04-camera-londres.png") });

  await page.evaluate(() => { const b = document.querySelector('[data-act="close"]'); if (b) b.click(); });
  await fly(48.8566, 2.3522, 0.12, 4000);
  for (const [bm, file] of [["s2", "05-sem-nuvens.png"], ["gibs", "06-ontem-nasa.png"], ["dark", "07-tatico.png"], ["esri", null]]) {
    await page.evaluate((v) => { const b = document.querySelector('[data-act="basemap"][data-v="' + v + '"]'); if (b) b.click(); }, bm);
    await sleep(9000);
    if (file) await page.screenshot({ path: join(OUT, file) });
  }
  await page.evaluate(() => { const t = document.getElementById("tab-cams"); if (t) t.click(); });
  await fly(51.5, -0.12, 0.08, 6000);
  await page.screenshot({ path: join(OUT, "08-aba-cameras.png") });
  step("fim-desktop", await state());

  // celular
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pt-BR" });
  const mp = await m.newPage();
  mp.on("pageerror", (e) => log.errors.push("celular: " + String(e)));
  await mp.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await mp.waitForFunction(() => !!(window.__olho && window.__olho.CAMS.state === "ok"), null, { timeout: 90000 }).catch(() => {});
  await sleep(10000);
  await mp.screenshot({ path: join(OUT, "09-celular.png") });
  await mp.evaluate(() => { const b = document.querySelector('#mbar [data-sheet="cams"]'); if (b) b.click(); });
  await sleep(3000);
  await mp.screenshot({ path: join(OUT, "10-celular-cameras.png") });

  log.failedHosts = failed;
  log.httpErrors = bad;
} catch (e) {
  log.errors.push("conferir: " + (e && e.stack || e));
} finally {
  await writeFile(join(OUT, "conferir.json"), JSON.stringify(log, null, 1));
  await browser.close();
}
