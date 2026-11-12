// language: TSX, file: apps/admin/src/app/components/ui/Field.tsx, target: Next.js App Router
// Field wrapper: label, input/select/textarea, hint, error - layout padrão 12-col.
"use client";

import { ReactNode } from "react";

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  required?: boolean;
}

export function Field({ label, hint, error, children, className, htmlFor, required }: FieldProps) {
  const labelId = htmlFor ? `${htmlFor}-label` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={`field ${className}`}>
      {label && (
        <label id={labelId} htmlFor={htmlFor} className="field__label">
          {label}
          {required && <span className="field__required" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="field__control">
        {children}
      </div>
      {error && (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}