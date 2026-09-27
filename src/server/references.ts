import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Human-friendly reference such as Q-260927-7KXM3P (date + 6 random chars, ~1e9 combinations/day). */
export function makeReference(prefix: "Q" | "O", now = new Date()): string {
  const bytes = randomBytes(6);
  const suffix = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  const date = now.toISOString().slice(2, 10).replace(/-/g, "");
  return `${prefix}-${date}-${suffix}`;
}
