// Brasil: órgãos públicos com câmeras abertas na web. Cada leitor usa a mesma lista que
// o portal oficial carrega no navegador (descoberta com o farejador, tools/farejar.mjs).
import { UA, fetchJSON, fetchText, clean, xmlBlocks, xmlVal, decodeXml, pool } from "../lib/util.mjs";

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
    let total = 0, noPos = 0, noImg = 0;
    const lost = new Set();
    for (const g of d.Cameras || []) {
      const pois = [...((byRoad.get(g.Name) || new Map()).values())].sort((x, y) => x.km - y.km);
      for (const c of g.Cameras || []) {
        total++;
        const pt = kmToPoint(pois, +c.KM);
        if (!/^https:\/\//i.test(c.Url || "")) { noImg++; continue; }
        if (!pt) { noPos++; lost.add(g.Name + " km " + c.KM); continue; }
        out.push({ id: base.replace(/^https:\/\/(www\.)?/, "") + "-" + c.CameraID, name: clean(`${titleCase(c.Description)} — ${g.DisplayName || g.Name}, km ${c.KM}`),
          lat: pt.lat, lng: pt.lng, img: c.Url, page: base + "/", where: name });
      }
    }
    if (noPos || noImg) ctx.warn(`${name}: ${total} câmeras, ${noPos} sem posição (${[...lost].slice(0, 6).join("; ")}), ${noImg} sem imagem https`);
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

// ---------- coordenadas: UTM no datum SAD69 (cadastros antigos de prefeituras) ----------
function utmToGeo(E, N, zone, south, a, f) {
  const k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), x = E - 500000, y = south ? N - 10000000 : N;
  const mu = y / k0 / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s1 = Math.sin(p1), c1 = Math.cos(p1), t1 = Math.tan(p1), N1 = a / Math.sqrt(1 - e2 * s1 * s1), T1 = t1 * t1, C1 = ep2 * c1 * c1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * s1 * s1, 1.5), D = x / (N1 * k0);
  const lat = p1 - ((N1 * t1) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = ((zone - 1) * 6 - 177) * (Math.PI / 180) + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c1;
  return [(lat * 180) / Math.PI, (lon * 180) / Math.PI];
}
// SAD69 → SIRGAS 2000 (≈ WGS84), parâmetros do IBGE: ΔX = −67,35 m; ΔY = +3,88 m; ΔZ = −38,22 m
export function sad69UtmToWgs84(E, N, zone) {
  const r = Math.PI / 180, [la0, lo0] = utmToGeo(E, N, zone, true, 6378160, 1 / 298.25);
  const xyz = (la, lo, a, f) => { const e2 = f * (2 - f), s = Math.sin(la), n = a / Math.sqrt(1 - e2 * s * s); return [n * Math.cos(la) * Math.cos(lo), n * Math.cos(la) * Math.sin(lo), n * (1 - e2) * s]; };
  const [X, Y, Z] = xyz(la0 * r, lo0 * r, 6378160, 1 / 298.25), x = X - 67.35, y = Y + 3.88, z = Z - 38.22;
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), p = Math.hypot(x, y);
  let la = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) { const s = Math.sin(la), n = a / Math.sqrt(1 - e2 * s * s); la = Math.atan2(z + e2 * n * s, p); }
  return [la / r, Math.atan2(y, x) / r];
}

// Santos ao Vivo: mapa público de câmeras da Prefeitura de Santos (SigSantos). O sistema
// pede uma sessão anônima (abre a página e "autentica" sem usuário) antes de dar a lista.
async function santos(ctx) {
  const B = "https://egov.santos.sp.gov.br/santosmapeada", jar = new Map();
  const req = async (path, body) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(B + path, {
        method: body == null ? "GET" : "POST", body: body == null ? undefined : body, signal: ctl.signal, redirect: "follow",
        headers: {
          "User-Agent": UA, Accept: "application/json, text/javascript, */*; q=0.01", Referer: B + "/Gestao/Cameras/MapaCamera/", "X-Requested-With": "XMLHttpRequest",
          Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "), ...(body == null ? {} : { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }),
        },
      });
      for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const kv = c.split(";")[0], i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
      if (!r.ok) throw new Error("HTTP " + r.status + " em " + path);
      return await r.text();
    } finally { clearTimeout(timer); }
  };
  await req("/Gestao/Cameras/MapaCamera/");
  await req("/Usuario/Usuario/autenticar", "args%5B%5D=&args%5B%5D=");
  const d = JSON.parse(await req("/Gestao/Cameras/Camera/listarPontosCamerasSantosAoVivo", "")).aaData || {};
  const n = (d.IDCAM || []).length, out = [];
  let fails = 0;
  await pool([...Array(n).keys()], 6, async (i) => {
    const E = parseFloat(String(d.X[i]).replace(",", ".")), N = parseFloat(String(d.Y[i]).replace(",", "."));
    if (!Number.isFinite(E) || !Number.isFinite(N)) return;
    let info = null;
    try { info = JSON.parse(await req("/Gestao/Cameras/Camera/exibirNumero", "args%5B%5D=" + encodeURIComponent(d.IDCAM[i]))); } catch (e) { fails++; return; }
    // o portal escreve o endereço da imagem em minúsculas antes de usar (com maiúsculas dá 404)
    const img = info && info.NUMERO ? String(info.NUMERO).trim().toLowerCase() : "";
    if (!/^https:\/\//i.test(img)) { fails++; return; }
    const [lat, lng] = sad69UtmToWgs84(E, N, 23);
    // descrição vem como "Rua A x Rua B" (às vezes sem a segunda rua: "Rua A x")
    const desc = String(info.DESCRICAO || "").replace(/\s+x\s*$/i, "").replace(/\s+x\s+/gi, " × ");
    out.push({ id: String(d.IDCAM[i]), name: clean(desc || d.NUMERO[i]), lat, lng, img, where: "Santos, SP", page: "https://www.santos.sp.gov.br/santosaovivo" });
  });
  if (fails) ctx.warn(fails + " câmeras sem imagem https ou sem detalhes (de " + n + ")");
  return out;
}

// Barueri: mapa de câmeras da Prefeitura (Cidade Inteligente). A lista de pontos é pública;
// a imagem só sai com uma chave de sessão do próprio portal, então o globo mostra o ponto
// e leva à página oficial (sem copiar a imagem).
async function barueri() {
  const B = "https://servicos.barueri.sp.gov.br/cameras/", jar = new Map();
  const req = async (url, body) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(url, { method: body == null ? "GET" : "POST", body: body == null ? undefined : body, signal: ctl.signal, redirect: "follow",
        headers: { "User-Agent": UA, Referer: B, Origin: "https://servicos.barueri.sp.gov.br", "X-Requested-With": "XMLHttpRequest", Accept: "*/*",
          Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "), ...(body == null ? {} : { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }) } });
      for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const kv = c.split(";")[0], i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
      if (!r.ok) throw new Error("HTTP " + r.status + " em " + url.replace(B, ""));
      return new TextDecoder("latin1").decode(await r.arrayBuffer());
    } finally { clearTimeout(timer); }
  };
  await req(B); // a página abre a sessão; a chave sai dela
  const key = (await req(B + "home/Check", "token=")).trim().replace(/^"|"$/g, "");
  if (!/^[\w-]{8,}$/.test(key)) throw new Error("chave do portal recusada");
  const list = JSON.parse(await req(B + "home/GetCameras?key=" + encodeURIComponent(key)));
  return (Array.isArray(list) ? list : []).filter((c) => isFinite(c.lat) && isFinite(c.lon) && Math.abs(c.lat) > 1).map((c) => ({
    id: String(c.cameraId || c.camera), name: clean(String(c.descricao || c.camera || "").replace(/<[^>]+>/g, " "), 110), lat: +c.lat, lng: +c.lon,
    where: "Barueri, SP", page: B,
  }));
}

// Clima ao Vivo: rede privada de câmeras do tempo (torres de provedores de internet, hotéis,
// prédios) no Brasil inteiro. A lista com coordenadas é pública; a imagem fica no site deles,
// então aqui entra só o link para a página de cada câmera.
async function climaAoVivo() {
  const d = await fetchJSON("https://cmsv2.climaaovivo.com.br/api/cameras", { timeout: 60000, headers: { Referer: "https://www.climaaovivo.com.br/", Origin: "https://www.climaaovivo.com.br" } });
  return (d && Array.isArray(d.data) ? d.data : []).filter((c) => String(c.inprivada) !== "1" && c.desurl && isFinite(c.deslatitude) && isFinite(c.deslongitude) && Math.abs(+c.deslatitude) > 0.5)
    .map((c) => ({
      id: String(c.idcamera), name: clean(`${c.descidade} — ${c.destitulo}`, 110), lat: +c.deslatitude, lng: +c.deslongitude,
      where: clean(c.descidade, 60) + ", " + c.dessigla, dir: clean(c.desrosa, 24), type: "clima",
      page: "https://www.climaaovivo.com.br/" + String(c.dessigla).toLowerCase() + "/" + encodeURIComponent(c.desurl),
    }));
}

// Praia Grande: mapa oficial das câmeras de monitoramento da prefeitura (orla, avenidas,
// entradas da cidade). A lista com coordenadas é aberta; a imagem o mapa pede por POST,
// então aqui entra o ponto com o link para o mapa oficial.
async function praiaGrande() {
  const B = "https://cameras.praiagrande.sp.gov.br/aovivo";
  const list = await fetchJSON(B + "/api", { timeout: 60000, headers: { Referer: B } });
  // "POSTE PRAIA 004 - Forte (Briefcam) (Internet)" → "Poste Praia 004 - Forte" (tira anotações internas)
  const tidy = (s) => clean(decodeXml(String(s || "")).replace(/<[^>]+>/g, " ").replace(/\s*\((briefcam|internet|ptz|fixa|speed ?dome|dome)\)/gi, ""), 110)
    .replace(/\b(\p{Lu})(\p{Lu}{2,})\b/gu, (w, a, b) => (/^(SP|BR|PG|AV|CAM|PTZ|UBS|ETEC|SESC|SENAI)$/.test(w) ? w : a + b.toLowerCase()));
  return (Array.isArray(list) ? list : []).filter((c) => isFinite(c.Latitude) && isFinite(c.Longitude) && Math.abs(+c.Latitude) > 1).map((c) => {
    const name = tidy(c.Description || c.Name).replace(/\bAV\./g, "Av.").replace(/\bR\. /g, "R. ");
    return { id: String(c.Id || c.Name), name, lat: +c.Latitude, lng: +c.Longitude, where: "Praia Grande, SP", page: B, type: /praia|orla|quiosque/i.test(name) ? "praia" : undefined };
  });
}

export default [
  {
    id: "motiva", name: "Motiva — câmeras ao vivo das rodovias", org: "Motiva (concessionárias de rodovias, antigo Grupo CCR)", country: "BR", type: "trafego",
    home: "https://rodovias.motiva.com.br/", attr: "Motiva — câmeras das concessionárias", lic: "vídeo público dos sites das concessionárias",
    run: (ctx) => motiva(ctx),
  },
  {
    id: "santos", name: "Santos ao Vivo — câmeras da cidade", org: "Prefeitura de Santos (SigSantos)", country: "BR", type: "cidade",
    home: "https://www.santos.sp.gov.br/santosaovivo", attr: "Prefeitura de Santos — Santos ao Vivo", lic: "imagens públicas do portal Santos ao Vivo",
    run: (ctx) => santos(ctx),
  },
  {
    id: "barueri", name: "Barueri — câmeras da cidade", org: "Prefeitura de Barueri (Cidade Inteligente)", country: "BR", type: "cidade",
    home: "https://servicos.barueri.sp.gov.br/cameras/", attr: "Prefeitura de Barueri", lic: "pontos do mapa público de câmeras; imagem só na página oficial",
    run: () => barueri(),
  },
  {
    id: "praia-grande", name: "Praia Grande — câmeras de monitoramento", org: "Prefeitura da Estância Balneária de Praia Grande", country: "BR", type: "cidade",
    home: "https://cameras.praiagrande.sp.gov.br/aovivo", attr: "Prefeitura de Praia Grande (SEAD)", lic: "pontos do mapa oficial de câmeras; imagem na página oficial",
    run: () => praiaGrande(),
  },
  {
    id: "climaaovivo", name: "Clima ao Vivo (rede privada)", org: "Clima ao Vivo", country: "BR", type: "clima",
    home: "https://www.climaaovivo.com.br/cidades", attr: "Clima ao Vivo", lic: "rede privada: só o link para a câmera no site deles",
    run: () => climaAoVivo(),
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
