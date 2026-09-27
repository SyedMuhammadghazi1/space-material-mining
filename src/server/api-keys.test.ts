import { describe, expect, it } from "vitest";
import { RIG_KEY_PREFIX, generateRigKey, hashRigKey, parseBearer } from "./api-keys";

describe("rig API keys", () => {
  it("generates unique, prefixed keys with a SHA-256 hash", () => {
    const a = generateRigKey();
    const b = generateRigKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.plaintext.startsWith(RIG_KEY_PREFIX)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashRigKey(a.plaintext));
    expect(a.prefix).toBe(a.plaintext.slice(0, 12));
    expect(a.plaintext.length).toBeGreaterThan(40);
  });

  it("never stores the plaintext in the hash", () => {
    const k = generateRigKey();
    expect(k.hash.includes(k.plaintext)).toBe(false);
  });

  it("parses bearer headers strictly", () => {
    const k = generateRigKey().plaintext;
    expect(parseBearer(`Bearer ${k}`)).toBe(k);
    expect(parseBearer(`bearer ${k}`)).toBe(k);
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer short")).toBeNull();
    expect(parseBearer(`Bearer ${k} extra`)).toBeNull();
  });
});
