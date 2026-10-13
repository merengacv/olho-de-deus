// Catálogos colaborativos abertos: OpenStreetMap (webcams marcadas no mapa) e Wikidata.
import { fetchJSON, fetchText, clean, isHttp, ytEmbed } from "../lib/util.mjs";

const IMG = /\.(jpe?g|png|gif|webp)(\?.*)?$/i;
export function mediaFromUrl(u) {
  if (!isHttp(u)) return {};
  const yt = ytEmbed(u);
  if (yt) return { emb: yt, page: u };
  if (IMG.test(u)) return { img: u };
  if (/\.m3u8(\?|$)/i.test(u) && /^https:/i.test(u)) return { hls: u };
  return { page: u };
}

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
// caixas (sul, oeste, norte, leste) que somadas cobrem o planeta
const BOXES = [
  [35, -11, 47, 3], [47, -11, 72, 3], [35, 3, 47, 12], [47, 3, 55, 12], [55, 3, 72, 30], [47, 12, 55, 20], [35, 12, 47, 20], [47, 20, 72, 45], [35, 20, 47, 45],
  [-60, -180, 35, -100], [35, -180, 72, -100], [-60, -100, 35, -30], [35, -100, 72, -30], [-60, -30, 35, 45], [-60, 45, 72, 100], [-60, 100, 72, 180], [72, -180, 85, 180],
];

export default [
  { id: "osm", name: "OpenStreetMap — webcams", org: "Colaboradores do OpenStreetMap", country: "", type: "cidade", home: "https://www.openstreetmap.org/", attr: "© colaboradores do OpenStreetMap", lic: "ODbL 1.0",
    run: async (ctx) => {
      const out = new Map(), errs = [];
      for (const b of BOXES) {
        const q = `[out:json][timeout:150];(nwr["contact:webcam"](${b});nwr["webcam"](${b}););out center tags;`;
        let ok = false;
        for (const ep of OVERPASS) {
          try {
            const j = await fetchJSON(ep, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 180000, retries: 1 });
            for (const e of j.elements || []) {
              const t = e.tags || {}, lat = e.lat ?? (e.center && e.center.lat), lng = e.lon ?? (e.center && e.center.lon);
              const url = String(t["contact:webcam"] || t.webcam || "").split(";")[0].trim();
              const m = mediaFromUrl(url);
              if (lat == null || !Object.keys(m).length) continue;
              out.set(e.type + e.id, { id: e.type + "/" + e.id, name: clean(t.name || t["name:en"] || t.description || "Webcam"), lat, lng, ...m,
                type: t.natural === "peak" || t.aerialway ? "montanha" : t.natural === "beach" ? "praia" : t.aeroway ? "aviacao" : t.harbour || t.seamark ? "porto" : undefined });
            }
            ok = true; break;
          } catch (e) { errs.push(`${b}: ${e.message}`); }
        }
        if (!ok) ctx.warn(`OSM: região ${b} falhou`);
      }
      if (!out.size && errs.length) throw new Error(errs.slice(0, 3).join(" | "));
      return [...out.values()];
    } },

  { id: "wikidata", name: "Wikidata — webcams", org: "Colaboradores do Wikidata", country: "", type: "cidade", home: "https://www.wikidata.org/wiki/Property:P4238", attr: "Wikidata", lic: "CC0",
    run: async () => {
      const q = `SELECT ?i ?iLabel ?w ?coord WHERE { ?i wdt:P4238 ?w; wdt:P625 ?coord. SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en,es,fr,de,it,ja,ru,zh". } }`;
      const j = await fetchJSON("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { accept: "application/sparql-results+json", timeout: 120000 });
      const out = new Map();
      for (const b of j.results.bindings) {
        const m = (b.coord && b.coord.value || "").match(/Point\((-?[\d.]+) (-?[\d.]+)\)/);
        if (!m) continue;
        const med = mediaFromUrl(b.w.value);
        if (!Object.keys(med).length) continue;
        const id = b.i.value.split("/").pop() + ":" + b.w.value;
        if (!out.has(id)) out.set(id, { id, name: clean(b.iLabel ? b.iLabel.value : "Webcam"), lat: +m[2], lng: +m[1], ...med });
      }
      return [...out.values()];
    } },
];
