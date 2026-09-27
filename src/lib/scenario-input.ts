import { z } from "zod";
import {
  DEFAULT_ECONOMICS_PARAMS,
  ELEMENTS,
  type EconomicsParams,
  ORBITAL_NODES,
  PROCESS_IDS,
} from "@/lib/models";

const usd = (max: number) => z.coerce.number().min(0).max(max);

/**
 * Scenario parameters as entered in forms (dollars, percentages). `toEconomicsParams` converts to
 * the model's canonical units (integer cents, fractions).
 */
export const scenarioParamsSchema = z.object({
  powerKw: z.coerce.number().min(1, "At least 1 kW").max(100_000),
  uptimePercent: z.coerce.number().min(1).max(100),
  missionDurationDays: z.coerce.number().int().min(1).max(7305),
  deliveryNode: z.enum(ORBITAL_NODES),
  productElements: z.array(z.enum(ELEMENTS)).max(ELEMENTS.length).optional(),
  ispSeconds: z.coerce.number().min(200).max(1_000),
  tankageFraction: z.coerce.number().min(0).max(0.5),
  powerSystemKgPerKw: z.coerce.number().min(0).max(500),
  launchCostPerKgUsd: usd(1_000_000),
  plantHardwareCostPerKgUsd: usd(10_000_000),
  opsCostPerYearUsd: usd(10_000_000_000),
  inSpacePropellantCostPerKgUsd: usd(1_000_000),
  salePricePerKgUsd: usd(10_000_000),
  discountRatePercent: z.coerce.number().min(0).max(100),
});

export type ScenarioParamsInput = z.infer<typeof scenarioParamsSchema>;

export const scenarioCreateSchema = scenarioParamsSchema.extend({
  name: z.string().trim().min(3, "Name the scenario").max(120),
  targetId: z.uuid("Choose a target"),
  processId: z.enum(PROCESS_IDS),
  notes: z.string().trim().max(2_000).optional(),
});

export const economicsPreviewSchema = scenarioParamsSchema.extend({
  targetId: z.uuid(),
  processId: z.enum(PROCESS_IDS),
});

const toCents = (usdValue: number) => Math.round(usdValue * 100);

export function toEconomicsParams(p: ScenarioParamsInput): EconomicsParams {
  return {
    powerKw: p.powerKw,
    uptimeFraction: p.uptimePercent / 100,
    missionDurationDays: p.missionDurationDays,
    deliveryNode: p.deliveryNode,
    productElements: p.productElements?.length ? p.productElements : undefined,
    ispSeconds: p.ispSeconds,
    tankageFraction: p.tankageFraction,
    powerSystemKgPerKw: p.powerSystemKgPerKw,
    launchCostPerKgCents: toCents(p.launchCostPerKgUsd),
    plantHardwareCostPerKgCents: toCents(p.plantHardwareCostPerKgUsd),
    opsCostPerYearCents: toCents(p.opsCostPerYearUsd),
    inSpacePropellantCostPerKgCents: toCents(p.inSpacePropellantCostPerKgUsd),
    salePricePerKgCents: toCents(p.salePricePerKgUsd),
    discountRatePercent: p.discountRatePercent,
  };
}

/** Form defaults mirroring DEFAULT_ECONOMICS_PARAMS. */
export const DEFAULT_SCENARIO_FORM: ScenarioParamsInput = {
  powerKw: DEFAULT_ECONOMICS_PARAMS.powerKw,
  uptimePercent: DEFAULT_ECONOMICS_PARAMS.uptimeFraction * 100,
  missionDurationDays: DEFAULT_ECONOMICS_PARAMS.missionDurationDays,
  deliveryNode: "EML1",
  ispSeconds: DEFAULT_ECONOMICS_PARAMS.ispSeconds,
  tankageFraction: DEFAULT_ECONOMICS_PARAMS.tankageFraction,
  powerSystemKgPerKw: DEFAULT_ECONOMICS_PARAMS.powerSystemKgPerKw,
  launchCostPerKgUsd: DEFAULT_ECONOMICS_PARAMS.launchCostPerKgCents / 100,
  plantHardwareCostPerKgUsd: DEFAULT_ECONOMICS_PARAMS.plantHardwareCostPerKgCents / 100,
  opsCostPerYearUsd: DEFAULT_ECONOMICS_PARAMS.opsCostPerYearCents / 100,
  inSpacePropellantCostPerKgUsd: DEFAULT_ECONOMICS_PARAMS.inSpacePropellantCostPerKgCents / 100,
  salePricePerKgUsd: DEFAULT_ECONOMICS_PARAMS.salePricePerKgCents / 100,
  discountRatePercent: DEFAULT_ECONOMICS_PARAMS.discountRatePercent,
};
