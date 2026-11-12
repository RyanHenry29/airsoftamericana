// language: TSX, file: apps/admin/src/app/components/ui/Textarea.tsx, target: Next.js App Router
// Textarea unificado: label acima, ajuda abaixo, erro em vermelho abaixo do campo.
"use client";

import { forwardRef, type TextareaHTMLAttributes, type Ref } from "react";

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  label?: string;
  hint?: string;
  error?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { label, hint, error, className = "", id, onChange, onBlur, placeholder, ...props },
    ref
  ) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className={`field ${className}`}>
        {label && <label htmlFor={textareaId} className="field__label">{label}</label>}
        <textarea
          ref={ref}
          id={textareaId}
          className={`textarea ${error ? "textarea--error" : ""}`}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined}
          {...props}
        />
        {error && (
          <p id={`${textareaId}-error`} className="field__error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${textareaId}-hint`} className="field__hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";