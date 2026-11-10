// language: JS, file: scripts/logo-inspect.js, target: Node 22+ (sharp no repo root)
// Gera previews do logo sobre fundo escuro/claro + grade de coordenadas para
// diagnosticar "rebarbas" (margens assimétricas) e o escurecimento no header.
const sharp = require("sharp");

const path = require("node:path");
const os = require("node:os");
const SRC = "apps/store/public/logo.png";
const OUT = path.join(os.tmpdir(), "logo-debug");

(async () => {
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, c = info.channels;
  const lum = (x, y) => {
    const i = (y * w + x) * c;
    return Math.max(data[i], data[i + 1], data[i + 2]);
  };

  // Extremos por eixo com threshold alto (o que o olho vê como "desenho").
  const T = 30;
  const colHas = (x) => { for (let y = 0; y < h; y += 2) if (lum(x, y) > T) return true; return false; };
  const rowHas = (y) => { for (let x = 0; x < w; x += 2) if (lum(x, y) > T) return true; return false; };
  let minX = 0; while (minX < w && !colHas(minX)) minX++;
  let maxX = w - 1; while (maxX > 0 && !colHas(maxX)) maxX--;
  let minY = 0; while (minY < h && !rowHas(minY)) minY++;
  let maxY = h - 1; while (maxY > 0 && !rowHas(maxY)) maxY--;
  console.log(`bbox(T=${T}): x ${minX}..${maxX} y ${minY}..${maxY}`);
  console.log(`margins L${minX} R${w - 1 - maxX} T${minY} B${h - 1 - maxY}`);
  console.log(`center: (${((minX + maxX) / 2).toFixed(0)},${((minY + maxY) / 2).toFixed(0)}) vs canvas (${w / 2},${h / 2})`);

  // Recorte quadrado centrado no conteúdo + padding uniforme 3%.
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const side = Math.max(cw, ch);
  const pad = Math.round(side * 0.04);
  const sideP = side + pad * 2;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let left = Math.round(cx - sideP / 2), top = Math.round(cy - sideP / 2);
  left = Math.max(0, Math.min(w - sideP, left));
  top = Math.max(0, Math.min(h - sideP, top));
  console.log(`crop: ${sideP}x${sideP} at (${left},${top})`);

  const cropped = await sharp(SRC)
    .extract({ left, top, width: sideP, height: sideP })
    .png({ compressionLevel: 9 })
    .toBuffer();

  // Preview: header escuro 84px, header mobile 56px, card claro 256px.
  const dark = { r: 17, g: 19, b: 21, alpha: 1 };
  const mk = async (bg, size, file) => {
    const img = await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
      .composite([{ input: cropped, fit: "contain" }])
      .png()
      .toBuffer();
    await sharp(img).jpeg({ quality: 92 }).toFile(`${OUT}-${file}.jpg`);
  };
  await mk(dark, 168, "dark168");   // 2x do header desktop
  await mk(dark, 112, "dark112");   // 2x do header mobile
  await mk({ r: 244, g: 245, b: 242, alpha: 1 }, 512, "light512");
  // Colagem única para ver tudo de uma vez.
  const parts = await Promise.all(["dark168", "dark112", "light512"].map((f) => sharp(`${OUT}-${f}.jpg`).toBuffer()));
  await sharp({ create: { width: 168 + 112 + 512 + 40, height: 512, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
    .composite([
      { input: parts[0], left: 10, top: 10 },
      { input: parts[1], left: 190, top: 10 },
      { input: parts[2], left: 320, top: 10 },
    ])
    .jpeg({ quality: 92 })
    .toFile(`${OUT}-sheet.jpg`);
  console.log(`wrote ${OUT}-sheet.jpg (src mean ${ (await sharp(SRC).stats()).channels.slice(0,3).map(ch=>ch.mean.toFixed(1)).join(",") })`);
})();
