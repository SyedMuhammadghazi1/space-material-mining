"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { Button, type ButtonVariant, Notice, cx } from "./ui";

export interface FormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue-600 aria-[invalid=true]:border-red-600";

interface FieldProps {
  label: string;
  name: string;
  /** Override when the same field name appears more than once on a page. */
  id?: string;
  hint?: ReactNode;
  errors?: string[];
  className?: string;
}

function FieldShell({
  label,
  id,
  hint,
  errors,
  className,
  children,
}: Omit<FieldProps, "name"> & { id: string; children: ReactNode }) {
  return (
    <div className={cx("space-y-1", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint && !errors?.length && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-700">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, errors?: string[]) {
  if (errors?.length) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

export function TextField({
  label,
  name,
  id,
  hint,
  errors,
  className,
  ...props
}: FieldProps & Omit<ComponentProps<"input">, "name" | "id">) {
  const fid = id ?? `f-${name}`;
  return (
    <FieldShell label={label} id={fid} hint={hint} errors={errors} className={className}>
      <input
        id={fid}
        name={name}
        className={inputClass}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy(fid, hint, errors)}
        {...props}
      />
    </FieldShell>
  );
}

export function TextArea({
  label,
  name,
  id,
  hint,
  errors,
  className,
  ...props
}: FieldProps & Omit<ComponentProps<"textarea">, "name" | "id">) {
  const fid = id ?? `f-${name}`;
  return (
    <FieldShell label={label} id={fid} hint={hint} errors={errors} className={className}>
      <textarea
        id={fid}
        name={name}
        rows={3}
        className={inputClass}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy(fid, hint, errors)}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  id,
  hint,
  errors,
  className,
  options,
  placeholder,
  ...props
}: FieldProps &
  Omit<ComponentProps<"select">, "name" | "id"> & {
    options: { value: string; label: string }[];
    placeholder?: string;
  }) {
  const fid = id ?? `f-${name}`;
  return (
    <FieldShell label={label} id={fid} hint={hint} errors={errors} className={className}>
      <select
        id={fid}
        name={name}
        className={inputClass}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy(fid, hint, errors)}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  variant,
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      aria-disabled={pending}
      className={className}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}

export function FormMessage({
  state,
  showFieldErrors = false,
}: {
  state: FormState;
  showFieldErrors?: boolean;
}) {
  if (state.status === "idle" || !state.message) return null;
  const fields = showFieldErrors ? Object.entries(state.fieldErrors ?? {}) : [];
  return (
    <div aria-live="polite">
      <Notice tone={state.status === "error" ? "bad" : "good"}>
        {state.message}
        {fields.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {fields.map(([field, msgs]) => (
              <li key={field}>
                <span className="font-medium">{field}</span>: {msgs.join(" ")}
              </li>
            ))}
          </ul>
        )}
      </Notice>
    </div>
  );
}

/**
 * Generic form bound to a server action returning an ActionState. Server components can render
 * it with plain field components as children; errors (including per-field ones) show on top.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  return (
    <form action={formAction} className={className}>
      <FormMessage state={state} showFieldErrors />
      {children}
    </form>
  );
}
