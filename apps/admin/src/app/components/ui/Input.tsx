// language: TSX, file: apps/admin/src/app/components/ui/Input.tsx, target: Next.js App Router
// Input unificado: label acima, ajuda abaixo, erro em vermelho abaixo do campo.
// Placeholder cinza claro (0,00 para money). Máscara opcional via onChange.
"use client";

import { forwardRef, type InputHTMLAttributes, type Ref } from "react";

type MaskFn = (value: string) => string;

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  hint?: string;
  error?: string;
  mask?: MaskFn;
  /** Se true, o placeholder mostra "0,00" em vez de vazio */
  moneyPlaceholder?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      hint,
      error,
      mask,
      moneyPlaceholder,
      className = "",
      id,
      onChange,
      onBlur,
      placeholder,
      ...props
    },
    ref
  ) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

    const handleChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
      let value = e.target.value;
      if (mask) value = mask(value);
      if (onChange) onChange({ ...e, target: { ...e.target, value } } as React.ChangeEvent<HTMLInputElement>);
    };

    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (e) => {
      if (mask) {
        const masked = mask(e.target.value);
        e.target.value = masked;
      }
      if (onBlur) onBlur(e);
    };

    const effectivePlaceholder = moneyPlaceholder ? "0,00" : placeholder;

    return (
      <div className={`field ${className}`}>
        {label && <label htmlFor={inputId} className="field__label">{label}</label>}
        <input
          ref={ref}
          id={inputId}
          className={`input ${error ? "input--error" : ""}`}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={effectivePlaceholder}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="field__error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="field__hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";