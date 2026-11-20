// language: TSX, file: apps/store/src/app/components/PaymentMarks.tsx, target: Next.js App Router
// Marcas de pagamento desenhadas aqui mesmo (sem assets de terceiros).
//
// O fundo do chip é CSS e a wordmark é texto de verdade: texto dentro de SVG
// não escala, some para o leitor de tela e o verificador de contraste lê a
// cor CSS herdada — não o atributo `fill`. Cada chip tem fundo e cor de
// texto com contraste >= 4,5:1 (WCAG 2.1 AA).
type Mark = {
  key: string;
  label: string;
  bg: string;
  fg: string;
  word?: React.ReactNode;
  art?: React.ReactNode;
  stack?: boolean;
};

const marks: Mark[] = [
  {
    key: "visa",
    label: "Visa",
    bg: "#ffffff",
    fg: "#1A1F71",
    word: <span style={{ fontStyle: "italic", letterSpacing: "0.06em" }}>VISA</span>,
  },
  {
    key: "mastercard",
    label: "Mastercard",
    bg: "#ffffff",
    fg: "#111111",
    art: (
      <>
        <circle cx="26.5" cy="18" r="10.5" fill="#EB001B" />
        <circle cx="37.5" cy="18" r="10.5" fill="#F79E1B" fillOpacity="0.92" />
        <path d="M32 9.06a10.5 10.5 0 0 1 0 17.88a10.5 10.5 0 0 1 0-17.88Z" fill="#FF5F00" />
      </>
    ),
  },
  {
    key: "elo",
    label: "Elo",
    bg: "#111111",
    fg: "#ffffff",
    stack: true,
    word: <span style={{ letterSpacing: "0.04em" }}>elo</span>,
    art: (
      <>
        <circle cx="22" cy="8" r="2.8" fill="#00A4E4" />
        <circle cx="32" cy="8" r="2.8" fill="#FFCB05" />
        <circle cx="42" cy="8" r="2.8" fill="#EF4123" />
      </>
    ),
  },
  {
    key: "hipercard",
    label: "Hipercard",
    // Laranja escurecido de propósito: branco sobre o laranja original
    // (#F37021) dava 2,9:1 — abaixo do mínimo AA.
    bg: "#B34700",
    fg: "#ffffff",
    word: (
      <span style={{ lineHeight: 1.02 }}>
        HYPER
        <br />
        CARD
      </span>
    ),
  },
  {
    key: "amex",
    label: "American Express",
    bg: "#2E77BC",
    fg: "#ffffff",
    word: <span style={{ letterSpacing: "0.04em" }}>AMEX</span>,
  },
  {
    key: "boleto",
    label: "Boleto bancário",
    bg: "#ffffff",
    fg: "#111111",
    stack: true,
    word: <span style={{ letterSpacing: "0.04em" }}>BOLETO</span>,
    art: (
      <g transform="translate(4,-3.2) scale(1.2)" fill="#111111">
        <rect x="5" y="5" width="1.6" height="11" />
        <rect x="8" y="5" width="2.6" height="11" />
        <rect x="12.2" y="5" width="1.2" height="11" />
        <rect x="15" y="5" width="2.2" height="11" />
        <rect x="18.8" y="5" width="1.4" height="11" />
        <rect x="21.8" y="5" width="2.8" height="11" />
        <rect x="26.2" y="5" width="1.2" height="11" />
        <rect x="29" y="5" width="2.4" height="11" />
        <rect x="33" y="5" width="1.4" height="11" />
        <rect x="36" y="5" width="2.6" height="11" />
        <rect x="40.2" y="5" width="1.4" height="11" />
      </g>
    ),
  },
  {
    key: "pix",
    label: "PIX",
    // Teal escurecido: o branco do losango precisa de 3:1 contra o fundo.
    bg: "#0E8C7F",
    fg: "#ffffff",
    art: (
      <g transform="translate(0.8,-1.5) scale(1.3)">
        <path
          d="M24 6.5 32.5 15 24 23.5 15.5 15 24 6.5Zm0 4.6-4.4 4.4 4.4 4.4 4.4-4.4L24 11.1Z"
          fill="#ffffff"
        />
        <path d="M15.5 15 24 6.5V11L19.6 15l4.4 4.4V23.5L15.5 15Z" fill="#ffffff" fillOpacity="0.6" />
        <path d="M32.5 15 24 23.5V19l4.4-4.4L24 10.2V6.5l8.5 8.5Z" fill="#ffffff" fillOpacity="0.6" />
      </g>
    ),
  },
];

export function PaymentMarks() {
  return (
    <div className="footer__payments" aria-label="Formas de pagamento aceitas">
      {marks.map((m) => (
        <span
          key={m.key}
          className={`footer__pay${m.stack ? " footer__pay--stack" : ""}`}
          style={{ background: m.bg }}
          role="img"
          aria-label={m.label}
          title={m.label}
        >
          {m.art ? (
            <svg viewBox="0 0 64 36" className="footer__pay__art" aria-hidden="true" focusable="false">
              {m.art}
            </svg>
          ) : null}
          {m.word ? (
            <span className="footer__pay__word" style={{ color: m.fg }}>
              {m.word}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
