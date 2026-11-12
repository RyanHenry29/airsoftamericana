// language: TSX, file: apps/store/src/app/opengraph-image.tsx, target: Next.js App Router (convenção de arquivo)
// Card de compartilhamento 1200×630 — leitura de link profissional (WhatsApp/LinkedIn/X):
// placa clara, logo em tile preto arredondado, título, descrição e faixa de benefícios.
// Preço/condição numérica não entra: é dado do banco e variável — cartão é marca, não oferta.
// Logo local lido uma vez no escopo do módulo (padrão docs/og + caching de valores previsíveis).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Airsoft Americana — réplicas de airsoft, tiro esportivo e equipamentos táticos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const logoSrc = `data:image/png;base64,${await readFile(join(process.cwd(), "public/og-logo.png"), "base64")}`;

const INK = "#0B0D0C";
const PAPER = "#F4F5F2";
const GREEN = "#7A9A5A";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: PAPER,
          color: INK,
        }}
      >
        {/* Corpo: logo + identidade */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 48,
            padding: "56px 64px 40px 64px",
          }}
        >
          <img
            src={logoSrc}
            width={300}
            height={300}
            style={{ width: 300, height: 300, borderRadius: 24, flex: "none" }}
          />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontSize: 24,
                letterSpacing: 6,
                color: "#4A504A",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Americana · SP
            </div>
            <div
              style={{
                fontSize: 96,
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: INK,
                marginTop: 8,
              }}
            >
              Airsoft Americana
            </div>
            <div
              style={{
                width: 160,
                height: 12,
                backgroundColor: GREEN,
                marginTop: 22,
                marginBottom: 22,
              }}
            />
            <div
              style={{
                fontSize: 33,
                lineHeight: 1.35,
                color: "#333833",
                maxWidth: 700,
              }}
            >
              Réplicas de airsoft, tiro esportivo, upgrades e equipamentos táticos.
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px 28px",
                marginTop: 26,
                fontSize: 24,
                fontWeight: 700,
                color: INK,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 12, height: 12, backgroundColor: GREEN, flex: "none" }} />
                PIX com desconto
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 12, height: 12, backgroundColor: GREEN, flex: "none" }} />
                Parcelamento sem juros
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 12, height: 12, backgroundColor: GREEN, flex: "none" }} />
                Envio para todo o Brasil
              </span>
            </div>
          </div>
        </div>

        {/* Rodapé: linhas de produto da loja */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: INK,
            color: "#F4F5F2",
            padding: "26px 64px",
            fontSize: 18,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            fontWeight: 600,
            whiteSpace: "nowrap",
            columnGap: 32,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 14, flex: "0 1 auto", minWidth: 0 }}>
            <span style={{ width: 12, height: 12, backgroundColor: GREEN, flex: "none" }} />
            Airsoft · Tiro esportivo · Upgrades · Loadout · Aventura
          </span>
          <span style={{ color: GREEN, flex: "none" }}>Loja física · Americana/SP</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
