// Brasil: órgãos públicos com câmeras abertas na web. Cada leitor usa a mesma lista que
// o portal oficial carrega no navegador (descoberta com o farejador, tools/farejar.mjs).
import { fetchJSON, fetchText, clean, xmlBlocks, xmlVal } from "../lib/util.mjs";

// número da rodovia + km inteiro: junta a lista com coordenadas e a lista com imagens
const roadKey = (rod, km) => {
  const r = String(rod || "").replace(/\D/g, "").replace(/^0+/, "");
  const k = parseFloat(String(km || "").replace(/[^\d,.+]/g, "").replace("+", ".").replace(",", "."));
  return r && isFinite(k) ? r + ":" + Math.round(k) : "";
};

export default [
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
];
