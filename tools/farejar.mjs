// Farejador de portais de câmeras: abre cada página num Chromium de verdade (no GitHub
// Actions), espera o JavaScript carregar e anota tudo o que a página buscou na rede
// (listas JSON, imagens de câmera, vídeos), além das imagens, iframes e vídeos que
// ficaram na tela. Serve para descobrir de onde um portal tira a lista de câmeras e
// escrever um leitor direto para o coletor. Resultado: ramo "farejo".
//
// Uso: node tools/farejar.mjs tools/farejar.json farejo
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const [, , SPEC = "tools/farejar.json", OUT = "farejo"] = process.argv;
const spec = JSON.parse(await readFile(SPEC, "utf8"));
await mkdir(join(OUT, "corpos"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEDIA = /\.(m3u8|mp4|jpe?g|png|webp|mjpg|mjpeg)(\?|$)|snapshot|camera|cctv|webcam|youtube\.com\/embed|player/i;
const summary = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
for (const s of spec.pages || spec) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: s.locale || "pt-BR", userAgent: s.ua || undefined, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const rec = { id: s.id, url: s.url, requests: [], bodies: [], dom: {}, errors: [] };
  let n = 0;
  page.on("response", async (r) => {
    try {
      const req = r.request(), u = r.url(), type = req.resourceType(), ct = (r.headers()["content-type"] || "").toLowerCase();
      const row = { u: u.slice(0, 400), t: type, s: r.status(), ct: ct.slice(0, 60), m: req.method() };
      if (req.method() === "POST") row.post = (req.postData() || "").slice(0, 600);
      rec.requests.push(row);
      const interesting = ["xhr", "fetch", "document", "script"].includes(type) && /json|xml|text|javascript/.test(ct);
      if (interesting && r.status() < 400 && n < (s.maxBodies || 60)) {
        const body = await r.text().catch(() => "");
        if (body && (type !== "script" || MEDIA.test(body.slice(0, 200000)))) {
          const file = `${s.id}-${++n}.txt`;
          await writeFile(join(OUT, "corpos", file), `${req.method()} ${u}\n${row.post ? "POST " + row.post + "\n" : ""}content-type: ${ct}\n\n` + body.slice(0, s.bodyMax || 300000));
          rec.bodies.push({ file, u: u.slice(0, 300), bytes: body.length, type });
        }
      }
    } catch (e) { /* resposta sem corpo */ }
  });
  try {
    await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(s.wait || 15000);
    for (const c of s.clicks || []) {
      try { await page.click(c, { timeout: 5000 }); await sleep(s.clickWait || 6000); } catch (e) { rec.errors.push("clique " + c + ": " + e.message.slice(0, 120)); }
    }
    if (s.scroll) { await page.mouse.wheel(0, 4000); await sleep(4000); }
    rec.title = await page.title();
    rec.dom = await page.evaluate(() => {
      const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
      const pick = (sel, attr) => [...document.querySelectorAll(sel)].map((e) => abs(e.getAttribute(attr) || "")).filter(Boolean).slice(0, 300);
      return {
        img: pick("img[src]", "src"), iframe: pick("iframe[src]", "src"), video: pick("video[src], video source[src]", "src"),
        links: [...document.querySelectorAll("a[href]")].map((a) => ({ h: abs(a.getAttribute("href")), t: (a.textContent || "").trim().slice(0, 80) }))
          .filter((x) => /cam|câmera|camera|ao.vivo|live|webcam|cctv|transito|trânsito/i.test(x.h + " " + x.t)).slice(0, 300),
        text: (document.body ? document.body.innerText : "").slice(0, 3000),
      };
    });
    await page.screenshot({ path: join(OUT, s.id + ".png") }).catch(() => {});
  } catch (e) { rec.errors.push(String(e.message || e).slice(0, 300)); }
  rec.mediaRequests = rec.requests.filter((r) => MEDIA.test(r.u)).slice(0, 200);
  summary.push({ id: rec.id, url: rec.url, title: rec.title, requests: rec.requests.length, bodies: rec.bodies.length, media: rec.mediaRequests.length, errors: rec.errors });
  await writeFile(join(OUT, s.id + ".json"), JSON.stringify(rec, null, 1));
  await ctx.close();
}
await writeFile(join(OUT, "resumo.json"), JSON.stringify(summary, null, 1));
await browser.close();
