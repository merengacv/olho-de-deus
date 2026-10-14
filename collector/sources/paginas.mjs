// Páginas oficiais de "câmeras ao vivo" de prefeituras e órgãos públicos. Cada página
// embute os vídeos de um jeito (YouTube, Twitch, HLS, WebRTC, Camerite...): o leitor
// baixa a página, acha cada player e o nome escrito junto dele, e posiciona a câmera
// pelo endereço do nome (Nominatim, com cache; cruzamento "Rua A com Rua B" vira o
// ponto onde as duas se encontram) ou, sem endereço, perto do centro da cidade.
import { fetchText, clean, decodeXml } from "../lib/util.mjs";
import { geocodeAll, kmBetween, saveGeocode } from "../lib/geocode.mjs";

// páginas lidas (lat/lng = centro da cidade, usado quando o nome não traz endereço)
export const PAGINAS = [
  { id: "feliz", city: "Feliz", uf: "RS", lat: -29.4527, lng: -51.3058, type: "rio", url: "https://www.feliz.rs.gov.br/site/cameras-ao-vivo", org: "Prefeitura Municipal de Feliz" },
  { id: "nova-friburgo", city: "Nova Friburgo", uf: "RJ", lat: -22.2819, lng: -42.5311, type: "cidade", url: "https://nfci.pmnf.rj.gov.br/camerasaovivo.html", org: "Prefeitura de Nova Friburgo (Cidade Inteligente)", note: "câmeras de terceiros reunidas na página da prefeitura" },
  { id: "sao-caetano", city: "São Caetano do Sul", uf: "SP", lat: -23.6229, lng: -46.5548, type: "cidade", url: "https://www.saocaetanodosul.sp.gov.br/pages/24", org: "Prefeitura de São Caetano do Sul (Defesa Civil)" },
  { id: "rio-das-antas", city: "Rio das Antas", uf: "SC", lat: -26.8946, lng: -51.0744, type: "cidade", url: "https://riodasantas.sc.gov.br/pagina-35081/", org: "Prefeitura de Rio das Antas" },
];

// players reconhecidos: [padrão, (achado) => { emb | hls, key }]. O site troca {host} pelo
// endereço dele (o Twitch só abre o player dentro do site informado em "parent").
const PLAYERS = [
  [/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/i, (m) => ({ key: "yt-" + m[1], emb: "https://www.youtube-nocookie.com/embed/" + m[1] + "?autoplay=1&mute=1&playsinline=1" })],
  [/youtu(?:\.be\/|be\.com\/(?:watch\?v=|live\/))([\w-]{11})/i, (m) => ({ key: "yt-" + m[1], emb: "https://www.youtube-nocookie.com/embed/" + m[1] + "?autoplay=1&mute=1&playsinline=1" })],
  [/player\.twitch\.tv\/\?channel=(\w+)/i, (m) => ({ key: "tw-" + m[1].toLowerCase(), emb: "https://player.twitch.tv/?channel=" + m[1] + "&parent={host}&muted=true&autoplay=true" })],
  [/(https:\/\/[\w.:-]+\/WebRTCApp\/play\.html\?name=([\w-]+))/i, (m) => ({ key: "rtc-" + m[2], emb: m[1] })],
  [/(https:\/\/[\w-]+\.camerite\.com\/embed\/([\w/-]+))/i, (m) => ({ key: "cam-" + m[2].replace(/\W+/g, "-"), emb: m[1] + "?autoplay=true&sound=false" })],
  [/(https:\/\/[\w.-]*ipcamlive\.com\/player\/player\.php\?alias=([\w-]+))/i, (m) => ({ key: "ipc-" + m[2], emb: m[1] + "&autoplay=1" })],
  [/(https:\/\/rtsp\.me\/embed\/([\w-]+))/i, (m) => ({ key: "rtsp-" + m[2], emb: m[1] + "/" })],
  [/(https:\/\/www\.nethorizontes\.com\.br\/flashmediaserver\/([\w-]+))/i, (m) => ({ key: "nh-" + m[2], emb: m[1] })],
  [/(https:\/\/[^\s"'<>]+?\.m3u8)/i, (m) => ({ key: "hls-" + m[1].replace(/^https:\/\/[^/]+\//, "").replace(/\.m3u8$/, "").replace(/\W+/g, "-").slice(-60), hls: m[1] })],
];
const ANY = new RegExp(PLAYERS.map(([re]) => re.source).join("|"), "gi");
// "Imagens: Fulano" / "Fonte: ..." (créditos, não nomes); títulos genéricos da página
const CREDIT = /^(imagens?|fonte|cr[eé]ditos?|realiza[cç][aã]o|apoio|patroc[ií]nio|transmiss[aã]o)\s*:/i;
const GENERIC = /c[aâ]meras?\s+(ao\s+vivo|de\s+monitoramento|online)|^ao\s+vivo$|^assista|^clique|^aten[cç][aã]o/i;

const SMALL = new Set(["da", "de", "do", "das", "dos", "e", "com", "na", "no", "em", "x"]);
const titleCase = (s) => s.toLowerCase().replace(/[\p{L}\d]+/gu, (w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
function tidy(s) {
  s = clean(decodeXml(s || ""))
    .replace(/^(acesse|veja|assista|confira)\s+(a|à|as)?\s*c[aâ]meras?\s+(d[oae]s?\s+)?/i, "")
    .replace(/^c[aâ]mera\s*\d*\s*[:\-–]\s*/i, "")
    .replace(/\s+ao\s+vivo\s*$/i, "").replace(/^[-–:|•\s]+|[-–:|•\s]+$/g, "");
  if (s.length > 3 && s === s.toUpperCase() && /\p{Lu}{3}/u.test(s)) s = titleCase(s);
  return s;
}

// pedaços de texto entre as tags (com a marcação que veio antes de cada um), sem scripts,
// estilos e restos de tag cortada no início
function pieces(html) {
  const h = html.replace(/^[^<]*>/, "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ");
  const out = [];
  let tags = "";
  for (const part of h.split(/(<[^>]+>)/)) {
    if (part.startsWith("<")) { tags += part; continue; }
    const t = decodeXml(part).replace(/\s+/g, " ").trim();
    if (t.length < 2 || /[{};]|^\W+$|="|">/.test(t)) { tags += part; continue; }
    out.push({ t, before: tags });
    tags = "";
  }
  return out;
}
const fragments = (html) => pieces(html).map((p) => p.t);
// entre o rótulo e o nome só pode haver quebra de linha ou negrito (mesmo bloco)
const SAME_BLOCK = /^(\s|<br\s*\/?>|<\/?(strong|b|em|i|span|small|font|u)\b[^>]*>)*$/i;

// nome: texto do próprio link (quando o player é um <a>), senão o último texto antes do
// player; o texto curto logo acima, no mesmo bloco, vira o bairro ("Centro — Av. Rui Barbosa")
function nameFor(html, start, from) {
  const tagStart = html.lastIndexOf("<", start), tag = html.slice(tagStart, html.indexOf(">", start) + 1);
  if (/^<a\s/i.test(tag)) {
    const close = html.indexOf("</a>", start), inner = close > 0 ? fragments(html.slice(html.indexOf(">", start) + 1, close)).join(" ") : "";
    const title = (tag.match(/\btitle="([^"]{3,80})"/i) || [])[1];
    const n = tidy(inner) || tidy(title);
    if (n && !GENERIC.test(n)) return { name: n, label: "" };
  }
  let fr = pieces(html.slice(Math.max(from, tagStart - 1500), tagStart));
  const k = fr.map((p) => CREDIT.test(p.t)).lastIndexOf(true);
  if (k >= 0) fr = fr.slice(0, k);
  fr = fr.filter((p) => !GENERIC.test(p.t));
  const last = fr.pop(), prev = fr.pop();
  const name = tidy(last ? last.t : "");
  let label = prev && SAME_BLOCK.test(last.before) ? tidy(prev.t) : "";
  if (label.length > 30 || /\d/.test(label) || CREDIT.test(label)) label = "";
  return { name: clean(name, 90), label: clean(label, 40) };
}

export function parsePage(html) {
  const out = [], seen = new Set();
  let lastEnd = 0;
  ANY.lastIndex = 0;
  for (let m; (m = ANY.exec(html));) {
    let media = null;
    for (const [re, fn] of PLAYERS) { const mm = m[0].match(re); if (mm) { media = fn(mm); break; } }
    const end = m.index + m[0].length;
    if (!media || seen.has(media.key) || /\/(ad|ads|banner)s?\//i.test(media.hls || media.emb)) { lastEnd = Math.max(lastEnd, end); continue; }
    seen.add(media.key);
    out.push({ ...media, ...nameFor(html, m.index, lastEnd) });
    lastEnd = end;
  }
  return out;
}

// ---------- posição pelo endereço ----------
const ABBR = [
  [/\bav\.?(?=\s)/gi, "Avenida"], [/\br\.(?=\s)/gi, "Rua"], [/\bpç?a\.?(?=\s)/gi, "Praça"], [/\best\.(?=\s)/gi, "Estrada"],
  [/\brod\.(?=\s)/gi, "Rodovia"], [/\btv\.(?=\s)/gi, "Travessa"], [/\bal\.(?=\s)/gi, "Alameda"], [/\bcomte\.?(?=\s)/gi, "Comandante"],
  [/\bcde\.?(?=\s)/gi, "Conde"], [/\bpres\.(?=\s)/gi, "Presidente"], [/\bgov\.(?=\s)/gi, "Governador"], [/\bdr\.(?=\s)/gi, "Doutor"],
  [/\bprof\.(?=\s)/gi, "Professor"], [/\beng\.(?=\s)/gi, "Engenheiro"], [/\bsta?\.(?=\s)/gi, "Santa"], [/\bvér?\.(?=\s)/gi, "Vereador"],
];
const STREET = /\b(rua|avenida|pra[cç]a|estrada|rodovia|travessa|alameda|largo|viaduto|t[uú]nel|ponte|passarela|marginal)\b/i;
// "Fundação, Av dos Estados com Rua Mariano Pamplona" → ["Avenida dos Estados", "Rua Mariano Pamplona"]
export function streetsOf(name) {
  let s = " " + String(name || "") + " ";
  for (const [re, to] of ABBR) s = s.replace(re, to);
  const parts = s.split(/\s+(?:x|×|com|esquina\s+com|esq\.?|e|\/)\s+|[,;()|–]|\s-\s/i)
    .map((p) => p.trim().replace(/\s+(n[º°o]\.?\s*)?\d+.*$/i, "").replace(/\s+(\(.*|rotat[oó]ria|sentido.*)$/i, "").trim());
  const out = [];
  for (const p of parts) {
    const i = p.search(STREET);
    if (i >= 0 && p.length - i > 6 && !/\b(RS|SC|PR|SP|RJ|MG|BR|ES|BA|GO|MT|MS|PE|CE)$/.test(p)) out.push(p.slice(i));
    // a segunda rua às vezes vem sem "Rua"/"Av." ("Av. A x Justino Paixão")
    else if (out.length === 1 && /^\p{Lu}[\p{L}.]+(\s+(d[aeo]s?\s+)?\p{Lu}[\p{L}.]+)+$/u.test(p)) out.push(p);
    if (out.length === 2) break;
  }
  return out;
}

async function locate(name, pg, opt) {
  const near = [pg.lat, pg.lng, 25];
  const [a, b] = streetsOf(name);
  if (!a) return null;
  const A = await geocodeAll(`${a}, ${pg.city}, ${pg.uf}, Brasil`, { ...opt, near });
  if (!A.length) return null;
  if (b) {
    const B = await geocodeAll(`${b}, ${pg.city}, ${pg.uf}, Brasil`, { ...opt, near });
    let best = null;
    for (const p of A) for (const q of B) { const d = kmBetween(p, q); if (!best || d < best.d) best = { d, p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] }; }
    if (best && best.d < 0.6) return best.p.map((v) => Math.round(v * 1e5) / 1e5);
  }
  return A[0];
}

async function readPage(pg, ctx) {
  const html = await fetchText(pg.url, { timeout: 60000, retries: 1, charset: "auto" });
  const found = parsePage(html), out = [];
  let k = 0;
  for (const f of found) {
    k++;
    const name = clean([f.label, f.name].filter(Boolean).join(" — ") || `Câmera ${k}`, 120);
    let pos = await locate(f.name, pg, { cache: ctx.cache }), approx = false;
    if (!pos) {
      // sem endereço: espalha em volta do centro (espiral de poucas dezenas de metros), para dar para clicar em cada uma
      const a = k * 2.4, r = 0.0006 * Math.sqrt(k);
      pos = [pg.lat + r * Math.sin(a), pg.lng + (r * Math.cos(a)) / Math.cos((pg.lat * Math.PI) / 180)];
      approx = true;
    }
    out.push({ id: pg.id + "-" + f.key, name, lat: pos[0], lng: pos[1], hls: f.hls, emb: f.emb, page: pg.url, cc: "BR",
      where: `${pg.city}, ${pg.uf}${approx ? " (posição aproximada)" : ""}` });
  }
  if (!out.length) throw new Error("nenhum player encontrado na página");
  return out;
}

export default PAGINAS.map((pg) => ({
  id: "pref-" + pg.id, name: `${pg.city} (${pg.uf}) — câmeras ao vivo`, org: pg.org, country: "BR", type: pg.type,
  home: pg.url, attr: pg.org + (pg.note ? " · " + pg.note : ""), lic: "vídeo público da página oficial (posição pelo endereço do nome)",
  run: async (ctx) => { try { return await readPage(pg, ctx); } finally { await saveGeocode(); } },
}));
