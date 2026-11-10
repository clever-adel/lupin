import { useId, type ReactNode } from "react";
import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { useT, type MessageKey } from "~/lib/i18n";

interface FieldProps {
  label: string;
  type?: string;
  autoComplete: string;
  inputMode?: "tel" | "email";
  hint?: string;
  /** Validation messages are i18n keys (see the zod schemas). */
  error?: FieldError;
  serverError?: string;
  registration: UseFormRegisterReturn;
}

export function Field({ label, type = "text", autoComplete, inputMode, hint, error, serverError, registration }: FieldProps) {
  const { t } = useT();
  const id = useId();
  const message = serverError ?? (error?.message ? t(error.message as MessageKey) : undefined);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        dir={type === "email" || type === "password" || inputMode === "tel" ? "ltr" : undefined}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="field"
        {...registration}
      />
      {message ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">{message}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone">{hint}</p>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  autoComplete?: string;
  error?: FieldError;
  registration: UseFormRegisterReturn;
  children: ReactNode;
}

export function SelectField({ label, autoComplete, error, registration, children }: SelectFieldProps) {
  const { t } = useT();
  const id = useId();
  const message = error?.message ? t(error.message as MessageKey) : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <select
        id={id}
        autoComplete={autoComplete}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        className="field"
        {...registration}
      >
        {children}
      </select>
      {message && <p id={`${id}-error`} className="mt-1 text-xs text-danger">{message}</p>}
    </div>
  );
}
