"use client";

import { ReactNode, forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, useState } from "react";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Field = ({ label, hint, error, required, children, className, style }: FieldProps) => (
  <div className={`field ${className ?? ""}`} style={style}>
    <label className="field__label">
      {label}
      {required && <span className="field__required" aria-hidden="true">*</span>}
    </label>
    <div className="field__control">{children}</div>
    {error && <p className="field__error" role="alert">{error}</p>}
    {hint && !error && <p className="field__hint">{hint}</p>}
  </div>
);

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  mask?: "currency" | "cpf" | "cep" | "phone" | "numeric";
  placeholder?: string;
  error?: string;
  hint?: string;
  onChange?: (value: string) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ mask, placeholder = "", className = "", error, hint, onChange, ...props }, ref) => {
    const [value, setValue] = useState<string>((props.defaultValue as string) ?? "");
    const [focused, setFocused] = useState(false);

    function applyMask(raw: string): string {
      const digits = raw.replace(/\D/g, "");
      switch (mask) {
        case "currency": {
          const cents = digits.padStart(3, "0");
          const intPart = cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
          return `${intPart},${cents.slice(-2)}`;
        }
        case "cpf": {
          if (digits.length <= 11) {
            return digits
              .replace(/(\d{3})(\d)/, "$1.$2")
              .replace(/(\d{3})(\d)/, "$1.$2")
              .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
          }
          return digits.slice(0, 11);
        }
        case "cep": {
          if (digits.length <= 8) return digits.replace(/(\d{5})(\d)/, "$1-$2");
          return digits.slice(0, 8);
        }
        case "phone": {
          if (digits.length <= 11) {
            return digits
              .replace(/(\d{2})(\d)/, "($1) $2")
              .replace(/(\d{4,5})(\d{4})$/, "$1-$2");
          }
          return digits.slice(0, 11);
        }
        case "numeric":
          return digits;
        default:
          return raw;
      }
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      const masked = mask ? applyMask(raw) : raw;
      setValue(masked);
      onChange?.(masked);
    }

    function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
      setFocused(false);
      props.onBlur?.(e);
    }

    function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
      setFocused(true);
      props.onFocus?.(e);
    }

    const displayValue = focused && mask === "currency" ? value.replace(/[.,]/g, "") : value;

    return (
      <input
        ref={ref}
        type={props.type ?? "text"}
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholder={placeholder}
        className={`input ${focused ? "input--focused" : ""} ${error ? "input--error" : ""} ${className}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${props.id}-error` : hint ? `${props.id}-hint` : undefined}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  hint?: string;
  onChange?: (value: string) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, className = "", error, hint, onChange, ...props }, ref) => (
    <div className={`select-wrapper ${error ? "select-wrapper--error" : ""}`}>
      <select
        ref={ref}
        className={`select ${className}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${props.id}-error` : hint ? `${props.id}-hint` : undefined}
        onChange={(e) => onChange?.(e.target.value)}
        {...props}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
);
Select.displayName = "Select";

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  placeholder?: string;
  rows?: number;
  error?: string;
  hint?: string;
  onChange?: (value: string) => void;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ placeholder, rows = 4, className = "", error, hint, onChange, ...props }, ref) => (
    <textarea
      ref={ref}
      placeholder={placeholder}
      rows={rows}
      className={`textarea ${error ? "textarea--error" : ""} ${className}`}
      aria-invalid={!!error}
      aria-describedby={error ? `${props.id}-error` : hint ? `${props.id}-hint` : undefined}
      onChange={(e) => onChange?.(e.target.value)}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, className = "", ...props }, ref) => (
    <div className={`checkbox-wrapper ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        className="checkbox"
        {...props}
      />
      <div className="checkbox__label">
        <span className="checkbox__text">{label}</span>
        {description && <span className="checkbox__desc">{description}</span>}
      </div>
    </div>
  )
);
Checkbox.displayName = "Checkbox";