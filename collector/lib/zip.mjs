// Leitor mínimo de ZIP (e KMZ, que é um ZIP): lista as entradas pelo diretório central e
// descompacta com o zlib do Node. Sem dependências; cobre "store" (0) e "deflate" (8).
import { inflateRawSync, createInflateRaw } from "node:zlib";

export function unzip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // fim do diretório central: assinatura 0x06054b50 nos últimos 64 KB
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP sem diretório central");
  let n = b.readUInt16LE(eocd + 10), off = b.readUInt32LE(eocd + 16);
  const out = [];
  while (n-- > 0 && b.readUInt32LE(off) === 0x02014b50) {
    const method = b.readUInt16LE(off + 10), csize = b.readUInt32LE(off + 20), size = b.readUInt32LE(off + 24);
    const nlen = b.readUInt16LE(off + 28), xlen = b.readUInt16LE(off + 30), clen = b.readUInt16LE(off + 32), local = b.readUInt32LE(off + 42);
    const name = b.subarray(off + 46, off + 46 + nlen).toString("utf8");
    const raw = () => { const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28); return b.subarray(start, start + csize); };
    out.push({
      name, size, method, raw,
      data: () => {
        if (method === 0) return Buffer.from(raw());
        if (method === 8) return inflateRawSync(raw());
        throw new Error("compressão " + method + " não suportada em " + name);
      },
      // arquivos enormes (um KML de centenas de MB): entrega aos pedaços; fn devolve false para parar
      async eachChunk(fn) {
        if (method === 0) { fn(raw()); return; }
        const inf = createInflateRaw();
        await new Promise((res, rej) => {
          inf.on("data", (d) => { if (fn(d) === false) { inf.destroy(); res(); } });
          inf.on("end", res); inf.on("close", res); inf.on("error", rej);
          inf.end(raw());
        });
      },
    });
    off += 46 + nlen + xlen + clen;
  }
  return out;
}
