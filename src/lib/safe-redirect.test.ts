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
});
