// Olho de Deus — service worker dos mapas.
// Junta num só ladrilho a imagem de satélite e as camadas transparentes de
// rótulos (países, cidades, bairros) e de ruas. O globo só sabe desenhar uma
// camada de ladrilhos; este arquivo é o que permite o "satélite com nomes".
// Só intercepta endereços "_t/..."; todo o resto passa direto.
"use strict";

const BASES = {
  esri: (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  s2: (z, y, x) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${z}/${y}/${x}.jpg`,
  gibs: (z, y, x, d) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`,
};
const OVERLAYS = {
  l: (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
  r: (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}`,
};
const RE = /\/_t\/([a-z0-9]+)(?:@(\d{4}-\d{2}-\d{2}))?\/([a-z]*)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.jpg$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  const m = u.pathname.match(RE);
  if (!m || !BASES[m[1]]) return;
  e.respondWith(tile(m));
});

async function bitmap(url) {
  const r = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return createImageBitmap(await r.blob());
}

async function tile(m) {
  const [, base, date, layers, z, y, x] = m;
  const baseUrl = BASES[base](z, y, x, date);
  const passThrough = () => fetch(baseUrl, { mode: "cors", credentials: "omit" });
  if (!layers || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return passThrough();
  let img;
  try { img = await bitmap(baseUrl); } catch (err) { return new Response("", { status: 504 }); }
  // as camadas de nomes só existem até o nível 19; um erro nelas não derruba o ladrilho
  const over = await Promise.all([...layers].map((k) => (OVERLAYS[k] && +z <= 19 ? bitmap(OVERLAYS[k](z, y, x)).catch(() => null) : null)));
  try {
    const w = img.width, h = img.height;
    const cv = new OffscreenCanvas(w, h), ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    for (const o of over) if (o) ctx.drawImage(o, 0, 0, w, h);
    const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return new Response(blob, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" } });
  } catch (err) {
    return passThrough();
  }
}
