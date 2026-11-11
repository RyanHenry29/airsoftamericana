// language: TS, file: apps/store/src/app/lib/avatar.ts, target: Next.js App Router (client)
// Foto de perfil: recorte quadrado "cover" centralizado + conversão pra JPEG
// no navegador. O cliente envia 512px já reduzido — o servidor só valida
// magic bytes e o teto de 1 MB, nunca decodifica.

export const AVATAR_SIZE = 512;
export const AVATAR_JPEG_QUALITY = 0.85;
/** Teto do arquivo ORIGINAL antes da redução — foto de celular de 10 MP passa. */
export const AVATAR_MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export type CropBox = { sx: number; sy: number; sw: number; sh: number };

/**
 * Maior quadrado centralizado da fonte — a imagem cobre o quadro sem
 * distorcer (recorte vertical ou horizontal conforme a orientação).
 */
export function coverCrop(srcW: number, srcH: number): CropBox {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const side = Math.min(srcW, srcH);
  return { sx: (srcW - side) / 2, sy: (srcH - side) / 2, sw: side, sh: side };
}

/** File de imagem → dataURL JPEG quadrado (canvas). Lança se o navegador não decodificar. */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas indisponível neste navegador");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return canvas.toDataURL("image/jpeg", AVATAR_JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

/** Guarda de entrada do seletor de arquivo: imagem de verdade e tamanho plausível. */
export function isAvatarSource(file: File): boolean {
  return file.type.startsWith("image/") && file.size > 0 && file.size <= AVATAR_MAX_SOURCE_BYTES;
}
