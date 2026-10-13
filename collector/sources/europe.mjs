// Europa: órgãos de trânsito, pontos de acesso nacionais (NAP/DATEX II) e redes abertas.
import { fetchJSON, fetchText, pool, clean, xmlBlocks, xmlVal, xmlAttr, utmToLatLng, isHttp, decodeXml } from "../lib/util.mjs";

export function kmlPlacemarks(kml) {
  return xmlBlocks(kml, "Placemark").map((b) => {
    const coords = (xmlVal(b, "coordinates") || "").split(/[\s,]+/).map(Number);
    const desc = xmlVal(b, "description");
    const img = (desc.match(/https?:\/\/[^"'\s<>]+\.(?:jpe?g|png|gif)(?:\?[^"'\s<>]*)?/i) || [])[0] || "";
    const data = {};
    for (const m of b.matchAll(/<(?:Data|SimpleData) name="([^"]+)"[^>]*>(?:\s*<value>)?([\s\S]*?)(?:<\/value>\s*)?<\/(?:Data|SimpleData)>/g)) data[m[1]] = decodeXml(m[2].trim());
    return { name: xmlVal(b, "name"), desc, img, lng: coords[0], lat: coords[1], data };
  });
}

export default [
  { id: "tfl", name: "TfL JamCams", org: "Transport for London", country: "GB", type: "trafego", home: "https://tfl.gov.uk/traffic/status/", attr: "Powered by TfL Open Data. Contém dados da OS © Crown copyright.", lic: "TfL Open Data",
    run: async () => {
      const j = await fetchJSON("https://api.tfl.gov.uk/Place/Type/JamCam", { timeout: 90000 });
      return j.map((p) => {
        const ap = {}; (p.additionalProperties || []).forEach((a) => { ap[a.key] = a.value; });
        if (ap.available === "false") return null;
        return { id: p.id, name: clean(p.commonName), lat: p.lat, lng: p.lon, img: ap.imageUrl, mp4: ap.videoUrl, dir: ap.view };
      }).filter(Boolean);
    } },

  { id: "dgt", name: "DGT — cámaras de tráfico", org: "Dirección General de Tráfico (Espanha)", country: "ES", type: "trafego", home: "https://infocar.dgt.es/etraffic/", attr: "DGT — Punto de Acceso Nacional (NAP)", lic: "CC BY 4.0",
    run: async () => {
      const x = await fetchText("https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml", { timeout: 120000 });
      return xmlBlocks(x, "device").filter((b) => /<[\w:]*typeOfDevice>camera</.test(b)).map((b) => {
        const road = xmlVal(b, "roadName"), dest = xmlVal(b, "roadDestination"), km = xmlVal(b, "kilometerPoint"), prov = xmlVal(b, "province");
        return { id: xmlAttr(b, "id"), name: clean(`${road}${dest ? " → " + dest : ""}${km ? " (km " + km + ")" : ""}`), lat: +xmlVal(b, "latitude"), lng: +xmlVal(b, "longitude"),
          img: xmlVal(b, "deviceUrl"), where: clean(prov) };
      });
    } },

  { id: "madrid", name: "Madrid — cámaras de tráfico", org: "Ayuntamiento de Madrid (Informo)", country: "ES", type: "trafego", home: "https://informo.madrid.es/", attr: "Ayuntamiento de Madrid — datos abiertos", lic: "Licencia de datos abiertos del Ayuntamiento de Madrid",
    run: async () => {
      const k = await fetchText("https://datos.madrid.es/egob/catalogo/202088-0-trafico-camaras.kml", { timeout: 90000 });
      return kmlPlacemarks(k).filter((p) => p.img || p.data.url).map((p, i) => ({ id: String(i) + "-" + (p.name || ""), name: clean(p.name || p.data.Nombre || "Câmera"), lat: p.lat, lng: p.lng,
        img: (p.img || p.data.url || "").replace(/^http:/, "https:") }));
    } },

  { id: "euskadi", name: "Trafikoa — Euskadi", org: "Gobierno Vasco — Dirección de Tráfico", country: "ES", type: "trafego", home: "https://www.trafikoa.euskadi.eus/", attr: "Open Data Euskadi", lic: "CC BY 4.0 (Open Data Euskadi)",
    run: async () => {
      const first = await fetchJSON("https://api.euskadi.eus/traffic/v1.0/cameras?_page=1");
      const pages = Math.min(first.totalPages || 1, 60);
      const rest = await pool(Array.from({ length: pages - 1 }, (_, i) => i + 2), 4, (p) => fetchJSON(`https://api.euskadi.eus/traffic/v1.0/cameras?_page=${p}`));
      const all = [first, ...rest.filter((r) => r && !(r instanceof Error))].flatMap((p) => p.cameras || []);
      return all.filter((c) => c.urlImage).map((c) => {
        let lat = +c.latitude, lng = +c.longitude;
        if (Math.abs(lat) > 90) [lat, lng] = utmToLatLng(+c.longitude, +c.latitude, 30, true);
        return { id: c.sourceId + "-" + c.cameraId, name: clean(`${c.cameraName}${c.road ? " — " + c.road : ""}${c.kilometer ? " km " + c.kilometer : ""}`), lat, lng, img: c.urlImage, where: clean(c.address) };
      });
    } },

  { id: "digitraffic", name: "Digitraffic — kelikamerat", org: "Fintraffic (Finlândia)", country: "FI", type: "trafego", home: "https://www.digitraffic.fi/en/road-traffic/", attr: "Fintraffic / digitraffic.fi", lic: "CC BY 4.0",
    run: async () => {
      const j = await fetchJSON("https://tie.digitraffic.fi/api/weathercam/v1/stations", { timeout: 90000, headers: { "Digitraffic-User": "olho-de-deus" } });
      const out = [];
      for (const f of j.features || []) {
        const p = f.properties || {};
        if (p.collectionStatus && p.collectionStatus !== "GATHERING") continue;
        const nm = clean(String(p.name || f.id).replace(/_/g, " "));
        for (const pr of p.presets || []) if (pr.inCollection !== false)
          out.push({ id: pr.id, name: nm, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], img: `https://weathercam.digitraffic.fi/${pr.id}.jpg` });
      }
      return out;
    } },

  { id: "fotowebcam", name: "Foto-Webcam.eu", org: "Verein Foto-Webcam.eu", country: "", type: "montanha", home: "https://www.foto-webcam.eu/", attr: "Foto-Webcam.eu", lic: "imagens públicas da rede Foto-Webcam.eu (abrem na fonte)",
    run: async () => {
      const j = await fetchJSON("https://www.foto-webcam.eu/webcam/include/metadata.php", { timeout: 60000 });
      return (j.cams || []).filter((c) => !c.offline && !c.hidden).map((c) => ({ id: c.id, name: clean(c.title || c.name), lat: c.latitude, lng: c.longitude, img: c.imgurl, page: c.link, cc: String(c.country || "").toUpperCase() }));
    } },

  { id: "odh", name: "Open Data Hub Südtirol", org: "NOI Techpark — Província de Bolzano", country: "IT", type: "montanha", home: "https://opendatahub.com/", attr: "Open Data Hub (opendatahub.com)", lic: "conforme a licença de cada item (só itens abertos)",
    run: async () => {
      const out = [];
      for (let page = 1; page <= 60; page++) {
        const j = await fetchJSON(`https://tourism.api.opendatahub.com/v1/WebcamInfo?pagesize=200&pagenumber=${page}&active=true`, { timeout: 90000 });
        for (const it of j.Items || []) {
          const lic = it.LicenseInfo || {};
          if (lic.ClosedData === true || /closed/i.test(lic.License || "") || /feratel|panomax/i.test(it.Source || "")) continue;
          const g = (it.GpsInfo || [])[0] || it.GpsPoints && Object.values(it.GpsPoints)[0];
          if (!g || g.Latitude == null) continue;
          const s = JSON.stringify(it);
          const hls = (s.match(/https:\/\/[^"\\\s]+\.m3u8[^"\\\s]*/i) || [])[0] || "";
          const img = (s.match(/https?:\/\/[^"\\\s]+\.(?:jpe?g|png)(?:\?[^"\\\s]*)?/i) || [])[0] || "";
          const page2 = (it.WebCamProperties && (it.WebCamProperties.WebcamUrl || it.WebCamProperties.WebCamUrl)) || it.Webcamurl || "";
          const det = it.Detail || {}, title = (det.it || det.de || det.en || {}).Title || it.Shortname;
          if (!hls && !img && !isHttp(page2)) continue;
          out.push({ id: it.Id, name: clean(title || "Webcam"), lat: g.Latitude, lng: g.Longitude, img, hls, page: isHttp(page2) ? page2 : "" });
        }
        if (!j.NextPage || !(j.Items || []).length) break;
      }
      return out;
    } },
];
