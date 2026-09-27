/** Display formatting. Money arrives as integer cents; masses as kg. */
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(
  cents: number | null | undefined,
  opts: { exact?: boolean; compact?: boolean } = {},
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  if (opts.compact && Math.abs(dollars) >= 100_000) return compactUsd.format(dollars);
  return opts.exact || Math.abs(dollars) < 100 ? usdCents.format(dollars) : usd.format(dollars);
}

export function formatNumber(n: number | null | undefined, maxFractionDigits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(n);
}

/** kg with a sensible unit: g below 1 kg, t above 10,000 kg. */
export function formatMass(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return "—";
  const abs = Math.abs(kg);
  if (abs >= 10_000) return `${formatNumber(kg / 1000, 1)} t`;
  if (abs > 0 && abs < 1) return `${formatNumber(kg * 1000, 0)} g`;
  return `${formatNumber(kg, 1)} kg`;
}

export function formatQuantity(q: number, unit: "kg" | "unit"): string {
  return unit === "kg" ? formatMass(q) : `${formatNumber(q, 0)} unit${q === 1 ? "" : "s"}`;
}

export function formatDeltaV(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return `${formatNumber(ms / 1000, 2)} km/s`;
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatRelative(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${formatNumber(fraction * 100, digits)}%`;
}

export const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
