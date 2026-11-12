// language: TSX, file: apps/admin/src/app/components/ui/MoneyInput.tsx, target: Next.js App Router
// MoneyInput: máscara de moeda BRL (R$ 1.234,56).
// Guarda centavos internamente (number), mostra formatado no input.
// Placeholder "0,00". Validação: não negativo, duas casas decimais.
"use client";

import { useCallback, useRef, useState } from "react";
import { Input } from "./Input";

type MoneyInputProps = {
  label?: string;
  hint?: string;
  error?: string;
  value: number | null; // centavos
  onChange: (cents: number | null) => void;
  onBlur?: () => void;
  required?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
};

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseBRL(value: string): number | null {
  if (!value.trim()) return null;
  // Remove pontos de milhar, troca vírgula por ponto
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function MoneyInput({
  label,
  hint,
  error,
  value,
  onChange,
  onBlur,
  required,
  min,
  max,
  disabled,
  className,
  id,
}: MoneyInputProps) {
  const [displayValue, setDisplayValue] = useState("");
  const isComposing = useRef({ current: false });

  // Sincroniza displayValue com value (centavos) quando value muda externamente
  const formatted = value != null ? formatBRL(value) : "";
  if (displayValue !== formatted && !isComposing.current.current) {
    setDisplayValue(formatted);
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setDisplayValue(raw);

      // Permite digitação intermediária (ex: "1.", "1,", "1,2")
      if (raw === "" || raw === "," || raw === "." || /^\d+[.,]?$/.test(raw) || /^\d+[.,]\d$/.test(raw)) {
        return;
      }

      const cents = parseBRL(raw);
      if (cents != null) {
        if (min != null && cents < min) return;
        if (max != null && cents > max) return;
        onChange(cents);
      }
    },
    [onChange, min, max]
  );

  const handleBlur = useCallback(() => {
    const cents = parseBRL(displayValue);
    if (cents != null) {
      if (min != null && cents < min) {
        onChange(null);
        return;
      }
      if (max != null && cents > max) {
        onChange(null);
        return;
      }
      onChange(cents);
    } else {
      onChange(null);
    }
    onBlur?.();
  }, [displayValue, onChange, onBlur, min, max]);

  const handleCompositionStart = () => {
    isComposing.current.current = true;
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposing.current.current = false;
    handleChange(e as unknown as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <Input
      id={id}
      label={label}
      hint={hint}
      error={error}
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      placeholder="0,00"
      inputMode="decimal"
      required={required}
      disabled={disabled}
      className={className}
      moneyPlaceholder
      autoComplete="off"
    />
  );
}