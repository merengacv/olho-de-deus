// Canadá: províncias e cidades com dados abertos de câmeras.
import { fetchJSON, fetchText, clean, xmlBlocks, xmlVal } from "../lib/util.mjs";

const C = (o) => ({ country: "CA", type: "trafego", ...o });

export default [
  C({ id: "drivebc", name: "DriveBC", org: "BC Ministry of Transportation and Transit", home: "https://www.drivebc.ca/", attr: "DriveBC (Governo da Colúmbia Britânica)", lic: "Open Government Licence – British Columbia",
    run: async () => {
      const j = await fetchJSON("https://www.drivebc.ca/api/webcams/", { timeout: 90000 });
      return (Array.isArray(j) ? j : j.webcams || []).filter((c) => c.is_on !== false && c.should_appear !== false && c.location).map((c) => ({
        id: String(c.id), name: clean(`${c.name}${c.caption ? " — " + c.caption : ""}`), lat: c.location.coordinates[1], lng: c.location.coordinates[0],
        img: `https://www.drivebc.ca/images/${c.id}.jpg`, page: `https://www.drivebc.ca/cameras/${c.id}`, dir: c.orientation }));
    } }),

  C({ id: "quebec511", name: "Québec 511", org: "Ministère des Transports et de la Mobilité durable du Québec", home: "https://www.quebec511.info/", attr: "Gouvernement du Québec (Québec 511)", lic: "CC BY 4.0 (Données Québec)",
    run: async () => {
      const j = await fetchJSON("https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson", { timeout: 90000 });
      return (j.features || []).map((f) => {
        const p = f.properties || {}, id = p.IDEcamera;
        return { id, name: clean(p.DescriptionLocalisationFr || p.DescriptionLocalisationEn), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], where: clean(p.NomRegionDiffusion),
          mp4: `https://www.quebec511.info/Carte/Fenetres/camera.ashx?id=${id}&format=mp4`, page: p.URL_FLUX_DONNEE || `https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=${id}` };
      });
    } }),

  C({ id: "toronto", name: "Toronto RESCU", org: "City of Toronto", home: "https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/restrictions-map/?camera=true", attr: "City of Toronto Open Data", lic: "Open Government Licence – Toronto",
    run: async () => {
      const base = "https://opendata.toronto.ca/transportation/tmc/rescucameraimages/";
      let rows;
      try { rows = await fetchJSON(base + "Data/tmcearthcameras.json", { timeout: 60000 }); } catch { rows = null; }
      if (!rows) {
        const x = await fetchText(base + "Data/tmcearthcameras.xml", { timeout: 60000 });
        rows = xmlBlocks(x, "Camera").map((b) => ({ Number: xmlVal(b, "Number"), Name: xmlVal(b, "Name"), Latitude: xmlVal(b, "Latitude"), Longitude: xmlVal(b, "Longitude") }));
      }
      const list = Array.isArray(rows) ? rows : rows.Data || rows.Cameras || rows.cameras || Object.values(rows).find(Array.isArray) || [];
      return list.map((c) => {
        const num = c.Number ?? c.number ?? c.Num ?? c.id, lat = +(c.Latitude ?? c.latitude ?? c.Lat), lng = +(c.Longitude ?? c.longitude ?? c.Lon);
        return { id: String(num), name: clean(c.Name ?? c.name ?? c.MainRoad ?? ("Câmera " + num)), lat, lng, img: `${base}CameraImages/loc${num}.jpg` };
      });
    } }),

  C({ id: "calgary", name: "Calgary Traffic Cameras", org: "City of Calgary", home: "https://www.calgary.ca/roads/traffic-cameras.html", attr: "City of Calgary Open Data", lic: "Open Government Licence – City of Calgary",
    run: async () => {
      const j = await fetchJSON("https://data.calgary.ca/resource/k7p9-kppz.json?$limit=2000");
      return j.filter((c) => c.point && c.camera_url && c.camera_url.url).map((c) => ({ id: c.camera_url.description || c.camera_url.url, name: clean(c.camera_location), lat: c.point.coordinates[1], lng: c.point.coordinates[0], img: c.camera_url.url }));
    } }),

  C({ id: "vancouver", name: "Vancouver Traffic Cameras", org: "City of Vancouver", home: "https://trafficcams.vancouver.ca/", attr: "City of Vancouver Open Data", lic: "Open Government Licence – Vancouver",
    run: async () => {
      const out = [];
      for (let off = 0; off < 2000; off += 100) {
        const j = await fetchJSON(`https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/web-cam-url-links/records?limit=100&offset=${off}`);
        for (const r of j.results || []) if (r.geo_point_2d) out.push({ id: r.mapid, name: clean(r.name), lat: r.geo_point_2d.lat, lng: r.geo_point_2d.lon, page: r.url, where: clean(r.geo_local_area) });
        if (!j.results || j.results.length < 100) break;
      }
      return out;
    } }),
];
