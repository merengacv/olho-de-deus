// Descobre o país (código ISO de 2 letras) de uma coordenada, com os contornos
// Natural Earth 1:50m (domínio público). Usado quando a fonte não informa o país.
import { readFileSync } from "node:fs";

const topo = JSON.parse(readFileSync(new URL("./countries-50m.json", import.meta.url), "utf8"));
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map((p) => [(x += p[0]) * sx + tx, (y += p[1]) * sy + ty]); });
const arc = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
const ring = (ids) => { const out = []; ids.forEach((i, k) => { const a = arc(i); for (let j = k ? 1 : 0; j < a.length; j++) out.push(a[j]); }); return out; };

const COUNTRIES = topo.objects.c.geometries.map((g) => {
  const polys = g.type === "Polygon" ? [g.arcs.map(ring)] : g.type === "MultiPolygon" ? g.arcs.map((p) => p.map(ring)) : [];
  const bbs = polys.map((p) => {
    const b = [180, 90, -180, -90];
    for (const [x, y] of p[0]) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    return b;
  });
  return { a2: g.properties.a, name: g.properties.n, polys, bbs };
}).filter((c) => c.polys.length && c.a2);

function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// grade de 5° para achar candidatos rápido
const GRID = new Map();
COUNTRIES.forEach((c, ci) => c.bbs.forEach((b, pi) => {
  for (let gx = Math.floor((b[0] + 180) / 5); gx <= Math.floor((b[2] + 180) / 5); gx++)
    for (let gy = Math.floor((b[1] + 90) / 5); gy <= Math.floor((b[3] + 90) / 5); gy++) {
      const k = gx * 100 + gy;
      if (!GRID.has(k)) GRID.set(k, []);
      GRID.get(k).push([ci, pi]);
    }
}));
const cache = new Map();
export function countryAt(lat, lng) {
  const key = Math.round(lat * 50) + ":" + Math.round(lng * 50);
  if (cache.has(key)) return cache.get(key);
  const cands = GRID.get(Math.floor((lng + 180) / 5) * 100 + Math.floor((lat + 90) / 5)) || [];
  let res = "";
  for (const [ci, pi] of cands) {
    const c = COUNTRIES[ci], b = c.bbs[pi], p = c.polys[pi];
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h))) { res = c.a2; break; }
  }
  // fora de qualquer polígono (litoral, ilha pequena): o país mais próximo num raio de ~0,3°
  if (!res) {
    let best = 0.3;
    for (const [ci, pi] of cands) {
      const c = COUNTRIES[ci], b = c.bbs[pi];
      if (lng < b[0] - best || lng > b[2] + best || lat < b[1] - best || lat > b[3] + best) continue;
      for (const [x, y] of c.polys[pi][0]) { const d = Math.hypot(x - lng, y - lat); if (d < best) { best = d; res = c.a2; } }
    }
  }
  cache.set(key, res);
  return res;
}
export const countryNames = Object.fromEntries(COUNTRIES.map((c) => [c.a2, c.name]));
