// Estados Unidos: departamentos de transporte (DOTs), cidades e agências científicas.
import { fetchJSON, fetchText, pool, mercToLatLng, clean, isHttp } from "../lib/util.mjs";

const T = (o) => ({ country: "US", type: "trafego", lic: "dados públicos (governo dos EUA)", ...o });

// ---------- Castle Rock "CARS" (GraphQL) ----------
const CARS_Q = "query MapFeatures($input: MapFeaturesArgs!) { mapFeaturesQuery(input: $input) { mapFeatures { tooltip uri features { geometry } __typename ... on Camera { views(limit: 30) { uri ... on CameraView { title category url sources { type src } } category } } } error { message } } }";
// Uma consulta por estado no zoom 12 devolve as câmeras soltas (sem agrupar). Se ainda
// vier algum grupo ("cluster"), a caixa é dividida em quatro e consultada de novo.
async function cars(api, box) {
  const seen = new Map();
  const ask = async (b, depth) => {
    const q = [{ query: CARS_Q, variables: { input: { north: b[0], south: b[1], east: b[2], west: b[3], zoom: 12, layerSlugs: ["normalCameras"], nonClusterableUris: [] } } }];
    const d = await fetchJSON(api, { body: q, timeout: 120000 });
    const feats = (d && d[0] && d[0].data && d[0].data.mapFeaturesQuery && d[0].data.mapFeaturesQuery.mapFeatures) || [];
    let clusters = 0;
    for (const f of feats) {
      if (!/^camera\//.test(f.uri || "")) { if (/cluster/i.test((f.__typename || "") + (f.uri || ""))) clusters++; continue; }
      if (!f.features || !f.features[0]) continue;
      const [lng, lat] = f.features[0].geometry.coordinates;
      for (const v of f.views || []) {
        const hls = (v.sources || []).map((x) => x && x.src).find((u) => /^https:\/\/.+\.m3u8(\?|$)/i.test(u || "") && !/token=/i.test(u));
        const img = v.category === "IMAGE" && isHttp(v.url) ? v.url : "";
        if (!img && !hls) continue;
        const id = v.uri || f.uri;
        if (!seen.has(id)) seen.set(id, { id, name: clean(v.title || f.tooltip), lat, lng, img: img.replace(/\?\d{10,}$/, ""), hls });
      }
    }
    if (clusters && depth < 3) {
      const mLat = (b[0] + b[1]) / 2, mLng = (b[2] + b[3]) / 2;
      for (const sub of [[b[0], mLat, b[2], mLng], [b[0], mLat, mLng, b[3]], [mLat, b[1], b[2], mLng], [mLat, b[1], mLng, b[3]]]) await ask(sub, depth + 1);
    }
  };
  await ask(box, 0);
  return [...seen.values()];
}

// ---------- ArcGIS (FeatureServer/MapServer) genérico ----------
export async function arcgis(layerUrl, opt = {}) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const u = `${layerUrl}/query?where=${encodeURIComponent(opt.where || "1=1")}&outFields=*&returnGeometry=true&outSR=4326&f=json&resultRecordCount=2000&resultOffset=${offset}`;
    const d = await fetchJSON(u, { timeout: 90000 });
    if (d.error) throw new Error("ArcGIS: " + (d.error.message || "erro"));
    const fs = d.features || [];
    for (const f of fs) {
      const a = f.attributes || {}, g = f.geometry || {};
      let lat = g.y, lng = g.x;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) [lat, lng] = mercToLatLng(lng, lat);
      out.push({ a, lat, lng });
    }
    if (!d.exceededTransferLimit || !fs.length) break;
    offset += fs.length;
  }
  return out;
}
const firstUrl = (a, re) => { for (const v of Object.values(a)) if (typeof v === "string" && /^https?:\/\//i.test(v) && re.test(v)) return v; return ""; };

export default [
  T({ id: "caltrans", name: "Caltrans CCTV", org: "California Department of Transportation", home: "https://cwwp2.dot.ca.gov/vm/iframemap.htm",
    attr: "Caltrans", run: async () => {
      const out = [];
      await pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 4, async (d) => {
        const j = await fetchJSON(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, "0")}.json`, { timeout: 90000 });
        for (const { cctv: c } of j.data || []) {
          if (!c || c.inService !== "true") continue;
          const L = c.location || {}, im = c.imageData || {};
          out.push({ id: `${d}-${c.index}`, name: clean(L.locationName), lat: +L.latitude, lng: +L.longitude, where: clean([L.nearbyPlace, L.county].filter(Boolean).join(", ")),
            img: im.static && im.static.currentImageURL, hls: /^https:.+\.m3u8$/i.test(im.streamingVideoURL || "") ? im.streamingVideoURL : "", dir: L.direction });
        }
      });
      return out;
    } }),

  ...[["ne", "Nebraska 511", "https://new.511.nebraska.gov/api/graphql", [43.1, 39.9, -95.3, -104.1], "Nebraska DOT", 20000],
     ["ia", "511 Iowa", "https://www.511ia.org/api/graphql", [43.6, 40.3, -90.1, -96.7], "Iowa DOT", 120000],
     ["in", "511 Indiana", "https://511in.org/api/graphql", [41.8, 37.7, -84.7, -88.1], "Indiana DOT", 120000],
     ["mn", "511 Minnesota", "https://511mn.org/api/graphql", [49.4, 43.4, -89.4, -97.3], "Minnesota DOT", 120000],
     ["ma", "Mass 511", "https://mass511.com/api/graphql", [42.9, 41.2, -69.8, -73.6], "Massachusetts DOT", 120000],
     ["ks", "KanDrive", "https://www.kandrive.gov/api/graphql", [40.1, 36.9, -94.5, -102.1], "Kansas DOT", 120000],
  ].map(([k, name, api, box, org]) => T({ id: "cars-" + k, name, org, home: api.replace("/api/graphql", "/"), attr: org, run: () => cars(api, box) })),

  // plataforma Iteris (ATIS): o mapa oficial lê um GeoJSON com cada ponto e as câmeras dele
  ...[["sd511", "SD511", "South Dakota DOT", "sd", "https://www.sd511.org/"],
      ["iteris-mt", "511MT", "Montana DOT", "mt", "https://www.511mt.net/"],
      ["iteris-sc", "511SC", "South Carolina DOT", "sc", "https://www.511sc.org/"]].map(([id, name, org, st, home]) => T({ id, name, org, home, attr: org, run: async () => {
    const j = await fetchJSON(`https://${st}.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson`, { timeout: 90000 });
    const out = [];
    for (const f of j.features || []) for (const c of (f.properties && f.properties.cameras) || []) {
      if (!f.geometry || !c || !/^https?:/i.test(c.image || "")) continue;
      out.push({ id: f.id + "-" + c.id, name: clean(`${f.properties.name} — ${c.name}`), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], img: c.image });
    }
    return out;
  } })),

  T({ id: "wsdot", name: "WSDOT", org: "Washington State DOT", home: "https://wsdot.com/travel/real-time/map/", attr: "WSDOT", run: async () => {
    const j = await fetchJSON("https://data.wsdot.wa.gov/travelcenter/Cameras.json");
    return (j.features || []).map((f) => {
      const [lat, lng] = mercToLatLng(f.geometry.x, f.geometry.y), a = f.attributes;
      return { id: String(a.CameraID), name: clean(a.CameraTitle), lat, lng, img: a.ImageURL, dir: a.CompassDirection };
    });
  } }),

  T({ id: "deldot", name: "DelDOT", org: "Delaware DOT", home: "https://deldot.gov/map/", attr: "DelDOT", run: async () => {
    const j = await fetchJSON("https://tmc.deldot.gov/json/videocamera.json");
    return (j.videoCameras || []).filter((c) => c.enabled !== false).map((c) => ({ id: c.id, name: clean(c.title), lat: c.lat, lng: c.lon, hls: c.urls && c.urls.m3u8s, where: c.county }));
  } }),

  T({ id: "modot", name: "MoDOT Traveler", org: "Missouri DOT", home: "https://traveler.modot.org/map/", attr: "MoDOT", run: async () => {
    const j = await fetchJSON("https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json");
    return (Array.isArray(j) ? j : []).map((c, i) => ({ id: String(i) + "-" + (c.html || "").split("/").slice(-2, -1)[0], name: clean(c.location), lat: c.y, lng: c.x, hls: /^https:.+\.m3u8/.test(c.html || "") ? c.html : "" }));
  } }),

  T({ id: "mdchart", name: "Maryland CHART", org: "Maryland State Highway Administration", home: "https://chart.maryland.gov/", attr: "MDOT SHA / CHART", run: async () => {
    const j = await fetchJSON("https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do");
    return (j.data || []).filter((c) => c.commMode === "ONLINE").map((c) => ({ id: c.id, name: clean(c.description || c.name), lat: c.lat, lng: c.lon,
      hls: c.cctvIp ? `https://${c.cctvIp}/rtplive/${c.id}/playlist.m3u8` : "", page: c.publicVideoURL }));
  } }),

  T({ id: "kytc", name: "GoKY", org: "Kentucky Transportation Cabinet", home: "https://goky.ky.gov/", attr: "KYTC", run: async () => {
    const rows = await arcgis("https://services2.arcgis.com/CcI36Pduqd0OR4W9/arcgis/rest/services/trafficCamerasCur_Prd/FeatureServer/0");
    return rows.map(({ a, lat, lng }) => ({ id: String(a.id || a.OBJECTID), name: clean(a.name || a.description), lat, lng,
      img: firstUrl(a, /\.(jpe?g|png)(\?|$)/i) || firstUrl(a, /snapshot|image/i), where: clean(a.county) }));
  } }),

  T({ id: "nycdot", name: "NYC DOT", org: "New York City Department of Transportation", home: "https://webcams.nyctmc.org/", attr: "NYC DOT", run: async () => {
    const j = await fetchJSON("https://webcams.nyctmc.org/api/cameras", { timeout: 60000 });
    return j.filter((c) => String(c.isOnline) !== "false").map((c) => ({ id: c.id, name: clean(c.name), lat: c.latitude, lng: c.longitude, img: c.imageUrl, where: c.area }));
  } }),

  T({ id: "austin", name: "Austin Transportation", org: "City of Austin", home: "https://data.austintexas.gov/", attr: "City of Austin (dados abertos)", run: async () => {
    const j = await fetchJSON("https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=5000");
    return j.filter((c) => c.screenshot_address && c.location && c.camera_status !== "REMOVED").map((c) => ({ id: c.camera_id, name: clean(c.location_name), lat: c.location.coordinates[1], lng: c.location.coordinates[0], img: c.screenshot_address }));
  } }),

  T({ id: "seattle", name: "Seattle Traffic Cameras", org: "Seattle DOT", home: "https://web.seattle.gov/travelers/", attr: "Seattle DOT", run: async () => {
    const j = await fetchJSON("https://web.seattle.gov/Travelers/api/Map/Data?zoomId=13&type=2");
    const out = [];
    for (const f of j.Features || []) for (const c of f.Cameras || []) {
      if (c.Type !== "sdot" || !c.ImageUrl) continue;
      out.push({ id: c.Id, name: clean(c.Description), lat: f.PointCoordinate[0], lng: f.PointCoordinate[1], img: "https://www.seattle.gov/trafficcams/images/" + encodeURI(c.ImageUrl) });
    }
    return out;
  } }),

  T({ id: "alertca", name: "ALERTCalifornia", org: "UC San Diego — ALERTCalifornia", type: "natureza", home: "https://alertcalifornia.org/", attr: "ALERTCalifornia / UC San Diego", lic: "imagens públicas do programa ALERTCalifornia",
    run: async () => {
      const j = await fetchJSON("https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json", { timeout: 90000 });
      return (j.features || []).filter((f) => f.geometry && f.geometry.coordinates && f.geometry.coordinates[0] != null).map((f) => {
        const p = f.properties || {};
        return { id: p.id, name: clean(p.name || p.id), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], img: `https://cameras.alertcalifornia.org/public-camera-data/${encodeURIComponent(p.id)}/latest-frame.jpg`, where: clean(p.county) };
      });
    } }),

  T({ id: "ashcam", name: "USGS AshCam", org: "USGS Volcano Hazards Program", type: "vulcao", home: "https://avo.alaska.edu/webcam/", attr: "USGS", lic: "domínio público (USGS)",
    run: async () => {
      const j = await fetchJSON("https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams", { timeout: 60000 });
      const recent = Date.now() / 1000 - 30 * 86400;
      return (j.webcams || []).filter((c) => c.hasImages === "Y" && (c.lastImageTimestamp || 0) > recent).map((c) => ({
        id: c.webcamCode, name: clean(c.webcamName + (c.vName ? ` (vulcão ${c.vName})` : "")), lat: c.latitude, lng: c.longitude,
        img: c.currentMediumImageUrl || c.currentImageUrl, page: c.externalUrl && /^https?:/.test(c.externalUrl) ? c.externalUrl.replace(/^http:/, "https:") : "" }));
    } }),

  T({ id: "phenocam", name: "PhenoCam Network", org: "PhenoCam (Northern Arizona University)", type: "ciencia", country: "", home: "https://phenocam.nau.edu/", attr: "PhenoCam Network", lic: "dados abertos de pesquisa (CC BY)",
    run: async () => {
      const j = await fetchJSON("https://phenocam.nau.edu/api/cameras/?format=json&limit=3000", { timeout: 120000 });
      return (j.results || []).filter((c) => c.active).map((c) => ({ id: c.Sitename, name: clean((c.sitemetadata && c.sitemetadata.site_description) || c.Sitename), lat: c.Lat, lng: c.Lon,
        img: `https://phenocam.nau.edu/data/latest/${c.Sitename}.jpg`, page: `https://phenocam.nau.edu/webcam/sites/${c.Sitename}/` }));
    } }),

  // FAA WeatherCams: câmeras de tempo para a aviação (Alasca, EUA e Canadá). A API só
  // responde para o próprio site da FAA e as imagens têm nome com data, então entram como
  // ponto com link (abre o mapa oficial no lugar), um por aeródromo/local.
  T({ id: "faa-wcams", name: "FAA WeatherCams", org: "Federal Aviation Administration (EUA)", type: "aviacao", home: "https://weathercams.faa.gov/", attr: "FAA WeatherCams", lic: "dados públicos do governo dos EUA (imagens no site da FAA)",
    run: async () => {
      const j = await fetchJSON("https://weathercams.faa.gov/api/sites", { timeout: 120000, headers: { Referer: "https://weathercams.faa.gov/" } });
      return (j.payload || []).filter((s) => s && s.siteActive !== false && Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && Array.isArray(s.cameras) && s.cameras.length).map((s) => {
        const n = s.cameras.length, dirs = s.cameras.map((c) => c.cameraDirection).filter(Boolean).slice(0, 8).join(", ");
        return {
          id: String(s.siteId), lat: s.latitude, lng: s.longitude, cc: /^[A-Z]{2}$/.test(s.country || "") ? s.country : "",
          name: clean(`${s.siteName}${s.icao ? " (" + s.icao + ")" : ""} — ${n} câmera${n > 1 ? "s" : ""}${dirs ? ": " + dirs : ""}`),
          page: `https://weathercams.faa.gov/map/${(+s.longitude).toFixed(4)},${(+s.latitude).toFixed(4)},11`, where: clean([s.siteArea !== s.siteName ? s.siteArea : "", s.state].filter(Boolean).join(", ")),
        };
      });
    } }),

  T({ id: "ndbc", name: "NOAA BuoyCAM", org: "NOAA National Data Buoy Center", type: "porto", home: "https://www.ndbc.noaa.gov/buoycams.shtml", attr: "NOAA NDBC", lic: "domínio público (NOAA)",
    run: async () => {
      const j = await fetchJSON("https://www.ndbc.noaa.gov/buoycams.php");
      return (Array.isArray(j) ? j : []).filter((b) => b.img).map((b) => ({ id: b.id, name: clean(`Boia ${b.id} — ${b.name}`), lat: b.lat, lng: b.lng,
        img: `https://www.ndbc.noaa.gov/buoycam.php?station=${b.id}`, page: `https://www.ndbc.noaa.gov/station_page.php?station=${b.id}` }));
    } }),
];
