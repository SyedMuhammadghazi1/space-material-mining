/**
 * Composition model — NOMINAL PLANNING VALUES, NOT SURVEY DATA.
 *
 * Bulk elemental abundances (wt%) with a low/high planning range per source type. Values are
 * rounded from widely published averages:
 *  - lunar soils: Apollo/Luna returned-sample averages as summarised in the Lunar Sourcebook
 *    (Heiken, Vaniman & French, 1991) — oxide wt% converted to element wt%;
 *  - NEA types: meteorite analogues — ordinary chondrites (S), CI/CM carbonaceous chondrites (C)
 *    and iron meteorites / metal-rich mixtures (M).
 * Every mission scenario MUST be re-run with site-specific survey data (orbital spectroscopy,
 * ground truth, returned samples) before any commitment. Ranges are planning envelopes, not
 * statistical confidence intervals.
 *
 * Titanium in lunar mare regolith is hosted mainly in ilmenite (FeTiO₃, 31.6 wt% Ti). The
 * `ilmeniteWtPct` field drives the hydrogen-reduction process model.
 */

export const ELEMENTS = ["Si", "Ti", "Fe", "Al", "Mg", "O", "H2O"] as const;
export type Element = (typeof ELEMENTS)[number];

export const SOURCE_TYPES = [
  "lunar_mare_high_ti",
  "lunar_mare_low_ti",
  "lunar_highland",
  "nea_s",
  "nea_c",
  "nea_m",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface Range {
  nominal: number;
  low: number;
  high: number;
}

export interface CompositionModel {
  sourceType: SourceType;
  label: string;
  analogue: string;
  /** Element abundances, wt% of dry bulk material (H2O is wt% of bulk). */
  elements: Record<Element, Range>;
  /** Ilmenite (FeTiO₃) content, wt%. */
  ilmeniteWtPct: Range;
  /** Fraction of total Fe present as free Fe–Ni metal (drives magnetic separation). */
  metallicFeFraction: number;
  notes: string[];
}

const r = (nominal: number, low: number, high: number): Range => ({ nominal, low, high });

/** Mass fraction of Ti in ilmenite FeTiO₃ (47.867 / 151.71). */
export const TI_MASS_FRACTION_IN_ILMENITE = 47.867 / 151.71;
/** Mass fraction of Fe in ilmenite (55.845 / 151.71). */
export const FE_MASS_FRACTION_IN_ILMENITE = 55.845 / 151.71;
/** Mass fraction of the single reducible O in ilmenite (FeTiO₃ + H₂ → Fe + TiO₂ + H₂O). */
export const REDUCIBLE_O_MASS_FRACTION_IN_ILMENITE = 15.999 / 151.71;

export const COMPOSITION_MODELS: Record<SourceType, CompositionModel> = {
  lunar_mare_high_ti: {
    sourceType: "lunar_mare_high_ti",
    label: "Lunar mare regolith — high-Ti",
    analogue: "Apollo 11 / Apollo 17 mare soils (TiO₂ ≈ 6–11 wt%)",
    elements: {
      Si: r(19.2, 18.5, 20.0),
      Ti: r(4.8, 3.5, 6.5),
      Fe: r(12.4, 11.0, 13.5),
      Al: r(6.6, 5.5, 7.5),
      Mg: r(5.9, 5.0, 6.5),
      O: r(41.6, 40.5, 42.5),
      H2O: r(0, 0, 0),
    },
    ilmeniteWtPct: r(15, 8, 20),
    metallicFeFraction: 0.04,
    notes: [
      "Titanium is carried mainly by ilmenite; high-Ti mare is the best lunar Ti and ilmenite-reduction feedstock.",
      "Ca (~8 wt%) and minor elements are not tracked.",
    ],
  },
  lunar_mare_low_ti: {
    sourceType: "lunar_mare_low_ti",
    label: "Lunar mare regolith — low-Ti",
    analogue: "Apollo 12 / Apollo 15 mare soils (TiO₂ ≈ 1–5 wt%)",
    elements: {
      Si: r(21.5, 20.5, 22.5),
      Ti: r(1.5, 0.6, 3.0),
      Fe: r(12.4, 11.0, 14.5),
      Al: r(6.9, 5.5, 7.5),
      Mg: r(6.0, 5.0, 7.5),
      O: r(42.2, 41.0, 43.0),
      H2O: r(0, 0, 0),
    },
    ilmeniteWtPct: r(3, 1, 5),
    metallicFeFraction: 0.04,
    notes: ["Only part of the Ti is in ilmenite; the rest is in pyroxene, glass and ulvöspinel."],
  },
  lunar_highland: {
    sourceType: "lunar_highland",
    label: "Lunar highland regolith (feldspathic)",
    analogue: "Apollo 16 soils; also used for south-polar crater rims",
    elements: {
      Si: r(21.0, 20.5, 21.5),
      Ti: r(0.33, 0.1, 0.5),
      Fe: r(4.3, 3.0, 5.5),
      Al: r(14.3, 13.0, 15.5),
      Mg: r(3.6, 2.5, 5.0),
      O: r(44.8, 44.0, 45.5),
      H2O: r(0, 0, 0),
    },
    ilmeniteWtPct: r(0.3, 0.1, 0.6),
    metallicFeFraction: 0.05,
    notes: [
      "Best lunar Al source (anorthite), poor Ti source.",
      "Water ice in permanently shadowed regions near the poles is NOT included — it needs its own survey-driven model.",
    ],
  },
  nea_s: {
    sourceType: "nea_s",
    label: "NEA S-type (stony)",
    analogue: "Ordinary chondrites (H/L/LL average)",
    elements: {
      Si: r(18.5, 17.0, 19.5),
      Ti: r(0.07, 0.06, 0.08),
      Fe: r(22.0, 19.0, 27.5),
      Al: r(1.2, 1.1, 1.3),
      Mg: r(14.5, 14.0, 15.5),
      O: r(37.0, 35.0, 40.0),
      H2O: r(0, 0, 0.5),
    },
    ilmeniteWtPct: r(0, 0, 0.1),
    metallicFeFraction: 0.35,
    notes: ["Free Fe–Ni metal (≈5–18 wt% of bulk) varies strongly between H, L and LL analogues."],
  },
  nea_c: {
    sourceType: "nea_c",
    label: "NEA C-type (carbonaceous)",
    analogue: "CI / CM carbonaceous chondrites; Ryugu and Bennu returned samples",
    elements: {
      Si: r(12.5, 10.5, 13.5),
      Ti: r(0.05, 0.04, 0.06),
      Fe: r(19.5, 18.0, 22.0),
      Al: r(1.0, 0.85, 1.15),
      Mg: r(10.5, 9.5, 11.7),
      O: r(36.0, 32.0, 40.0),
      H2O: r(10, 3, 20),
    },
    ilmeniteWtPct: r(0, 0, 0.1),
    metallicFeFraction: 0.02,
    notes: [
      "Water is bound in phyllosilicates (not ice); ~3–20 wt% is released on heating to 300–700 °C.",
      "The O value excludes oxygen bound in H₂O, so O and H₂O are not double-counted.",
      "Carbon (~2–4 wt%) and organics are not tracked.",
    ],
  },
  nea_m: {
    sourceType: "nea_m",
    label: "NEA M-type (metal-rich)",
    analogue: "Iron meteorites; many M/X-class objects are metal–silicate mixtures",
    elements: {
      Si: r(1.0, 0, 10.0),
      Ti: r(0, 0, 0.05),
      Fe: r(85.0, 40.0, 92.0),
      Al: r(0.1, 0, 1.0),
      Mg: r(0.8, 0, 8.0),
      O: r(1.5, 0, 20.0),
      H2O: r(0, 0, 0),
    },
    ilmeniteWtPct: r(0, 0, 0),
    metallicFeFraction: 0.95,
    notes: [
      "Ni (5–20 wt%), Co and platinum-group metals are present but not modelled.",
      "Spectral M/X classes are ambiguous; radar or albedo data are needed to confirm metal content.",
    ],
  },
};

export function getComposition(sourceType: SourceType): CompositionModel {
  const model = COMPOSITION_MODELS[sourceType];
  if (!model) throw new Error(`Unknown source type: ${sourceType}`);
  return model;
}

export function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

/** Share of the bulk Ti that sits in ilmenite (0–1) at nominal values. */
export function titaniumFromIlmeniteShare(sourceType: SourceType): number {
  const model = getComposition(sourceType);
  const ti = model.elements.Ti.nominal;
  if (ti <= 0) return 0;
  return Math.min(1, (model.ilmeniteWtPct.nominal * TI_MASS_FRACTION_IN_ILMENITE) / ti);
}

export type SpectralMapping = {
  sourceType: SourceType | null;
  confidence: "high" | "medium" | "low" | "none";
  note: string;
};

/**
 * Map a Tholen/SMASS spectral class string to a composition model. X-complex and E classes are
 * genuinely ambiguous and are flagged low-confidence.
 */
export function spectralClassToSourceType(
  spectralClass: string | null | undefined,
): SpectralMapping {
  const cls = (spectralClass ?? "").trim();
  if (!cls) {
    return {
      sourceType: null,
      confidence: "none",
      note: "No spectral class published — choose a model manually.",
    };
  }
  const head = cls.toUpperCase();
  if (/^(C|B|G|F|D|P|T)/.test(head)) {
    return {
      sourceType: "nea_c",
      confidence: head.startsWith("C") || head.startsWith("B") ? "high" : "medium",
      note: `Spectral class ${cls} → carbonaceous (C-complex) analogue.`,
    };
  }
  if (/^(S|Q|V|A|L|K|R|O)/.test(head)) {
    return {
      sourceType: "nea_s",
      confidence: head.startsWith("S") || head.startsWith("Q") ? "high" : "medium",
      note: `Spectral class ${cls} → ordinary-chondrite (S-complex) analogue.`,
    };
  }
  if (head.startsWith("M")) {
    return {
      sourceType: "nea_m",
      confidence: "medium",
      note: `Spectral class ${cls} → metal-rich analogue; confirm with radar albedo.`,
    };
  }
  if (head.startsWith("XE") || head.startsWith("E")) {
    return {
      sourceType: "nea_s",
      confidence: "low",
      note: `Spectral class ${cls} (enstatite-like) → silicate S-type proxy; low confidence.`,
    };
  }
  if (head.startsWith("X")) {
    return {
      sourceType: "nea_m",
      confidence: "low",
      note: `Spectral class ${cls} (X-complex) is ambiguous → metal-rich proxy; low confidence.`,
    };
  }
  return {
    sourceType: null,
    confidence: "none",
    note: `Unrecognised spectral class ${cls} — choose a model manually.`,
  };
}
