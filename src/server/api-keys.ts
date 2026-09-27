import { createHash, randomBytes } from "node:crypto";

export const RIG_KEY_PREFIX = "oqr_";

/** Generates a random rig API key. The plaintext is shown once; only its SHA-256 is stored. */
export function generateRigKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `${RIG_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, prefix: plaintext.slice(0, 12), hash: hashRigKey(plaintext) };
}

export function hashRigKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Extracts a bearer token; returns null for anything malformed. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]!;
  return token.length >= 20 && token.length <= 200 ? token : null;
}
