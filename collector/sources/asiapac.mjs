// Ásia e Oceania: governos com dados abertos de câmeras.
import { fetchJSON, fetchText, clean, xmlBlocks, xmlVal } from "../lib/util.mjs";

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

  { id: "nsw", name: "Live Traffic NSW", org: "Transport for NSW", country: "AU", type: "trafego", home: "https://www.livetraffic.com/", attr: "Transport for NSW", lic: "CC BY 4.0 (Transport for NSW Open Data)",
    run: async () => {
      const j = await fetchJSON("https://www.livetraffic.com/datajson/all-feeds-web.json", { timeout: 90000 });
      const arr = Array.isArray(j) ? j : j.features || [];
      return arr.filter((f) => f && f.eventCategory === "liveCams" && f.properties && f.properties.href).map((f) => ({
        id: f.id, name: clean(`${f.properties.title}${f.properties.view ? " — " + f.properties.view : ""}`), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], img: f.properties.href, dir: f.properties.direction }));
    } },
];
