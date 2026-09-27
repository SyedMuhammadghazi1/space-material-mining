/**
 * Mission economics — FIRST-ORDER PLANNING MODEL.
 *
 * Cost structure (all money in integer US cents on output):
 *  - capex at t = 0: plant hardware ($/kg of plant) + launching the plant to LEO and pushing it to
 *    the site (plant mass × "gear ratio" from the rocket equation × $/kg to LEO);
 *  - opex per year of operations (team, comms, spares — a single configurable figure);
 *  - product transport from site to delivery node: propellant per kg of product × in-space
 *    propellant price.
 * Revenue: delivered kg × sale price at the delivery node.
 * NPV discounts annual cash flows (end-of-period) at the given rate; a fractional last year is
 * pro-rated. The breakeven price is the sale price that makes NPV exactly zero (NPV is linear in
 * price). The Earth comparison prices the same kg launched from Earth to LEO and pushed to the
 * delivery node with the same stage assumptions — the core "make it in space" value proposition.
 *
 * Deliberately ignored: learning curves, plant degradation, ramp-up, insurance, taxes, financing
 * structure, tug hardware amortisation, demand limits and price elasticity.
 */
import { type Element, ELEMENTS, type SourceType } from "./composition";
import { type OrbitalNode, nodeToNodeDeltaV } from "./delta-v";
import {
  type ElementYield,
  type ProcessId,
  computeYields,
  plantMassKg,
  processSuitability,
  throughputKgPerHour,
} from "./processes";
import { leoMassPerDeliveredKg, propellantPerKgPayload } from "./rocket";
import {
  DAYS_PER_YEAR,
  HOURS_PER_DAY,
  ModelInputError,
  assertFinitePositive,
  roundCents,
  roundKg,
  roundMs,
  roundTo,
} from "./units";
import { MODEL_VERSION } from "./version";

/** Inventory item code for each modelled element. */
export const ELEMENT_ITEM_CODES: Record<Element, string> = {
  O: "O2",
  Si: "SI",
  Ti: "TI",
  Fe: "FE",
  Al: "AL",
  Mg: "MG",
  H2O: "H2O",
};

export interface EconomicsParams {
  powerKw: number;
  uptimeFraction: number;
  missionDurationDays: number;
  deliveryNode: OrbitalNode;
  /** Elements to ship and sell; defaults to every element the process recovers. */
  productElements?: Element[];
  ispSeconds: number;
  tankageFraction: number;
  powerSystemKgPerKw: number;
  launchCostPerKgCents: number;
  plantHardwareCostPerKgCents: number;
  opsCostPerYearCents: number;
  inSpacePropellantCostPerKgCents: number;
  salePricePerKgCents: number;
  discountRatePercent: number;
}

export const DEFAULT_ECONOMICS_PARAMS: Omit<EconomicsParams, "deliveryNode"> = {
  powerKw: 200,
  uptimeFraction: 0.7,
  missionDurationDays: 5 * 365,
  ispSeconds: 450,
  tankageFraction: 0.1,
  powerSystemKgPerKw: 15,
  launchCostPerKgCents: 250_000, // $2,500 / kg to LEO
  plantHardwareCostPerKgCents: 3_000_000, // $30,000 / kg of flight hardware
  opsCostPerYearCents: 1_000_000_000, // $10M / year
  inSpacePropellantCostPerKgCents: 100_000, // $1,000 / kg
  salePricePerKgCents: 400_000, // $4,000 / kg delivered
  discountRatePercent: 10,
};

export interface MissionEconomicsInput extends EconomicsParams {
  sourceType: SourceType;
  processId: ProcessId;
  /** LEO → site Δv (to deliver the plant), m/s. */
  outboundDeltaVMs: number;
  /** Site → delivery node Δv (to ship product), m/s. */
  returnDeltaVMs: number;
}

export interface MissionEconomicsResult {
  modelVersion: string;
  plant: { massKg: number; powerKw: number; throughputKgPerHour: number; leoMassKg: number };
  production: {
    operatingHours: number;
    regolithProcessedKg: number;
    yields: (ElementYield & { itemCode: string; delivered: boolean })[];
    totalRecoveredKg: number;
    deliveredKg: number;
    deliveredKgPerYear: number;
  };
  transport: {
    outboundDeltaVMs: number;
    returnDeltaVMs: number;
    plantGearRatio: number;
    propellantKgPerKgProduct: number;
    transportCostPerKgCents: number;
  };
  costs: {
    hardwareCents: number;
    launchCents: number;
    capexCents: number;
    opsCents: number;
    transportCents: number;
    totalCents: number;
  };
  unitEconomics: {
    costPerDeliveredKgCents: number | null;
    earthGearRatio: number;
    earthLaunchCostPerKgAtNodeCents: number;
    savingsPerKgCents: number | null;
    costRatioVsEarth: number | null;
  };
  finance: {
    years: number;
    discountRatePercent: number;
    salePricePerKgCents: number;
    revenueCents: number;
    npvCents: number;
    breakevenPricePerKgCents: number | null;
  };
  warnings: string[];
}

export function validateEconomicsParams(p: EconomicsParams): void {
  assertFinitePositive("power (kW)", p.powerKw);
  if (!(p.uptimeFraction > 0 && p.uptimeFraction <= 1)) {
    throw new ModelInputError("uptime must be in (0, 1]");
  }
  if (!(p.missionDurationDays >= 1 && p.missionDurationDays <= 20 * DAYS_PER_YEAR)) {
    throw new ModelInputError("mission duration must be between 1 day and 20 years");
  }
  assertFinitePositive("Isp", p.ispSeconds);
  for (const [name, v] of [
    ["launch cost", p.launchCostPerKgCents],
    ["hardware cost", p.plantHardwareCostPerKgCents],
    ["ops cost", p.opsCostPerYearCents],
    ["propellant cost", p.inSpacePropellantCostPerKgCents],
    ["sale price", p.salePricePerKgCents],
  ] as const) {
    if (!Number.isInteger(v) || v < 0)
      throw new ModelInputError(`${name} must be a non-negative integer number of cents`);
  }
  if (!(p.discountRatePercent >= 0 && p.discountRatePercent <= 100)) {
    throw new ModelInputError("discount rate must be between 0 and 100%");
  }
}

/** Discount factors and period fractions for an annual schedule covering `years`. */
export function annualSchedule(
  years: number,
  ratePercent: number,
): { fraction: number; factor: number }[] {
  const periods = Math.max(1, Math.ceil(years - 1e-9));
  const r = ratePercent / 100;
  return Array.from({ length: periods }, (_, idx) => {
    const k = idx + 1;
    return { fraction: Math.min(1, years - idx), factor: 1 / (1 + r) ** k };
  });
}

/** NPV of −capex at t=0 plus a level annual net cash flow, pro-rated for a partial last year. */
export function npv(capex: number, annualNet: number, years: number, ratePercent: number): number {
  return annualSchedule(years, ratePercent).reduce(
    (acc, p) => acc + p.fraction * annualNet * p.factor,
    -capex,
  );
}

export function evaluateMissionEconomics(input: MissionEconomicsInput): MissionEconomicsResult {
  validateEconomicsParams(input);
  assertFinitePositive("outbound Δv", input.outboundDeltaVMs, true);
  assertFinitePositive("return Δv", input.returnDeltaVMs, true);
  const warnings = [...processSuitability(input.processId, input.sourceType)];

  // Plant & production -------------------------------------------------------------------------
  const massKg = plantMassKg(input.processId, input.powerKw, input.powerSystemKgPerKw);
  const throughput = throughputKgPerHour(input.processId, input.powerKw);
  const years = input.missionDurationDays / DAYS_PER_YEAR;
  const operatingHours = input.missionDurationDays * HOURS_PER_DAY * input.uptimeFraction;
  const processedKg = throughput * operatingHours;
  const yields = computeYields(input.processId, input.sourceType, processedKg);

  const wanted = new Set<Element>(input.productElements?.length ? input.productElements : ELEMENTS);
  const annotated = yields.map((y) => ({
    ...y,
    itemCode: ELEMENT_ITEM_CODES[y.element],
    delivered: wanted.has(y.element),
  }));
  const totalRecoveredKg = annotated.reduce((s, y) => s + y.kg, 0);
  const deliveredKg = annotated.filter((y) => y.delivered).reduce((s, y) => s + y.kg, 0);
  if (deliveredKg <= 0)
    warnings.push("This process recovers none of the selected products from this source.");

  // Transport ----------------------------------------------------------------------------------
  // Throws InfeasibleTransferError when a single stage cannot deliver the Δv.
  const plantGear = leoMassPerDeliveredKg(
    input.outboundDeltaVMs,
    input.ispSeconds,
    input.tankageFraction,
  );
  const propPerKg = propellantPerKgPayload(
    input.returnDeltaVMs,
    input.ispSeconds,
    input.tankageFraction,
  );
  const transportCostPerKg = propPerKg * input.inSpacePropellantCostPerKgCents;

  // Costs ----------------------------------------------------------------------------------------
  const hardware = massKg * input.plantHardwareCostPerKgCents;
  const launch = massKg * plantGear * input.launchCostPerKgCents;
  const capex = hardware + launch;
  const opsTotal = input.opsCostPerYearCents * years;
  const transportTotal = deliveredKg * transportCostPerKg;
  const total = capex + opsTotal + transportTotal;

  // Earth comparison -----------------------------------------------------------------------------
  const earthDv = nodeToNodeDeltaV("LEO", input.deliveryNode).deltaVMs;
  const earthGear = leoMassPerDeliveredKg(earthDv, input.ispSeconds, input.tankageFraction);
  const earthCostPerKg = input.launchCostPerKgCents * earthGear;
  const costPerKg = deliveredKg > 0 ? total / deliveredKg : null;

  // Finance --------------------------------------------------------------------------------------
  const deliveredPerYear = years > 0 ? deliveredKg / years : 0;
  const annualNetExPrice = -(input.opsCostPerYearCents + deliveredPerYear * transportCostPerKg);
  const annualRevenue = deliveredPerYear * input.salePricePerKgCents;
  const npvValue = npv(capex, annualRevenue + annualNetExPrice, years, input.discountRatePercent);
  const schedule = annualSchedule(years, input.discountRatePercent);
  const discountedYears = schedule.reduce((s, p) => s + p.fraction * p.factor, 0);
  const breakeven =
    deliveredPerYear > 0
      ? (capex - annualNetExPrice * discountedYears) / (deliveredPerYear * discountedYears)
      : null;

  if (breakeven !== null && input.salePricePerKgCents < breakeven) {
    warnings.push("Sale price is below the discounted breakeven price — NPV is negative.");
  }
  if (costPerKg !== null && costPerKg > earthCostPerKg) {
    warnings.push("Delivered cost exceeds launching the same mass from Earth to this node.");
  }

  return {
    modelVersion: MODEL_VERSION,
    plant: {
      massKg: roundKg(massKg),
      powerKw: input.powerKw,
      throughputKgPerHour: roundTo(throughput, 2),
      leoMassKg: roundKg(massKg * plantGear),
    },
    production: {
      operatingHours: roundTo(operatingHours, 1),
      regolithProcessedKg: roundKg(processedKg),
      yields: annotated,
      totalRecoveredKg: roundKg(totalRecoveredKg),
      deliveredKg: roundKg(deliveredKg),
      deliveredKgPerYear: roundKg(deliveredPerYear),
    },
    transport: {
      outboundDeltaVMs: roundMs(input.outboundDeltaVMs),
      returnDeltaVMs: roundMs(input.returnDeltaVMs),
      plantGearRatio: roundTo(plantGear, 3),
      propellantKgPerKgProduct: roundTo(propPerKg, 4),
      transportCostPerKgCents: roundCents(transportCostPerKg),
    },
    costs: {
      hardwareCents: roundCents(hardware),
      launchCents: roundCents(launch),
      capexCents: roundCents(capex),
      opsCents: roundCents(opsTotal),
      transportCents: roundCents(transportTotal),
      totalCents: roundCents(total),
    },
    unitEconomics: {
      costPerDeliveredKgCents: costPerKg === null ? null : roundCents(costPerKg),
      earthGearRatio: roundTo(earthGear, 3),
      earthLaunchCostPerKgAtNodeCents: roundCents(earthCostPerKg),
      savingsPerKgCents: costPerKg === null ? null : roundCents(earthCostPerKg - costPerKg),
      costRatioVsEarth: costPerKg === null ? null : roundTo(costPerKg / earthCostPerKg, 4),
    },
    finance: {
      years: roundTo(years, 3),
      discountRatePercent: input.discountRatePercent,
      salePricePerKgCents: input.salePricePerKgCents,
      revenueCents: roundCents(deliveredKg * input.salePricePerKgCents),
      npvCents: roundCents(npvValue),
      breakevenPricePerKgCents: breakeven === null ? null : roundCents(breakeven),
    },
    warnings,
  };
}
