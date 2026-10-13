// Brasil: órgãos públicos com câmeras abertas na web. Cada leitor usa a mesma lista que
// o portal oficial carrega no navegador (descoberta com o farejador, tools/farejar.mjs).
import { fetchJSON, fetchText, clean, xmlBlocks, xmlVal, decodeXml, pool } from "../lib/util.mjs";

// número da rodovia + km inteiro: junta a lista com coordenadas e a lista com imagens
const roadKey = (rod, km) => {
  const r = String(rod || "").replace(/\D/g, "").replace(/^0+/, "");
  const k = parseFloat(String(km || "").replace(/[^\d,.+]/g, "").replace("+", ".").replace(",", "."));
  return r && isFinite(k) ? r + ":" + Math.round(k) : "";
};

// Concessionárias do grupo EcoRodovias: todas usam a mesma plataforma, com a lista de
// câmeras (por km) e pontos de apoio com coordenadas. A posição de cada câmera sai da
// interpolação pelo km entre os pontos conhecidos da mesma rodovia (aproximada).
const ECO = [
  ["Ecovias Imigrantes", "https://www.ecoviasimigrantes.com.br"],
  ["Ecovias Ponte (Rio-Niterói)", "https://www.ecoviasponte.com.br"],
  ["Ecopistas", "https://www.ecopistas.com.br"],
  ["Ecovias Capixaba", "https://www.ecoviascapixaba.com.br"],
  ["Ecosul", "https://www.ecosul.com.br"],
  ["Eco050", "https://www.eco050.com.br"],
  ["Ecovias do Cerrado", "https://www.ecoviasdocerrado.com.br"],
  ["Ecovias do Araguaia", "https://www.ecoviasdoaraguaia.com.br"],
  ["EcoRioMinas", "https://www.ecoriominas.com.br"],
  ["Ecovias Noroeste Paulista", "https://www.ecoviasnoroestepaulista.com.br"],
  ["Ecovias Raposo Castello", "https://www.ecoviasraposocastello.com.br"],
];
const titleCase = (t) => String(t || "").toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
function kmToPoint(pois, km) {
  if (!pois.length || !Number.isFinite(km)) return null;
  if (pois.length === 1) return Math.abs(pois[0].km - km) <= 3 ? pois[0] : null;
  let a = pois[0], b = pois[1];
  for (let i = 0; i < pois.length - 1; i++) { a = pois[i]; b = pois[i + 1]; if (km <= b.km) break; }
  if (km < pois[0].km - 8 || km > pois[pois.length - 1].km + 8) return null; // longe demais dos pontos conhecidos
  const t = b.km === a.km ? 0 : (km - a.km) / (b.km - a.km);
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
async function ecorodovias(ctx) {
  const out = [];
  await pool(ECO, 4, async ([name, base]) => {
    let d;
    try { d = await fetchJSON(base + "/api/playful-map", { timeout: 60000, retries: 1 }); }
    catch (e) { ctx.warn(name + ": " + e.message); return; }
    const byRoad = new Map();
    for (const p of d.RoadInfrastructures || []) {
      const road = p.RoadDirection && p.RoadDirection.Road && p.RoadDirection.Road.Name;
      if (!road || !Number.isFinite(p.Latitude) || !Number.isFinite(p.Longitude) || !Number.isFinite(p.KM) || p.Disabled || (Math.abs(p.Latitude) < 0.1 && Math.abs(p.Longitude) < 0.1)) continue;
      if (!byRoad.has(road)) byRoad.set(road, new Map());
      byRoad.get(road).set(Math.round(p.KM * 10), { km: +p.KM, lat: +p.Latitude, lng: +p.Longitude });
    }
    for (const g of d.Cameras || []) {
      const pois = [...((byRoad.get(g.Name) || new Map()).values())].sort((x, y) => x.km - y.km);
      for (const c of g.Cameras || []) {
        const pt = kmToPoint(pois, +c.KM);
        if (!pt || !/^https:\/\//i.test(c.Url || "")) continue;
        out.push({ id: base.replace(/^https:\/\/(www\.)?/, "") + "-" + c.CameraID, name: clean(`${titleCase(c.Description)} — ${g.DisplayName || g.Name}, km ${c.KM}`),
          lat: pt.lat, lng: pt.lng, img: c.Url, page: base + "/", where: name });
      }
    }
  });
  return out;
}

// Motiva (antigo Grupo CCR): cada concessionária publica as câmeras numa página com
// coordenadas e o vídeo ao vivo (HLS na CloudFront). Concessionárias sem a página dão 404.
const MOTIVA = ["riosp", "autoban", "viaoeste", "rodoanel", "spvias", "viasul", "viacosteira", "vialagos", "pantanal", "sorocabana", "minas-sp", "parana", "msvia", "barcas"];
export function motivaParse(html, slug) {
  const out = [];
  for (const a of html.match(/<article class="cmp-contentfragment cmp-contentfragment--camera[\s\S]*?<\/article>/g) || []) {
    const d = {};
    for (const m of a.matchAll(/element--(\w+)" data-elementValue="([^"]*)"/g)) d[m[1]] = decodeXml(m[2]);
    const [la, lo] = String(d.coordinates || "").split(",").map((x) => parseFloat(x));
    if (!Number.isFinite(la) || !Number.isFinite(lo) || (Math.abs(la) < 0.1 && Math.abs(lo) < 0.1)) continue;
    if (!/^https:\/\/[^\s"]+\.m3u8/i.test(d.streamUrl || "")) continue;
    const road = (String(d.directionFragment || "").match(/\/rodovias\/([a-z]{2,3}-\d{2,3})\//i) || [])[1];
    const cls = (a.match(/cmp-contentfragment--camera cmp-contentfragment--([\w-]+)/) || [])[1];
    const uf = (String(d.name || "").match(/,\s*([A-Z]{2})\s*$/) || [])[1];
    out.push({
      id: slug + "-" + (cls || String(d.name).replace(/\W+/g, "").toLowerCase()),
      name: clean((road ? road.toUpperCase() + " " : "") + String(d.name || d.kilometerDescription || "").replace(/^KM/i, "km")),
      lat: la, lng: lo, hls: d.streamUrl, where: clean([d.nearestCity, uf].filter(Boolean).join(", ")),
      page: `https://rodovias.motiva.com.br/${slug}/cameras-ao-vivo/`,
    });
  }
  return out;
}
async function motiva(ctx) {
  const out = [];
  await pool(MOTIVA, 4, async (slug) => {
    let html;
    try { html = await fetchText(`https://rodovias.motiva.com.br/${slug}/cameras-ao-vivo/`, { timeout: 60000, retries: 1 }); }
    catch (e) { if (!/HTTP 404/.test(e.message)) ctx.warn(slug + ": " + e.message); return; }
    out.push(...motivaParse(html, slug));
  });
  return out;
}

export default [
  {
    id: "motiva", name: "Motiva — câmeras ao vivo das rodovias", org: "Motiva (concessionárias de rodovias, antigo Grupo CCR)", country: "BR", type: "trafego",
    home: "https://rodovias.motiva.com.br/", attr: "Motiva — câmeras das concessionárias", lic: "vídeo público dos sites das concessionárias",
    run: (ctx) => motiva(ctx),
  },
  {
    id: "der-sp", name: "DER-SP — câmeras das rodovias", org: "Departamento de Estradas de Rodagem do Estado de São Paulo", country: "BR", type: "trafego",
    home: "https://dersp.der.sp.gov.br/WebSite/Servicos/ServicosOnline/CamerasOnline.aspx", attr: "DER-SP — Governo do Estado de São Paulo", lic: "imagens públicas do DER-SP",
    run: async (ctx) => {
      const [pts, live, stream] = await Promise.all([
        fetchJSON("http://200.144.30.103:8084/api/cameras", { timeout: 60000 }).catch((e) => { ctx.warn("posições: " + e.message); return []; }),
        fetchText("https://dersp.der.sp.gov.br/Upload/XML/cameraslive.xml", { timeout: 60000 }).catch(() => ""),
        fetchText("https://dersp.der.sp.gov.br/Upload/XML/cameraslivestream.xml", { timeout: 60000 }).catch(() => ""),
      ]);
      const where = new Map();
      for (const p of Array.isArray(pts) ? pts : []) { const k = roadKey(p.rodovia, p.km); if (k && isFinite(p.lat) && isFinite(p.lng)) where.set(k, p); }
      const cams = new Map();
      for (const xml of [live, stream]) for (const b of xmlBlocks(xml, "CameraXML")) {
        if (xmlVal(b, "ativo") === "False") continue;
        const id = xmlVal(b, "id"), rod = xmlVal(b, "rodovia"), km = xmlVal(b, "km"), p = where.get(roadKey(rod, km));
        if (!p) continue;
        const video = xmlVal(b, "videoLink"), image = xmlVal(b, "image"), sentido = xmlVal(b, "sentido");
        const cur = cams.get(id + sentido) || {
          id: id + "-" + clean(sentido, 30), lat: p.lat, lng: p.lng, where: clean(xmlVal(b, "municipio") || p.local) + ", SP",
          name: clean(`${rod} km ${String(km).replace(/,0+$/, "")} — ${xmlVal(b, "localizacao") || p.nome}${sentido ? " (sentido " + sentido + ")" : ""}`),
          page: "https://dersp.der.sp.gov.br/WebSite/Servicos/ServicosOnline/CamerasOnline.aspx",
        };
        if (image && !cur.img) cur.img = "https://dersp.der.sp.gov.br/Upload/Cameras/" + image;
        if (/^https:\/\/.+\.m3u8/i.test(video) && !cur.hls) cur.hls = video;
        cams.set(id + sentido, cur);
      }
      return [...cams.values()];
    },
  },
  {
    id: "recife-cttu", name: "CTTU Recife — câmeras de trânsito", org: "Autarquia de Trânsito e Transporte Urbano do Recife (CTTU)", country: "BR", type: "trafego",
    home: "https://transito-recife.serttel.com.br/", attr: "CTTU — Prefeitura do Recife", lic: "imagens públicas do portal oficial de trânsito",
    run: async () => {
      const html = await fetchText("https://transito-recife.serttel.com.br/", { timeout: 60000 });
      const m = html.match(/let\s+cameras\s*=\s*(\[[\s\S]*?\]);/);
      if (!m) throw new Error("lista de câmeras não encontrada na página");
      return JSON.parse(m[1]).filter((c) => c && c.LatLng).map((c) => ({
        id: String(c.IdCamera), name: clean(c.Endereco || c.Codigo), lat: +c.LatLng.lat, lng: +c.LatLng.lng, where: "Recife, PE",
        img: "https://transito-recife.serttel.com.br/Index?handler=Snapshot&Codigo=" + c.IdCamera, page: "https://transito-recife.serttel.com.br/",
      }));
    },
  },
  {
    id: "ecorodovias", name: "EcoRodovias — câmeras das concessionárias", org: "Grupo EcoRodovias (concessionárias de rodovias)", country: "BR", type: "trafego",
    home: "https://www.ecorodovias.com.br/", attr: "imagens das concessionárias EcoRodovias", lic: "imagens públicas dos sites das concessionárias (posição aproximada pelo km)",
    run: (ctx) => ecorodovias(ctx),
  },
];
