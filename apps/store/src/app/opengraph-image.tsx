// language: TSX, file: apps/store/src/app/opengraph-image.tsx, target: Next.js App Router (convenção de arquivo)
// Fix do achado #5 da auditoria do site antigo: og:image era o logo quadrado.
// Aqui vira arte própria 1200×630, gerada no build/request — sem asset binário mantido à mão.
import { ImageResponse } from "next/og";

export const alt = "Airsoft Americana — réplicas de airsoft, tiro esportivo e equipamentos táticos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Preço/condição não entra aqui: é dado do banco e variável — cartão é marca, não oferta. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0B0D0C",
          color: "#F4F5F2",
          padding: "56px 64px",
        }}
      >
        {/* Trilho superior — mono, localização e operação */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#929890", letterSpacing: 4, textTransform: "uppercase" }}>
          <span>Americana / SP</span>
          <span>Loja física · Envio nacional</span>
        </div>

        {/* Marca em bloco — sem gradiente, sem glow */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ width: 96, height: 8, backgroundColor: "#8BCF16", marginBottom: 28 }} />
          <div style={{ display: "flex", fontSize: 118, fontWeight: 800, letterSpacing: -2, lineHeight: 1, textTransform: "uppercase" }}>
            <span>Airsoft&nbsp;</span>
            <span style={{ color: "#8BCF16" }}>Americana</span>
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#C8CBC8", marginTop: 22, letterSpacing: 1 }}>
            Répliques de airsoft · Tiro esportivo · Equipamentos táticos
          </div>
        </div>

        {/* Trilho inferior — fatos operacionais verificáveis, sem oferta solta */}
        <div style={{ display: "flex", gap: 48, fontSize: 22, color: "#929890", letterSpacing: 3, textTransform: "uppercase" }}>
          <span>Correios PAC / SEDEX</span>
          <span>Maioridade 18+</span>
          <span>Pagamento no PIX, cartão e boleto</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
