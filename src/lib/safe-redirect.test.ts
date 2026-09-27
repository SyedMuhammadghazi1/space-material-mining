import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps relative paths", () => {
    expect(safeNextPath("/portal/quotes/1")).toBe("/portal/quotes/1");
  });
  it("rejects absolute, protocol-relative and malformed targets", () => {
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("/ok\nSet-Cookie: x")).toBe("/dashboard");
    expect(safeNextPath(undefined, "/")).toBe("/");
  });
  it("rejects paths that browsers normalise into another origin", () => {
    // URL parsers strip tab/CR/LF anywhere, so "/\t/evil" becomes "//evil" (protocol-relative).
    for (const next of ["/\t/evil.example", "/\t\\evil.example", "/\r/evil.example", "/\0/x"]) {
      expect(safeNextPath(next)).toBe("/dashboard");
      expect(new URL(safeNextPath(next), "https://app.example").origin).toBe("https://app.example");
    }
  });
});
