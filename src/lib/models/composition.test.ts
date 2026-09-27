import { describe, expect, it } from "vitest";
import {
  COMPOSITION_MODELS,
  ELEMENTS,
  SOURCE_TYPES,
  TI_MASS_FRACTION_IN_ILMENITE,
  getComposition,
  spectralClassToSourceType,
  titaniumFromIlmeniteShare,
} from "./composition";

describe("composition models", () => {
  it("defines every source type and element", () => {
    for (const st of SOURCE_TYPES) {
      const m = getComposition(st);
      for (const el of ELEMENTS) expect(m.elements[el]).toBeDefined();
    }
  });

  it("keeps nominal values inside their low/high planning range", () => {
    for (const st of SOURCE_TYPES) {
      const m = COMPOSITION_MODELS[st];
      for (const el of ELEMENTS) {
        const { nominal, low, high } = m.elements[el];
        expect(low).toBeLessThanOrEqual(nominal);
        expect(nominal).toBeLessThanOrEqual(high);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(100);
      }
      expect(m.ilmeniteWtPct.low).toBeLessThanOrEqual(m.ilmeniteWtPct.nominal);
      expect(m.ilmeniteWtPct.nominal).toBeLessThanOrEqual(m.ilmeniteWtPct.high);
    }
  });

  it("never sums nominal abundances above 100 wt%", () => {
    for (const st of SOURCE_TYPES) {
      const sum = ELEMENTS.reduce((s, el) => s + COMPOSITION_MODELS[st].elements[el].nominal, 0);
      expect(sum).toBeLessThanOrEqual(100);
      expect(sum).toBeGreaterThan(80);
    }
  });

  it("ranks titanium: high-Ti mare > low-Ti mare > highland", () => {
    const ti = (st: (typeof SOURCE_TYPES)[number]) => COMPOSITION_MODELS[st].elements.Ti.nominal;
    expect(ti("lunar_mare_high_ti")).toBeGreaterThan(ti("lunar_mare_low_ti"));
    expect(ti("lunar_mare_low_ti")).toBeGreaterThan(ti("lunar_highland"));
  });

  it("puts most high-Ti mare titanium in ilmenite", () => {
    expect(titaniumFromIlmeniteShare("lunar_mare_high_ti")).toBeGreaterThan(0.9);
    expect(titaniumFromIlmeniteShare("lunar_mare_low_ti")).toBeLessThan(
      titaniumFromIlmeniteShare("lunar_mare_high_ti"),
    );
    const m = COMPOSITION_MODELS.lunar_mare_high_ti;
    expect(m.ilmeniteWtPct.nominal * TI_MASS_FRACTION_IN_ILMENITE).toBeLessThanOrEqual(
      m.elements.Ti.nominal,
    );
  });

  it("only C-types carry meaningful water", () => {
    expect(COMPOSITION_MODELS.nea_c.elements.H2O.nominal).toBeGreaterThan(0);
    for (const st of SOURCE_TYPES.filter((s) => s !== "nea_c")) {
      expect(COMPOSITION_MODELS[st].elements.H2O.nominal).toBe(0);
    }
  });

  it("M-types are iron-dominated; highlands are the best Al source", () => {
    const fe = SOURCE_TYPES.map((s) => COMPOSITION_MODELS[s].elements.Fe.nominal);
    expect(COMPOSITION_MODELS.nea_m.elements.Fe.nominal).toBe(Math.max(...fe));
    const al = SOURCE_TYPES.map((s) => COMPOSITION_MODELS[s].elements.Al.nominal);
    expect(COMPOSITION_MODELS.lunar_highland.elements.Al.nominal).toBe(Math.max(...al));
  });
});

describe("spectral class mapping", () => {
  it.each([
    ["Cg", "nea_c", "high"],
    ["B", "nea_c", "high"],
    ["Sq", "nea_s", "high"],
    ["S", "nea_s", "high"],
    ["M", "nea_m", "medium"],
    ["Xk", "nea_m", "low"],
    ["Xe", "nea_s", "low"],
    ["E", "nea_s", "low"],
  ])("%s → %s (%s confidence)", (cls, st, conf) => {
    const m = spectralClassToSourceType(cls);
    expect(m.sourceType).toBe(st);
    expect(m.confidence).toBe(conf);
  });

  it("returns no model for missing or unknown classes", () => {
    expect(spectralClassToSourceType(null).sourceType).toBeNull();
    expect(spectralClassToSourceType("  ").confidence).toBe("none");
    expect(spectralClassToSourceType("Z?").sourceType).toBeNull();
  });
});
