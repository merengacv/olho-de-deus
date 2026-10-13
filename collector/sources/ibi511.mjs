// Plataforma "511" da IBI/Arcadis, usada por vários estados dos EUA, províncias do
// Canadá e a África do Sul. A lista vem do próprio site oficial (a mesma que a
// página pública usa) e cada câmera tem imagem em /map/Cctv/{id}.
import { fetchJSON, wktPoint, clean } from "../lib/util.mjs";

const INSTANCES = [
  ["ak", "Alaska 511", "511.alaska.gov", "US", "Alaska DOT&PF"],
  ["az", "AZ511", "www.az511.com", "US", "Arizona DOT"],
  ["ga", "Georgia 511", "511ga.org", "US", "Georgia DOT"],
  ["id", "Idaho 511", "511.idaho.gov", "US", "Idaho Transportation Department"],
  ["la", "Louisiana 511", "www.511la.org", "US", "Louisiana DOTD"],
  ["nv", "NVRoads", "www.nvroads.com", "US", "Nevada DOT"],
  ["ut", "UDOT Traffic", "udottraffic.utah.gov", "US", "Utah DOT"],
  ["wi", "511 Wisconsin", "511wi.gov", "US", "Wisconsin DOT"],
  ["ct", "CTroads", "www.ctroads.org", "US", "Connecticut DOT"],
  ["ne", "New England 511", "newengland511.org", "US", "Maine, New Hampshire e Vermont DOTs"],
  ["fl", "FL511", "fl511.com", "US", "Florida DOT"],
  ["pa", "511PA", "www.511pa.com", "US", "PennDOT"],
  ["on", "Ontario 511", "511on.ca", "CA", "Ministry of Transportation Ontario"],
  ["ab", "511 Alberta", "511.alberta.ca", "CA", "Alberta Transportation"],
  ["nb", "511 New Brunswick", "511.gnb.ca", "CA", "New Brunswick DTI"],
  ["ns", "511 Nova Scotia", "511.novascotia.ca", "CA", "Nova Scotia Public Works"],
  ["nl", "511 Newfoundland and Labrador", "511nl.ca", "CA", "Newfoundland and Labrador TI"],
  ["yt", "511 Yukon", "511yukon.ca", "CA", "Yukon Highways and Public Works"],
  ["pe", "511 PEI", "511.gov.pe.ca", "CA", "Prince Edward Island TIE"],
  ["mb", "Manitoba 511", "www.manitoba511.ca", "CA", "Manitoba Transportation"],
  ["sk", "Saskatchewan Highway Hotline", "hotline.gov.sk.ca", "CA", "Saskatchewan Highways"],
  ["za", "i-traffic", "www.i-traffic.co.za", "ZA", "SANRAL (África do Sul)"],
];

const body = (start, length) => ({
  draw: 1,
  columns: [
    { data: "sortId", name: "sortId", searchable: true, orderable: true, search: { value: "", regex: false } },
    { data: "roadway", name: "roadway", searchable: true, orderable: true, search: { value: "", regex: false } },
  ],
  order: [{ column: 0, dir: "asc" }], start, length, search: { value: "", regex: false },
});

async function run(host) {
  const base = "https://" + host;
  const cams = [];
  let start = 0, total = Infinity, guard = 0;
  while (start < total && guard++ < 20) {
    const d = await fetchJSON(base + "/List/GetData/Cameras", { body: body(start, 2500), timeout: 90000, headers: { Referer: base + "/cctv" } });
    const rows = d.data || [];
    total = Math.min(Number(d.recordsFiltered ?? d.recordsTotal ?? rows.length) || rows.length, 50000);
    for (const r of rows) {
      const ll = r.latLng ? wktPoint(r.latLng.geography && r.latLng.geography.wellKnownText) : null;
      const lat = ll ? ll[0] : Number(r.latitude), lng = ll ? ll[1] : Number(r.longitude);
      const site = clean(r.location || (Array.isArray(r.description1) ? r.description1[0] : r.description1) || r.roadway || "Câmera");
      const where = clean([r.city, r.county, r.state].filter(Boolean).join(", "));
      if (Array.isArray(r.images) && r.images.length) {
        for (const im of r.images) {
          if (!im || im.disabled || im.blocked) continue;
          const desc = clean(im.description || "");
          const video = /^https:\/\/.+\.m3u8/i.test(im.videoUrl || "") && !im.isVideoAuthRequired && !im.videoDisabled ? im.videoUrl : "";
          cams.push({ id: String(im.id), name: desc && !site.includes(desc) ? `${site} — ${desc}` : site, lat, lng,
            img: im.imageUrl ? base + im.imageUrl : "", hls: video, where, page: base + "/cctv" });
        }
      } else if (Array.isArray(r.groupedIds) && r.groupedIds.length) {
        r.groupedIds.forEach((gid, i) => {
          const d1 = Array.isArray(r.description1) ? r.description1[i] : r.description1;
          const dir = Array.isArray(r.directionDescriptions) ? r.directionDescriptions[i] : "";
          cams.push({ id: String(gid), name: clean([d1 || site, dir].filter(Boolean).join(" — ")), lat, lng, img: `${base}/map/Cctv/${gid}`, where, page: base + "/cctv" });
        });
      } else if (r.id != null) {
        cams.push({ id: String(r.id), name: site, lat, lng, img: `${base}/map/Cctv/${r.id}`, where, page: base + "/cctv" });
      }
    }
    if (!rows.length) break;
    start += rows.length;
  }
  return cams;
}

export default INSTANCES.map(([k, name, host, cc, org]) => ({
  id: "511-" + k, name, org, country: cc, home: "https://" + host + "/cctv", type: "trafego",
  lic: "dados públicos do órgão de trânsito", attr: org,
  run: () => run(host),
}));
