// Ásia e Oceania: governos com dados abertos de câmeras.
import { fetchJSON, fetchText, clean, xmlBlocks, xmlVal, decodeXml } from "../lib/util.mjs";

export default [
  { id: "hk-td", name: "HK Traffic Snapshots", org: "Transport Department (Hong Kong)", country: "HK", type: "trafego", home: "https://www.td.gov.hk/", attr: "Transport Department, HKSAR (DATA.GOV.HK)", lic: "Termos de uso do DATA.GOV.HK",
    run: async () => {
      const x = await fetchText("https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml", { timeout: 90000 });
      return xmlBlocks(x, "image").map((b) => ({ id: xmlVal(b, "key"), name: clean(xmlVal(b, "description")), lat: +xmlVal(b, "latitude"), lng: +xmlVal(b, "longitude"), img: xmlVal(b, "url"), where: clean(xmlVal(b, "district")) }));
    } },

  { id: "sg-lta", name: "LTA Traffic Images", org: "Land Transport Authority (Singapura)", country: "SG", type: "trafego", home: "https://onemotoring.lta.gov.sg/", attr: "LTA via data.gov.sg", lic: "Singapore Open Data Licence",
    live: "sg",
    run: async () => {
      const j = await fetchJSON("https://api.data.gov.sg/v1/transport/traffic-images");
      const cams = (j.items && j.items[0] && j.items[0].cameras) || [];
      return cams.map((c) => ({ id: c.camera_id, name: "Câmera LTA " + c.camera_id, lat: c.location.latitude, lng: c.location.longitude, img: c.image }));
    } },

  { id: "nzta", name: "NZTA Traffic Cameras", org: "NZ Transport Agency Waka Kotahi", country: "NZ", type: "trafego", home: "https://www.journeys.nzta.govt.nz/traffic-cameras", attr: "NZ Transport Agency Waka Kotahi", lic: "CC BY 4.0",
    run: async () => {
      const j = await fetchJSON("https://www.trafficnz.info/service/traffic/rest/4/cameras/all", { timeout: 90000 });
      const list = (j.response && j.response.camera) || [];
      return list.filter((c) => !c.offline && !c.underMaintenance).map((c) => ({ id: String(c.id), name: clean(`${c.name} — ${c.description || ""}`), lat: c.latitude, lng: c.longitude,
        img: `https://www.trafficnz.info/camera/${c.id}.jpg`, dir: c.direction, where: c.region && c.region.name }));
    } },

  // Queensland: a API aberta do QLDTraffic (chave pública publicada pelo próprio TMR para dados abertos)
  { id: "qldtraffic", name: "QLDTraffic — webcams", org: "Department of Transport and Main Roads (Queensland)", country: "AU", type: "trafego", home: "https://qldtraffic.qld.gov.au/", attr: "QLDTraffic — TMR Queensland", lic: "CC BY 4.0",
    run: async () => {
      const j = await fetchJSON("https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b", { timeout: 90000 });
      return (j.features || []).filter((f) => f && f.properties && /^https:/i.test(f.properties.image_url || "") && f.geometry).map((f) => {
        const p = f.properties;
        return { id: String(p.id), name: clean(p.description), lat: +f.geometry.coordinates[1], lng: +f.geometry.coordinates[0], img: p.image_url,
          dir: clean(p.direction, 24), where: clean([p.locality, p.district].filter(Boolean).join(", ")) };
      });
    } },

  // GeoNet: câmeras dos vulcões da Nova Zelândia. A página oficial lista as câmeras; a posição
  // é a do vulcão observado (ou da cidade onde a câmera fica, quando ela olha de longe).
  { id: "geonet-volcano", name: "GeoNet — câmeras de vulcões", org: "GeoNet (GNS Science / Toka Tū Ake EQC)", country: "NZ", type: "vulcao", home: "https://www.geonet.org.nz/volcano/cameras",
    attr: "GeoNet — GNS Science", lic: "CC BY 3.0 NZ",
    run: async (ctx) => {
      const POS = { raoulisland: [-29.267, -177.917, "Raoul Island (Kermadec)"], tekaha: [-37.744, 177.681, "Te Kaha (vista de Whakaari/White Island)"],
        whakatane: [-37.953, 176.991, "Whakatāne (vista de Whakaari/White Island)"], tongariro: [-39.133, 175.642, "Tongariro"], tongarirotemaaricrater: [-39.107, 175.672, "Tongariro — cratera Te Maari"],
        ruapehunorth: [-39.235, 175.560, "Ruapehu (norte)"], ruapehueast: [-39.281, 175.640, "Ruapehu (leste)"], ruapehusouth: [-39.330, 175.553, "Ruapehu (sul)"],
        ngauruhoe: [-39.157, 175.632, "Ngauruhoe"], ngauruhoetongariro: [-39.150, 175.660, "Ngauruhoe e Tongariro"], taranaki: [-39.296, 174.063, "Taranaki Maunga"] };
      const html = await fetchText("https://www.geonet.org.nz/volcano/cameras", { timeout: 60000 });
      const names = [...new Set([...html.matchAll(/volcano\/cameras\/latest\/([a-z]+)\.jpg/g)].map((m) => m[1]))];
      const out = [];
      for (const n of names) {
        const p = POS[n];
        if (!p) { ctx.warn("câmera nova sem posição conhecida: " + n); continue; }
        out.push({ id: n, name: p[2], lat: p[0], lng: p[1], img: `https://images.geonet.org.nz/volcano/cameras/latest/${n}.jpg`, page: "https://www.geonet.org.nz/volcano/cameras/" + n, where: "Nova Zelândia (posição aproximada)" });
      }
      return out;
    } },

  // MAGMA (PVMBG/ESDM, Indonésia): CCTV dos vulcões. A imagem só abre com endereço assinado
  // que expira, então entra o ponto no vulcão com o link para a página oficial de CCTV.
  { id: "magma-cctv", name: "MAGMA Indonesia — CCTV de vulcões", org: "PVMBG — Badan Geologi, Kementerian ESDM (Indonésia)", country: "ID", type: "vulcao", home: "https://magma.esdm.go.id/v1/gunung-api/cctv",
    attr: "MAGMA Indonesia (PVMBG)", lic: "página oficial: imagem só no site do MAGMA",
    run: async (ctx) => {
      const V = { AGU: [-8.343, 115.508, "Agung"], AWU: [3.689, 125.447, "Awu"], BAT: [-8.242, 115.375, "Batur"], BRO: [-7.942, 112.95, "Bromo"], CER: [-6.892, 108.4, "Ciremai"],
        DEM: [-4.016, 103.121, "Dempo"], DIE: [-7.2, 109.92, "Dieng"], DUK: [1.693, 127.894, "Dukono"], GAM: [0.8, 127.33, "Gamalama"], GED: [-6.78, 106.98, "Gede"], GUN: [-7.143, 107.84, "Guntur"],
        IBU: [1.488, 127.63, "Ibu"], IJE: [-8.058, 114.242, "Ijen"], ILW: [-8.272, 123.505, "Ili Lewotolok"], KAR: [2.78, 125.4, "Karangetang"], KEL: [-7.93, 112.308, "Kelud"], KER: [-1.697, 101.264, "Kerinci"],
        KRA: [-6.102, 105.423, "Anak Krakatau"], LEW: [-8.542, 122.775, "Lewotobi"], LOK: [1.358, 124.792, "Lokon"], MAR: [-0.381, 100.473, "Marapi"], MER: [-7.54, 110.446, "Merapi"], PAP: [-7.32, 107.73, "Papandayan"],
        RAU: [-8.125, 114.042, "Raung"], RIN: [-8.42, 116.47, "Rinjani"], RUA: [2.3, 125.37, "Ruang"], SAL: [-6.72, 106.73, "Salak"], SEM: [-8.108, 112.922, "Semeru"], SIN: [3.17, 98.392, "Sinabung"],
        SLA: [-7.242, 109.208, "Slamet"], SMR: [-8.108, 112.922, "Semeru"], SOP: [1.108, 124.737, "Soputan"], TAN: [-6.77, 107.6, "Tangkuban Parahu"], TAL: [-1.407, 100.682, "Talang"] };
      const B = "https://magma.esdm.go.id/v1/gunung-api/cctv";
      const html = await fetchText(B, { timeout: 90000 });
      const out = [], seen = new Map();
      for (const m of html.matchAll(/data-url="[^"]*\/cctv\/([A-Z]{3})\/show[^"]*"[\s\S]{0,400}?<small class="text-right">([^<]{2,80})<\/small>/g)) {
        const code = m[1], v = V[code];
        if (!v) { ctx.warn("vulcão sem posição conhecida: " + code); continue; }
        const k = (seen.get(code) || 0) + 1;
        seen.set(code, k);
        // várias câmeras do mesmo vulcão: espalha em volta do cume para dar para clicar em cada uma
        const a = k * 2.4, r = 0.01 * Math.sqrt(k);
        out.push({ id: code + "-" + clean(m[2]).replace(/\W+/g, "-").toLowerCase(), name: clean(decodeXml(m[2])), lat: v[0] + r * Math.sin(a), lng: v[1] + r * Math.cos(a),
          where: v[2] + " (posição aproximada)", page: B });
      }
      return out;
    } },

  { id: "nsw", name: "Live Traffic NSW", org: "Transport for NSW", country: "AU", type: "trafego", home: "https://www.livetraffic.com/", attr: "Transport for NSW", lic: "CC BY 4.0 (Transport for NSW Open Data)",
    run: async () => {
      const j = await fetchJSON("https://www.livetraffic.com/datajson/all-feeds-web.json", { timeout: 90000 });
      const arr = Array.isArray(j) ? j : j.features || [];
      return arr.filter((f) => f && f.eventCategory === "liveCams" && f.properties && f.properties.href).map((f) => ({
        id: f.id, name: clean(`${f.properties.title}${f.properties.view ? " — " + f.properties.view : ""}`), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], img: f.properties.href, dir: f.properties.direction }));
    } },

  // Taiwan: rodovias provinciais (公路局) e autoestradas (高公局). A imagem é um fluxo
  // MJPEG contínuo que o navegador mostra numa <img>.
  ...[["tw-thb", "公路局 — CCTV das rodovias provinciais", "Directorate General of Highways (Taiwan)", "thb"],
      ["tw-freeway", "高速公路局 — CCTV das autoestradas", "Freeway Bureau (Taiwan)", "freeway"]].map(([id, name, org, kind]) => ({
    id, name, org, country: "TW", type: "trafego", home: "https://168.thb.gov.tw/", attr: org + " · 168.thb.gov.tw", lic: "dados abertos do governo de Taiwan",
    run: async () => {
      const j = await fetchJSON("https://168.thb.gov.tw/api/Cctvdata/" + kind, { timeout: 90000, headers: { Referer: "https://168.thb.gov.tw/" } });
      return ((j && j.Result) || []).filter((c) => c && /^https:\/\//i.test(c.html || "")).map((c) => ({
        id: c.id, name: clean(c.stakenumber || c.id), lat: +c.gisy, lng: +c.gisx, img: c.html, page: "https://168.thb.gov.tw/",
      }));
    },
  })),
];
