// language: JS, file: scripts/optimize-logo.js, target: Node 22+ (sharp no root)
// Normaliza o logo da marca nos 3 destinos (loja public, favicon da loja, admin):
//   1. recorta o bbox do desenho (margens assimétricas causavam "rebarbas");
//   2. recentera em canvas quadrado com margem preta uniforme (4%);
//   3. encanta nitidez leve para o downscale 1254→84/56 não esfarelar;
//   4. grava sRGB+gAMA quando o encoder permitir (PNG sem chunk de cor
//      renderiza mais escuro em alguns pipelines — achado do QA do logo).
// Uso: node scripts/optimize-logo.js [--preview]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "apps/store/public/logo.png");
const MASTER = path.join(ROOT, "apps/store/public/logo.png"); // 1254 (usos no site)
const TARGETS = [
  { file: path.join(ROOT, "apps/store/public/logo.png"), size: 1254 },
  { file: path.join(ROOT, "apps/admin/public/logo.png"), size: 1254 },
  { file: path.join(ROOT, "apps/store/src/app/icon.png"), size: 512 }, // favicon n precisa de 2MB
  { file: path.join(ROOT, "apps/store/public/og-logo.png"), size: 480 }, // card de share (base64 no og)
];
const CANVAS = 1254;
const MARGIN = 0.04; // 4% de folga uniforme

function chunks(buf) {
  const out = [];
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString("latin1");
    out.push(type);
    i += 12 + len;
    if (type === "IEND") break;
  }
  return out.join(" ");
}

(async () => {
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, c = info.channels;
  const lum = (x, y) => {
    const i = (y * w + x) * c;
    return Math.max(data[i], data[i + 1], data[i + 2]);
  };
  const T = 30;
  const colHas = (x) => { for (let y = 0; y < h; y += 2) if (lum(x, y) > T) return true; return false; };
  const rowHas = (y) => { for (let x = 0; x < w; x += 2) if (lum(x, y) > T) return true; return false; };
  let minX = 0; while (minX < w && !colHas(minX)) minX++;
  let maxX = w - 1; while (maxX > 0 && !colHas(maxX)) maxX--;
  let minY = 0; while (minY < h && !rowHas(minY)) minY++;
  let maxY = h - 1; while (maxY > 0 && !rowHas(maxY)) maxY--;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const inner = Math.floor(CANVAS * (1 - MARGIN * 2));
  const scale = Math.min(inner / bw, inner / bh);
  const dw = Math.round(bw * scale), dh = Math.round(bh * scale);
  console.log(`bbox ${bw}x${bh} @(${minX},${minY}) -> desenho ${dw}x${dh} em canvas ${CANVAS}`);

  const art = await sharp(SRC)
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .resize(dw, dh, { kernel: "lanczos3" })
    .sharpen({ sigma: 0.7 }) // compensa o downscale agressivo do header (15x)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const padded = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: art, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  for (const t of TARGETS) {
    let out = padded;
    if (t.size !== CANVAS) {
      out = await sharp(padded).resize(t.size, t.size).png({ compressionLevel: 9 }).toBuffer();
    }
    fs.writeFileSync(t.file, out);
    const st = await sharp(t.file).stats();
    console.log(
      `wrote ${path.relative(ROOT, t.file)} ${t.size}px ${(fs.statSync(t.file).size / 1024).toFixed(0)}KB chunks[${chunks(out)}] mean=${st.channels.slice(0, 3).map((ch) => ch.mean.toFixed(1)).join(",")}`,
    );
  }

  if (process.argv.includes("--preview")) {
    const mk = async (bg, size, file, input) => {
      const fit = Math.round(size * 0.78);
      const art2 = await sharp(input).resize(fit, fit, { fit: "contain", background: bg }).png().toBuffer();
      const img = await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
        .composite([{ input: art2 }])
        .png()
        .toBuffer();
      await sharp(img).jpeg({ quality: 92 }).toFile(file);
    };
    const SRC_OLD = process.env.LOGO_OLD || padded;
    const a = path.join(os.tmpdir(), "logo-dark168.jpg");
    const b = path.join(os.tmpdir(), "logo-dark112.jpg");
    const d = path.join(os.tmpdir(), "logo-light512.jpg");
    await mk({ r: 17, g: 19, b: 21, alpha: 1 }, 168, a, SRC_OLD);
    await mk({ r: 17, g: 19, b: 21, alpha: 1 }, 112, b, SRC_OLD);
    await mk({ r: 244, g: 245, b: 242, alpha: 1 }, 512, d, SRC_OLD);
    const [pa, pb, pd] = await Promise.all([a, b, d].map((f) => sharp(f).toBuffer()));
    const sheet = path.join(os.tmpdir(), "logo-sheet.jpg");
    await sharp({ create: { width: 830, height: 532, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
      .composite([
        { input: pa, left: 10, top: 10 },
        { input: pb, left: 190, top: 10 },
        { input: pd, left: 320, top: 10 },
      ])
      .jpeg({ quality: 92 })
      .toFile(sheet);
    console.log(`preview: ${sheet}`);
  }
})();
