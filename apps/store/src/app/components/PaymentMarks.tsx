// language: TSX, file: apps/store/src/app/components/PaymentMarks.tsx, target: Next.js App Router
// Marcas de pagamento desenhadas em SVG próprio (sem assets de terceiros):
// cada chip é um retângulo com o símbolo da bandeira, legível a 44×28px.

type Mark = { key: string; label: string; svg: React.ReactNode };

const CHIP = { width: 48, height: 30 } as const;

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${CHIP.width} ${CHIP.height}`} role="presentation" focusable="false">
      {children}
    </svg>
  );
}

const marks: Mark[] = [
  {
    key: "visa",
    label: "Visa",
    svg: (
      <Chip>
        <rect width="48" height="30" fill="#ffffff" />
        <text
          x="24"
          y="20"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="800"
          fontStyle="italic"
          fontSize="13"
          letterSpacing="0.5"
          fill="#1A1F71"
        >
          VISA
        </text>
      </Chip>
    ),
  },
  {
    key: "mastercard",
    label: "Mastercard",
    svg: (
      <Chip>
        <rect width="48" height="30" fill="#ffffff" />
        <circle cx="19" cy="15" r="8.5" fill="#EB001B" />
        <circle cx="29" cy="15" r="8.5" fill="#F79E1B" fillOpacity="0.92" />
        <path
          d="M24 8.4a8.5 8.5 0 0 1 0 13.2 8.5 8.5 0 0 1 0-13.2Z"
          fill="#FF5F00"
        />
      </Chip>
    ),
  },
  {
    key: "elo",
    label: "Elo",
    svg: (
      <Chip>
        <rect width="48" height="30" fill="#111111" />
        <circle cx="17" cy="10" r="2.4" fill="#00A4E4" />
        <circle cx="24" cy="10" r="2.4" fill="#FFCB05" />
        <circle cx="31" cy="10" r="2.4" fill="#EF4123" />
        <text
          x="24"
          y="25"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="700"
          fontSize="11"
          letterSpacing="0.5"
          fill="#ffffff"
        >
          elo
        </text>
      </Chip>
    ),
  },
  {
    key: "hipercard",
    label: "Hipercard",
    svg: (
      <Chip>
        <rect width="48" height="30" fill="#F37021" />
        <text
          x="24"
          y="19"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="700"
          fontSize="7"
          letterSpacing="0.2"
          fill="#ffffff"
        >
          HIPERCARD
        </text>
      </Chip>
    ),
  },
  {
    key: "amex",
    label: "American Express",
    svg: (
      <Chip>
        <rect width="48" height="30" fill="#2E77BC" />
        <text
          x="24"
          y="19.5"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="800"
          fontSize="10"
          letterSpacing="0.6"
          fill="#ffffff"
        >
          AMEX
        </text>
      </Chip>
    ),
  },
  {
    key: "boleto",
    label: "Boleto bancário",
    svg: (
      <Chip>
        <rect width="48" height="30" fill="#ffffff" />
        <g fill="#111111">
          <rect x="5" y="5" width="1.6" height="13" />
          <rect x="8" y="5" width="2.6" height="13" />
          <rect x="12.2" y="5" width="1.2" height="13" />
          <rect x="15" y="5" width="2.2" height="13" />
          <rect x="18.8" y="5" width="1.4" height="13" />
          <rect x="21.8" y="5" width="2.8" height="13" />
          <rect x="26.2" y="5" width="1.2" height="13" />
          <rect x="29" y="5" width="2.4" height="13" />
          <rect x="33" y="5" width="1.4" height="13" />
          <rect x="36" y="5" width="2.6" height="13" />
          <rect x="40.2" y="5" width="1.4" height="13" />
        </g>
        <text
          x="24"
          y="26"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="700"
          fontSize="6.5"
          letterSpacing="0.8"
          fill="#111111"
        >
          BOLETO
        </text>
      </Chip>
    ),
  },
  {
    key: "pix",
    label: "PIX",
    svg: (
      <Chip>
        <rect width="48" height="30" fill="#32BCAD" />
        <path
          d="M24 6.5 32.5 15 24 23.5 15.5 15 24 6.5Zm0 4.6-4.4 4.4 4.4 4.4 4.4-4.4L24 11.1Z"
          fill="#ffffff"
        />
        <path d="M15.5 15 24 6.5V11L19.6 15l4.4 4.4V23.5L15.5 15Z" fill="#ffffff" fillOpacity="0.55" />
        <path d="M32.5 15 24 23.5V19l4.4-4.4L24 10.2V6.5l8.5 8.5Z" fill="#ffffff" fillOpacity="0.55" />
      </Chip>
    ),
  },
];

export function PaymentMarks() {
  return (
    <div className="footer__payments" aria-label="Formas de pagamento aceitas">
      {marks.map((m) => (
        <span key={m.key} className="footer__pay" role="img" aria-label={m.label} title={m.label}>
          {m.svg}
        </span>
      ))}
    </div>
  );
}
