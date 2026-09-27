import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const variants = {
  primary: "bg-blue-700 text-white hover:bg-blue-800",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-slate-700 hover:bg-slate-100",
} as const;
export type ButtonVariant = keyof typeof variants;

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx("min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm", className)}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
  good: "bg-green-50 text-green-800 ring-green-200",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  bad: "bg-red-50 text-red-800 ring-red-200",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  requested: "info",
  issued: "warn",
  accepted: "good",
  declined: "neutral",
  expired: "neutral",
  awaiting_deposit: "warn",
  confirmed: "info",
  reserved: "info",
  fulfilled: "good",
  cancelled: "neutral",
  queued: "neutral",
  in_progress: "info",
  completed: "good",
  failed: "bad",
  open: "bad",
  resolved: "good",
  active: "good",
  retired: "neutral",
  planned: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{label}</Badge>;
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "bad" | "good";
  title?: ReactNode;
  children: ReactNode;
}) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-950",
    warn: "border-amber-300 bg-amber-50 text-amber-950",
    bad: "border-red-200 bg-red-50 text-red-950",
    good: "border-green-200 bg-green-50 text-green-950",
  }[tone];
  return (
    <div
      role={tone === "bad" ? "alert" : "note"}
      className={cx("rounded-md border px-4 py-3 text-sm", styles)}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}

export function PlanningDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <Notice tone="warn" title={compact ? undefined : "First-order planning model"}>
      {compact
        ? "First-order planning estimate — not flight-grade analysis. "
        : "Physics and economics here are first-order planning models, not flight-grade analysis. Composition values are nominal planning values that must be replaced by survey data. "}
      <Link href="/about" className="font-medium underline underline-offset-2">
        Model assumptions
      </Link>
    </Notice>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600">
      {children}
    </p>
  );
}

/** Horizontally scrollable table wrapper so wide tables never break a 360px layout. */
export function TableWrap({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      className="relative -mx-4 overflow-x-auto sm:mx-0"
      role={label ? "region" : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
    >
      <table className="tabular w-full min-w-[40rem] border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  );
}

export const th =
  "border-b border-slate-200 px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase first:pl-4 sm:first:pl-3";
export const td =
  "border-b border-slate-100 px-3 py-2 align-top text-slate-800 first:pl-4 sm:first:pl-3";

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-600">{k}</dt>
          <dd className="font-medium text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
