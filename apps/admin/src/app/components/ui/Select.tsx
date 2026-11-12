// language: TSX, file: apps/admin/src/app/components/ui/Select.tsx, target: Next.js App Router
// Select unificado: label acima, ajuda abaixo, erro em vermelho abaixo do campo.
"use client";

import { forwardRef, type SelectHTMLAttributes, type Ref } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  label?: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLSelectElement>) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      hint,
      error,
      options,
      placeholder,
      className = "",
      id,
      onChange,
      onBlur,
      ...props
    },
    ref
  ) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className={`field ${className}`}>
        {label && <label htmlFor={selectId} className="field__label">{label}</label>}
        <select
          ref={ref}
          id={selectId}
          className={`select ${error ? "select--error" : ""}`}
          onChange={onChange}
          onBlur={onBlur}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={`${selectId}-error`} className="field__error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${selectId}-hint`} className="field__hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";