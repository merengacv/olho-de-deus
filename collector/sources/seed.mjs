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
  // já lidas direto da fonte oficial (lista completa e atual): a cópia da semente só duplicaria
  "opencctv_hak", "opencctv_climaaovivo",
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
// esquemas próprios do catálogo de origem que apontam para páginas oficiais conhecidas
const PSEUDO = {
  "chile-dgac": (id) => "https://aipchile.dgac.gob.cl/camara/show/id/" + id, // câmeras dos aeródromos do Chile (DGAC)
};
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
    const pm = feed.match(/^([a-z-]+):\/\/([\w-]+)/i);
    if (pm && PSEUDO[pm[1]]) cam.page = PSEUDO[pm[1]](pm[2]); // endereço interno de outro catálogo: vira link para a página oficial
    else if (LINK_ONLY.has(src)) { if (!isHttp(feed)) { skipped++; continue; } cam.page = feed; }
    // TxDOT: a foto vem num JSON sem permissão para outros sites; vira link para a página do distrito
    else if (ft === "txdot-json") {
      const d = (feed.match(/[?&]districtCode=([A-Z]{3})/) || [])[1];
      if (!d) { skipped++; continue; }
      cam.page = "https://its.txdot.gov/its/District/" + d + "/cameras";
    }
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

// nomes legíveis das redes mais comuns da semente: [nome, responsável]
const SEED_NAMES = {
  txdot: ["TxDOT — câmeras das rodovias do Texas", "Texas Department of Transportation"],
  rivergojp: ["Câmeras dos rios do Japão (川の防災情報)", "MLIT — Ministério da Terra e Transportes do Japão"],
  arcgis_cams: ["Câmeras de DOTs do Meio-Oeste (EUA)", "Departamentos de transporte dos EUA"],
  trafficengland: ["Traffic England", "National Highways (Inglaterra)"],
  camstreamer: ["CamStreamer — transmissões públicas", "CamStreamer (YouTube)"],
  ny511: ["511NY", "New York State DOT"],
  "osm-webcams": ["Webcams do OpenStreetMap", "Colaboradores do OpenStreetMap"],
  trafikverket: ["Trafikverket — câmeras das estradas", "Trafikverket (Suécia)"],
  virginia: ["511 Virginia", "Virginia DOT"],
  houstontranstar: ["Houston TranStar", "Houston TranStar (Texas)"],
  airportwebcams: ["Câmeras de aeroportos", "Aeroportos e serviços meteorológicos"],
  asfinag: ["ASFINAG — câmeras das autoestradas", "ASFINAG (Áustria)"],
  autostrade: ["Autostrade per l'Italia", "Autostrade per l'Italia"],
  openwebcamdb: ["OpenWebcamDB", "OpenWebcamDB (transmissões no YouTube)"],
  hivis: ["HIVIS — câmeras de rios", "U.S. Geological Survey"],
  bayerninfo: ["BayernInfo", "Estado da Baviera (Alemanha)"],
  cotrip: ["COtrip", "Colorado DOT"],
  weatherstem: ["WeatherSTEM", "WeatherSTEM (estações escolares)"],
  skaping: ["Skaping", "Skaping (rede comercial, abre na fonte)"],
  opentrafficcam: ["OHGO", "Ohio DOT"],
  scdot: ["SCDOT Traffic", "South Carolina DOT"],
  "vietnam-traffic": ["Trânsito de Ho Chi Minh", "Departamento de Transportes de Ho Chi Minh (Vietnã)"],
  vegvesen: ["Statens vegvesen — webkamera", "Statens vegvesen (Noruega)"],
  algotraffic: ["AlgoTraffic", "AlgoTraffic (cidades dos EUA)"],
  navcanada: ["NAV CANADA — câmeras de tempo", "NAV CANADA"],
  midot: ["Mi Drive", "Michigan DOT"],
  jakarta: ["CCTV Bali Tower — Jacarta", "Bali Tower e Governo de Jacarta (Indonésia)"],
  jogjaprov: ["CCTV da Província de Yogyakarta", "Governo da Província de Yogyakarta (Indonésia)"],
  myairportcams: ["MyAirportCams", "MyAirportCams"],
  "topis-seoul": ["TOPIS — trânsito de Seul", "Prefeitura de Seul (Coreia do Sul)"],
  travelmidwest: ["Travel Midwest", "Illinois DOT"],
  alberta: ["511 Alberta", "Alberta Transportation"],
  yorkmaps: ["York Region — câmeras de trânsito", "York Region (Ontário)"],
  "ibb-istanbul": ["İBB — trânsito de Istambul", "Prefeitura Metropolitana de Istambul (Turquia)"],
  netravel: ["North East Travel", "Conselhos do Nordeste da Inglaterra"],
  busan: ["ITS Busan", "Prefeitura de Busan (Coreia do Sul)"],
  avamet: ["AVAMET", "Associação Valenciana de Meteorologia"],
  kkr: ["MLIT Kinki — câmeras", "Escritório Regional de Kinki (MLIT, Japão)"],
  eismoinfo: ["Eismo info", "Administração das Estradas da Lituânia"],
  viewsurf: ["Viewsurf", "Viewsurf (rede comercial, abre na fonte)"],
  ottawa: ["Ottawa Traffic", "City of Ottawa"],
  yarnet: ["Câmeras de Iaroslavl", "Yarnet (Rússia)"],
  qldtraffic: ["QLDTraffic", "Queensland Department of Transport"],
  arlingtonva: ["Arlington County", "Arlington County (Virgínia)"],
  "tii-ireland": ["TII Traffic", "Transport Infrastructure Ireland"],
  ulsan: ["ITS Ulsan", "Prefeitura de Ulsan (Coreia do Sul)"],
  trafficwales: ["Traffic Wales", "Governo do País de Gales"],
  "iframe-extract": ["Câmeras de aeroportos (AirportView)", "AirportView"],
  tirol: ["Land Tirol — webcams", "Governo do Tirol (Áustria)"],
  infoclimat: ["Infoclimat", "Infoclimat (França)"],
  "sochi-camera": ["Sochi.camera", "Sochi.camera (Rússia)"],
  siata: ["SIATA — Medellín", "Sistema de Alerta Temprana de Medellín (Colômbia)"],
  trafiroutes: ["Trafiroutes", "Serviço Público da Valônia (Bélgica)"],
  kcscout: ["KC Scout", "Missouri e Kansas DOTs"],
  iceland: ["Vegagerðin — câmeras", "Administração das Estradas da Islândia"],
  nmroads: ["NMRoads", "New Mexico DOT"],
  niigata: ["Câmeras da Província de Niigata", "Governo de Niigata (Japão)"],
  daegu: ["Trânsito de Daegu", "Prefeitura de Daegu (Coreia do Sul)"],
  goyang: ["Trânsito de Goyang", "Prefeitura de Goyang (Coreia do Sul)"],
  nysmesonet: ["NYS Mesonet", "University at Albany (Nova York)"],
  state511: ["511 (estados dos EUA)", "Departamentos de transporte dos EUA"],
  itic: ["ITIC — câmeras de trânsito", "Fundação ITIC (Tailândia)"],
  "explore-org": ["explore.org", "explore.org (câmeras de natureza)"],
  airservices: ["Airservices Australia — câmeras de tempo", "Airservices Australia"],
  pohang: ["Trânsito de Pohang", "Prefeitura de Pohang (Coreia do Sul)"],
  changwon: ["Trânsito de Changwon", "Prefeitura de Changwon (Coreia do Sul)"],
  njta: ["NJ Turnpike", "New Jersey Turnpike Authority"],
  "nexco-japan": ["NEXCO — autoestradas do Japão", "NEXCO"],
  catalonia: ["Servei Català de Trànsit", "Generalitat de Catalunya"],
  jogjakarta: ["CCTV da Cidade de Yogyakarta", "Prefeitura de Yogyakarta (Indonésia)"],
  gwangju: ["Trânsito de Gwangju", "Prefeitura de Gwangju (Coreia do Sul)"],
  ohgo: ["OHGO", "Ohio DOT"],
  dsat: ["DSAT — trânsito de Macau", "Direção dos Serviços para os Assuntos de Tráfego (Macau)"],
  msdot: ["MDOT Traffic", "Mississippi DOT"],
  "cic-tenerife": ["Cabildo de Tenerife — câmeras", "Cabildo de Tenerife"],
  luxembourg: ["CITA", "Administração das Pontes e Estradas (Luxemburgo)"],
  "zdw-krakow": ["ZDW Cracóvia", "Administração Viária de Cracóvia (Polônia)"],
  "chmi-webcams": ["ČHMÚ — webcams", "Instituto Hidrometeorológico Tcheco"],
  andorra: ["Mobilitat Andorra", "Governo de Andorra"],
  kaiho: ["Guarda Costeira do Japão — câmeras", "Guarda Costeira do Japão"],
  "mlit-kanto": ["MLIT Kanto — câmeras", "Escritório Regional de Kanto (MLIT, Japão)"],
  verkeerscentrum: ["Vlaams Verkeerscentrum", "Centro de Tráfego de Flandres (Bélgica)"],
  hak: ["HAK — câmeras", "Hrvatski autoklub (Croácia)"],
  "prague-tsk": ["TSK Praga", "Administração Técnica de Praga (Tchéquia)"],
  "swiss-autobahn": ["ASTRA — autoestradas", "Departamento Federal de Estradas (Suíça)"],
  "arso-si": ["ARSO — webcams", "Agência Ambiental da Eslovênia"],
  "czech-highways": ["Dopravní info", "Diretoria de Estradas (Tchéquia)"],
  "trafficwatch-ni": ["TrafficWatchNI", "Department for Infrastructure (Irlanda do Norte)"],
  meteogalicia: ["MeteoGalicia", "Xunta de Galicia (Espanha)"],
  "hko-webcams": ["Observatório de Hong Kong — câmeras", "Hong Kong Observatory"],
  "chile-dgac": ["DGAC — câmeras dos aeródromos", "Direção Geral de Aeronáutica Civil (Chile)"],
  cetsp: ["CET — câmeras de São Paulo", "Companhia de Engenharia de Tráfego (São Paulo)"],
  "daer-rs": ["DAER-RS — câmeras", "DAER (Rio Grande do Sul)"],
  dersp: ["DER-SP — câmeras", "DER (São Paulo)"],
  "recife-cttu": ["CTTU Recife", "Prefeitura do Recife"],
  "panama-canal": ["Canal do Panamá — câmeras", "Autoridade do Canal do Panamá"],
  ovsicori: ["OVSICORI — vulcões", "Observatório Vulcanológico e Sismológico da Costa Rica"],
  ineter: ["INETER — vulcões", "Instituto Nicaraguense de Estudos Territoriais"],
  "eso-observatories": ["ESO — observatórios", "Observatório Europeu do Sul"],
  hvo: ["HVO — vulcões do Havaí", "U.S. Geological Survey"],
  ipgp: ["IPGP — observatórios vulcanológicos", "Institut de physique du globe de Paris"],
  "emsd-kamchatka": ["Vulcões de Kamchatka", "Serviço Geofísico (Rússia)"],
};
// nome legível para uma fonte da semente
export function seedSourceName(src, cams) {
  const hosts = {};
  for (const c of cams) { const u = c.img || c.hls || c.mp4 || c.emb || c.page || ""; try { const h = new URL(u).hostname.replace(/^www\./, ""); hosts[h] = (hosts[h] || 0) + 1; } catch { /* ignora */ } }
  const top = Object.entries(hosts).sort((a, b) => b[1] - a[1])[0];
  const key = src.replace(/^opencctv_/, ""), fixed = SEED_NAMES[key];
  const label = fixed ? fixed[0] : key.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  return { name: label, host: top ? top[0] : "", org: fixed ? fixed[1] : "" };
}
