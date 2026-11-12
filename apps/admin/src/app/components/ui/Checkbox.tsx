// language: TSX, file: apps/admin/src/app/components/ui/Checkbox.tsx, target: Next.js App Router
// Checkbox unificado: label ao lado, erro abaixo.
"use client";

import { forwardRef, type InputHTMLAttributes, type Ref } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  label: string;
  hint?: string;
  error?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, hint, error, className = "", id, onChange, onBlur, ...props }, ref) => {
    const checkboxId = id || label.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className={`field field--checkbox ${className}`}>
        <label htmlFor={checkboxId} className="field__checkbox-label">
          <input
            ref={ref}
            id={checkboxId}
            type="checkbox"
            className={`checkbox ${error ? "checkbox--error" : ""}`}
            onChange={onChange}
            onBlur={onBlur}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? `${checkboxId}-error` : hint ? `${checkboxId}-hint` : undefined}
            {...props}
          />
          <span className="field__checkbox-text">{label}</span>
        </label>
        {error && (
          <p id={`${checkboxId}-error`} className="field__error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${checkboxId}-hint`} className="field__hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";