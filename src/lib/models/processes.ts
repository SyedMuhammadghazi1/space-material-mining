/**
 * Extraction process model — FIRST-ORDER PLANNING MODEL.
 *
 *   yield_kg(element) = mass_processed_kg × wt%(element) / 100 × recovery(element)
 *
 * Recovery is the fraction of the element's bulk content that ends up in a saleable product
 * stream. Most processes use fixed recoveries; hydrogen reduction of ilmenite derives its
 * recoveries from the source's ilmenite content, and magnetic separation from the metallic-Fe
 * share, because those processes only touch one mineral phase.
 *
 * Specific energies and plant specific masses are order-of-magnitude values from the ISRU
 * literature (e.g. NASA MRE and ilmenite-reduction studies) and must be replaced by vendor data.
 */
import {
  type CompositionModel,
  type Element,
  ELEMENTS,
  FE_MASS_FRACTION_IN_ILMENITE,
  REDUCIBLE_O_MASS_FRACTION_IN_ILMENITE,
  TI_MASS_FRACTION_IN_ILMENITE,
  type SourceType,
  getComposition,
} from "./composition";
import { ModelInputError, assertFinitePositive, roundKg } from "./units";

export const PROCESS_IDS = ["mre", "h2_ilmenite", "magnetic_separation", "volatiles"] as const;
export type ProcessId = (typeof PROCESS_IDS)[number];

export interface ProcessModel {
  id: ProcessId;
  label: string;
  summary: string;
  /** Electrical/thermal energy per kg of feedstock processed, kWh/kg. */
  specificEnergyKWhPerKg: number;
  /** Process-plant mass per kW of process power (excludes the power system), kg/kW. */
  specificMassKgPerKw: number;
  /** Fixed plant mass (excavation, beneficiation, handling), kg. */
  baseMassKg: number;
  /** Nominal operating temperature envelope for telemetry range checks, °C. */
  operatingTempC: { min: number; max: number };
  /** Source types the process is designed for. */
  suitableFor: SourceType[];
  /** Product form per element, for UI and inventory labelling. */
  productForms: Partial<Record<Element, string>>;
  recoveries: (source: CompositionModel) => Partial<Record<Element, number>>;
}

/** Hydrogen-reduction conversion efficiency of ilmenite at ~1000 °C. */
export const ILMENITE_REDUCTION_EFFICIENCY = 0.85;
/** Magnetic separation recovery of free metal grains. */
export const MAGNETIC_METAL_RECOVERY = 0.85;

export const PROCESS_MODELS: Record<ProcessId, ProcessModel> = {
  mre: {
    id: "mre",
    label: "Molten Regolith Electrolysis (MRE)",
    summary:
      "Melts regolith at ~1600 °C and electrolyses it: O₂ at the anode, an Fe–Si–Ti alloy at the cathode. Al, Mg and Ca stay in the slag.",
    specificEnergyKWhPerKg: 3.2,
    specificMassKgPerKw: 8,
    baseMassKg: 1500,
    operatingTempC: { min: 1500, max: 1750 },
    suitableFor: ["lunar_mare_high_ti", "lunar_mare_low_ti", "lunar_highland", "nea_s", "nea_c"],
    productForms: {
      O: "O₂ gas (liquefied separately)",
      Fe: "Fe–Si–Ti cathode alloy",
      Si: "Fe–Si–Ti cathode alloy",
      Ti: "Fe–Si–Ti cathode alloy",
    },
    recoveries: () => ({ O: 0.5, Fe: 0.9, Si: 0.6, Ti: 0.6 }),
  },
  h2_ilmenite: {
    id: "h2_ilmenite",
    label: "Hydrogen reduction of ilmenite",
    summary:
      "Beneficiated ilmenite is reduced with H₂ at ~900–1050 °C: FeTiO₃ + H₂ → Fe + TiO₂ + H₂O; the water is electrolysed for O₂ and the H₂ recycled. Leaves a TiO₂-rich residue.",
    specificEnergyKWhPerKg: 1.2,
    specificMassKgPerKw: 6,
    baseMassKg: 1200,
    operatingTempC: { min: 850, max: 1100 },
    suitableFor: ["lunar_mare_high_ti", "lunar_mare_low_ti"],
    productForms: {
      O: "O₂ gas",
      Fe: "Metallic Fe (sponge)",
      Ti: "TiO₂-rich residue (Ti-equivalent mass; needs further reduction to metal)",
    },
    recoveries: (source) => {
      const ilm = source.ilmeniteWtPct.nominal;
      const eff = ILMENITE_REDUCTION_EFFICIENCY;
      const share = (fractionInIlmenite: number, bulkWtPct: number) =>
        bulkWtPct > 0 ? Math.min(1, (ilm * fractionInIlmenite * eff) / bulkWtPct) : 0;
      return {
        O: share(REDUCIBLE_O_MASS_FRACTION_IN_ILMENITE, source.elements.O.nominal),
        Fe: share(FE_MASS_FRACTION_IN_ILMENITE, source.elements.Fe.nominal),
        Ti: share(TI_MASS_FRACTION_IN_ILMENITE, source.elements.Ti.nominal),
      };
    },
  },
  magnetic_separation: {
    id: "magnetic_separation",
    label: "Magnetic / metal separation",
    summary:
      "Crushes and magnetically separates free Fe–Ni metal grains. Suited to M-type (and to a lesser degree S-type) material; silicates are rejected.",
    specificEnergyKWhPerKg: 0.08,
    specificMassKgPerKw: 40,
    baseMassKg: 800,
    operatingTempC: { min: -60, max: 80 },
    suitableFor: ["nea_m", "nea_s"],
    productForms: { Fe: "Fe–Ni metal concentrate (Ni not tracked)" },
    recoveries: (source) => ({ Fe: MAGNETIC_METAL_RECOVERY * source.metallicFeFraction }),
  },
  volatiles: {
    id: "volatiles",
    label: "Volatiles extraction (thermal dehydration)",
    summary:
      "Heats carbonaceous material to ~300–650 °C in a closed chamber and condenses the released water.",
    specificEnergyKWhPerKg: 0.3,
    specificMassKgPerKw: 10,
    baseMassKg: 1000,
    operatingTempC: { min: 250, max: 700 },
    suitableFor: ["nea_c"],
    productForms: { H2O: "Liquid water" },
    recoveries: () => ({ H2O: 0.7 }),
  },
};

export function getProcess(id: ProcessId): ProcessModel {
  const model = PROCESS_MODELS[id];
  if (!model) throw new ModelInputError(`Unknown process: ${id}`);
  return model;
}

export function isProcessId(value: string): value is ProcessId {
  return (PROCESS_IDS as readonly string[]).includes(value);
}

export function recoveriesFor(
  processId: ProcessId,
  sourceType: SourceType,
): Record<Element, number> {
  const raw = getProcess(processId).recoveries(getComposition(sourceType));
  const out = {} as Record<Element, number>;
  for (const el of ELEMENTS) {
    const v = raw[el] ?? 0;
    out[el] = Math.max(0, Math.min(1, v));
  }
  return out;
}

/** Throughput (kg feedstock per hour) for a plant drawing `powerKw` of process power. */
export function throughputKgPerHour(processId: ProcessId, powerKw: number): number {
  assertFinitePositive("power", powerKw);
  return powerKw / getProcess(processId).specificEnergyKWhPerKg;
}

/** Plant mass = base + power × (process kg/kW + power-system kg/kW). */
export function plantMassKg(
  processId: ProcessId,
  powerKw: number,
  powerSystemKgPerKw: number,
): number {
  assertFinitePositive("power", powerKw);
  assertFinitePositive("power-system specific mass", powerSystemKgPerKw, true);
  const p = getProcess(processId);
  return p.baseMassKg + powerKw * (p.specificMassKgPerKw + powerSystemKgPerKw);
}

export interface ElementYield {
  element: Element;
  wtPct: number;
  recovery: number;
  kg: number;
  form: string;
}

/** yield = mass processed × wt% × recovery, for every element with non-zero recovery. */
export function computeYields(
  processId: ProcessId,
  sourceType: SourceType,
  massProcessedKg: number,
  compositionOverride?: Partial<Record<Element, number>>,
): ElementYield[] {
  assertFinitePositive("mass processed", massProcessedKg, true);
  const composition = getComposition(sourceType);
  const recoveries = recoveriesFor(processId, sourceType);
  const forms = getProcess(processId).productForms;
  const out: ElementYield[] = [];
  for (const el of ELEMENTS) {
    const recovery = recoveries[el];
    if (recovery <= 0) continue;
    const wtPct = compositionOverride?.[el] ?? composition.elements[el].nominal;
    if (!Number.isFinite(wtPct) || wtPct < 0 || wtPct > 100) {
      throw new ModelInputError(`wt% for ${el} must be between 0 and 100`);
    }
    out.push({
      element: el,
      wtPct,
      recovery,
      kg: roundKg((massProcessedKg * wtPct * recovery) / 100),
      form: forms[el] ?? el,
    });
  }
  return out;
}

export function processSuitability(processId: ProcessId, sourceType: SourceType): string[] {
  const p = getProcess(processId);
  const warnings: string[] = [];
  if (!p.suitableFor.includes(sourceType)) {
    warnings.push(`${p.label} is not designed for ${getComposition(sourceType).label} feedstock.`);
  }
  if (processId === "h2_ilmenite" && getComposition(sourceType).ilmeniteWtPct.nominal < 5) {
    warnings.push(
      "Ilmenite content is low; hydrogen reduction yields will be poor without heavy beneficiation.",
    );
  }
  return warnings;
}
