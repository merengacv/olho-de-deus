// Catálogo-semente: o conjunto aberto do projeto Argus (licença MIT,
// github.com/GoSlowPoke168/Argus), que reúne câmeras públicas de centenas de
// órgãos e redes. Entra só o que passa nos filtros abaixo e só para as fontes
// que o coletor ainda não lê direto da origem (essas têm prioridade).
//
// Regras de exclusão (por legalidade ou por não funcionar no navegador):
//  - nada que venha do Windy (os termos do Windy proíbem redistribuir os dados;
//    o Windy entra no painel ao vivo, pela API oficial);
//  - redes comerciais que não autorizam embutir (EarthCam, feratel, Panomax...);
//  - endereços com token de sessão, protocolos próprios ou fotos datadas;
//  - vídeo HLS sem https (o navegador bloqueia em site https).
import { readFile } from "node:fs/promises";
import { fetchText, clean, isHttp, ytEmbed } from "../lib/util.mjs";

export const SEED_URL = "https://raw.githubusercontent.com/GoSlowPoke168/Argus/master/public/cameras.geojson";

const EXCLUDE = new Set([
  "windy", "opencctv_windy", "opencctv_windy-providers", "opencctv_swisswebcams",
  "opencctv_earthcam", "opencctv_feratel", "opencctv_panomax", "opencctv_webcamera-pl", "opencctv_livespotting",
  "opencctv_hdontap", "opencctv_hdontap-wildlife", "opencctv_fws-wildlife", "opencctv_opensnow", "opencctv_opentopia",
  "opencctv_pictimo", "opencctv_worldcam", "opencctv_terrahd", "opencctv_twipcam", "opencctv_camsecure",
  "opencctv_resortcams", "opencctv_ski-brownrice", "opencctv_surfchex", "opencctv_surf-cams", "opencctv_kukaj-sk",
  "opencctv_wowza-streamlock", "opencctv_gray-tv", "opencctv_fox13tampa", "opencctv_cbsdenver", "opencctv_cbs58",
  "opencctv_king5", "opencctv_wlbt", "opencctv_wfie", "opencctv_wreg", "opencctv_whsv", "opencctv_kimt", "opencctv_nbc-montana",
  "opencctv_ipcamlive-global", "opencctv_ipcamlive", "opencctv_oceancity", "opencctv_oceancity-com", "opencctv_beachcam-il",
  "opencctv_caribbean-ipcamlive", "opencctv_pacific-ipcamlive", "opencctv_chinapeak", "opencctv_mazury24", "opencctv_nadmorski24",
  "opencctv_forecastweather", "opencctv_livecameras-gr", "opencctv_goes-satellite", "opencctv_himawari", "opencctv_nasa-worldview",
  "opencctv_nasa-epic", "opencctv_city-webcams", "opencctv_webcamtaxi", "opencctv_savannah-cams", "opencctv_florida-beach-cams",
  "opencctv_hispacams", "opencctv_balticlivecam", "opencctv_naodos-gr", "opencctv_freecam-ro", "opencctv_ibericam",
  "opencctv_airlive", "opencctv_camscape-curated", "opencctv_tabi-cam", "opencctv_portguide",
]);
// páginas de redes comerciais: entram só como link (abre na fonte)
const LINK_ONLY = new Set(["opencctv_skaping", "opencctv_viewsurf", "opencctv_skylinewebcams"]);
const EMBED_OK = /^(https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\/|https:\/\/player\.brownrice\.com\/|https:\/\/g\d?\.?ipcamlive\.com\/player\/|https:\/\/ipcamlive\.com\/player\/|https:\/\/cctv\.balitower\.co\.id\/|https:\/\/player\.tvkur\.com\/|https:\/\/rtsp\.me\/embed\/)/i;
const STALE = /(\{timestamp\}|\/\d{12,14}\.(jpe?g|png)|cam_\d+_\d{9,}\.jpe?g|token=|wmsAuthSign=|[?&]sig(nature)?=)/i;
const TYPES = { traffic: "trafego", landmark: "cidade", beach: "praia", ski: "montanha", weather: "clima", aviation: "aviacao", airport: "aviacao",
  nature: "natureza", water: "rio", port: "porto", volcano: "vulcao", science: "ciencia", observatory: "ciencia", border: "fronteira",
  railway: "ferrovia", space: "ceu", satellite: "ceu", wildlife: "fauna", tourism: "cidade" };

export async function loadSeed(log) {
  const txt = process.env.SEED_FILE ? await readFile(process.env.SEED_FILE, "utf8") : await fetchText(SEED_URL, { timeout: 240000, retries: 2 });
  log(`semente: ${(txt.length / 1e6).toFixed(1)} MB baixados`);
  const gj = JSON.parse(txt);
  const bySrc = new Map();
  let skipped = 0;
  for (const f of gj.features || []) {
    const p = f.properties || {}, src = p.source || "";
    const [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
    if (!src || EXCLUDE.has(src) || !isFinite(lat) || !isFinite(lng)) { skipped++; continue; }
    const feed = p.feedUrl || "", stream = p.streamUrl || "", ft = String(p.feedType || "");
    if (/windy\.com|feratel\.com|panomax\.com|earthcam\.com|ipcamlive\.com\/streams/i.test(feed + stream + (p.playerUrl || ""))) { skipped++; continue; }
    const cam = { id: String(p.id || feed), name: clean(p.name || "Câmera"), lat, lng, cc: p.country && p.country.length === 2 && p.country !== "XX" ? p.country : "", type: TYPES[p.type] || "cidade", where: clean(p.city) };
    if (LINK_ONLY.has(src)) { if (!isHttp(feed)) { skipped++; continue; } cam.page = feed; }
    else if (/^image|mjpeg/.test(ft)) { if (!isHttp(feed) || STALE.test(feed)) { skipped++; continue; } cam.img = feed; }
    else if (ft === "m3u8") { const u = stream || feed; if (!/^https:\/\//i.test(u) || STALE.test(u)) { skipped++; continue; } cam.hls = u; }
    else if (ft === "mp4") { if (!/^https:\/\//i.test(feed)) { skipped++; continue; } cam.mp4 = feed; }
    else if (ft === "iframe") {
      const yt = ytEmbed(feed);
      if (yt) cam.emb = yt;
      else if (EMBED_OK.test(feed)) cam.emb = feed;
      else if (isHttp(feed)) cam.page = feed;
      else { skipped++; continue; }
    } else { skipped++; continue; }
    if (isHttp(p.playerUrl) && !cam.page) cam.page = p.playerUrl;
    if (!bySrc.has(src)) bySrc.set(src, []);
    bySrc.get(src).push(cam);
  }
  log(`semente: ${[...bySrc.values()].reduce((s, a) => s + a.length, 0)} câmeras em ${bySrc.size} fontes (${skipped} descartadas)`);
  return bySrc;
}

// nome legível para uma fonte da semente
export function seedSourceName(src, cams) {
  const hosts = {};
  for (const c of cams) { const u = c.img || c.hls || c.mp4 || c.emb || c.page || ""; try { const h = new URL(u).hostname.replace(/^www\./, ""); hosts[h] = (hosts[h] || 0) + 1; } catch { /* ignora */ } }
  const top = Object.entries(hosts).sort((a, b) => b[1] - a[1])[0];
  const label = src.replace(/^opencctv_/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  return { name: label, host: top ? top[0] : "" };
}
