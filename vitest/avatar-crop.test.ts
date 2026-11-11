// language: TS, file: vitest/avatar-crop.test.ts, target: vitest (suite da raiz)
// Recorte quadrado da foto de perfil: cobre sem distorcer, centraliza e
// degrada sem quebrar com fonte inválida. (O canvas em si é API de
// navegador — só a geometria é testável em node.)
import { describe, it, expect } from "vitest";
import { coverCrop, AVATAR_SIZE, isAvatarSource } from "../apps/store/src/app/lib/avatar";

describe("coverCrop", () => {
  it("retrato: corta em cima e embaixo, mantendo a altura inteira", () => {
    // 800x1200 → lado 800 → sy = (1200-800)/2 = 200
    expect(coverCrop(800, 1200)).toEqual({ sx: 0, sy: 200, sw: 800, sh: 800 });
  });

  it("paisagem: corta nas laterais, mantendo a largura inteira", () => {
    // 1600x900 → lado 900 → sx = (1600-900)/2 = 350
    expect(coverCrop(1600, 900)).toEqual({ sx: 350, sy: 0, sw: 900, sh: 900 });
  });

  it("quadrado passa inteiro, sem recorte", () => {
    expect(coverCrop(512, 512)).toEqual({ sx: 0, sy: 0, sw: 512, sh: 512 });
  });

  it("o recorte é sempre quadrado e cabe na fonte", () => {
    const cases = [
      [1920, 1080],
      [300, 4000],
      [4000, 300],
      [1, 9999],
      [37, 41],
    ] as const;
    for (const [w, h] of cases) {
      const { sx, sy, sw, sh } = coverCrop(w, h);
      expect(sw).toBe(sh);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx + sw).toBeLessThanOrEqual(w);
      expect(sy + sh).toBeLessThanOrEqual(h);
    }
  });

  it("fonte inválida devolve caixa vazia em vez de estourar", () => {
    expect(coverCrop(0, 0)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(coverCrop(-10, 500)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(coverCrop(Number.NaN, 500)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe("constantes da foto", () => {
  it("sai em 512px JPEG — cabendo no teto de 1 MB do servidor", () => {
    expect(AVATAR_SIZE).toBe(512);
  });

  it("isAvatarSource aceita imagem plausível e recusa o resto", () => {
    const ok = { type: "image/jpeg", size: 3 * 1024 * 1024 } as File;
    const texto = { type: "text/plain", size: 100 } as File;
    const gigante = { type: "image/png", size: 50 * 1024 * 1024 } as File;
    const vazio = { type: "image/png", size: 0 } as File;
    expect(isAvatarSource(ok)).toBe(true);
    expect(isAvatarSource(texto)).toBe(false);
    expect(isAvatarSource(gigante)).toBe(false);
    expect(isAvatarSource(vazio)).toBe(false);
  });
});
