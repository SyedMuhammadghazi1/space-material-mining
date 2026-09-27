/**
 * Quote pricing engine — pure and deterministic.
 *
 * Material price at node D = min over cost bases b of [ b.costPerKg + transport(b.node → D) ],
 * where transport uses the node Δv map, the rocket equation and the in-space propellant price.
 * Product price = Σ BOM inputs landed at the fabrication node + fabrication energy + fabrication
 * ops cost, then the finished unit's mass is shipped to D. A configurable margin is applied and
 * the unit price is rounded UP to the cent (never undercharge). Cost bases come from mission
 * scenarios computed by the economics model (see `material_cost_bases`).
 */
import { type OrbitalNode, nodeToNodeDeltaV } from "./delta-v";
import { propellantPerKgPayload } from "./rocket";
import { ModelInputError, ceilCents, roundCents, roundKg } from "./units";

export interface CostBasis {
  itemCode: string;
  node: OrbitalNode;
  costPerKgCents: number;
}

export interface ProductSpec {
  code: string;
  unitMassKg: number;
  bom: { itemCode: string; kgPerUnit: number }[];
  energyKWhPerUnit: number;
  opsCostPerUnitCents: number;
  fabricationNode: OrbitalNode;
  leadTimeDays: number;
}

export interface PricingParams {
  marginPercent: number;
  ispSeconds: number;
  tankageFraction: number;
  inSpacePropellantCostPerKgCents: number;
  energyCostPerKWhCents: number;
  validityDays: number;
}

export type QuoteSubject =
  { kind: "material"; itemCode: string } | { kind: "product"; product: ProductSpec };

export interface QuoteInput {
  subject: QuoteSubject;
  /** kg for materials; whole units for products. */
  quantity: number;
  deliveryNode: OrbitalNode;
  bases: CostBasis[];
  params: PricingParams;
  now: Date;
  targetDate?: Date | null;
}

export interface QuoteLine {
  label: string;
  perUnitCents: number;
}

export interface QuotePricing {
  unitCostCents: number;
  unitPriceCents: number;
  totalCents: number;
  marginPercent: number;
  lines: QuoteLine[];
  originNode: OrbitalNode;
  deltaVMs: number;
  transitDays: number;
  earliestDeliveryDate: string;
  validUntil: string;
  warnings: string[];
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export function validatePricingParams(p: PricingParams): void {
  if (!(p.marginPercent >= 0 && p.marginPercent <= 500))
    throw new ModelInputError("margin must be 0–500%");
  if (!(Number.isInteger(p.validityDays) && p.validityDays >= 1 && p.validityDays <= 365)) {
    throw new ModelInputError("validity must be 1–365 days");
  }
}

/** Transport cost (cents) per kg shipped between two nodes. */
export function transportCostPerKgCents(
  from: OrbitalNode,
  to: OrbitalNode,
  params: Pick<PricingParams, "ispSeconds" | "tankageFraction" | "inSpacePropellantCostPerKgCents">,
): { cents: number; deltaVMs: number; transitDays: number } {
  const leg = nodeToNodeDeltaV(from, to);
  const prop = propellantPerKgPayload(leg.deltaVMs, params.ispSeconds, params.tankageFraction);
  return {
    cents: prop * params.inSpacePropellantCostPerKgCents,
    deltaVMs: leg.deltaVMs,
    transitDays: leg.transitDays,
  };
}

/** Cheapest landed cost per kg of a material at `node` across all cost bases. */
export function landedMaterialCost(
  itemCode: string,
  node: OrbitalNode,
  bases: CostBasis[],
  params: PricingParams,
): {
  perKgCents: number;
  basis: CostBasis;
  transportPerKgCents: number;
  deltaVMs: number;
  transitDays: number;
} {
  const candidates = bases.filter((b) => b.itemCode === itemCode);
  if (candidates.length === 0)
    throw new PricingError(`No cost basis is configured for ${itemCode}`);
  let best: ReturnType<typeof landedMaterialCost> | null = null;
  for (const basis of candidates) {
    const t = transportCostPerKgCents(basis.node, node, params);
    const perKg = basis.costPerKgCents + t.cents;
    if (!best || perKg < best.perKgCents) {
      best = {
        perKgCents: perKg,
        basis,
        transportPerKgCents: t.cents,
        deltaVMs: t.deltaVMs,
        transitDays: t.transitDays,
      };
    }
  }
  return best!;
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function priceQuote(input: QuoteInput): QuotePricing {
  const { subject, quantity, deliveryNode, bases, params, now } = input;
  validatePricingParams(params);
  if (!(quantity > 0) || !Number.isFinite(quantity))
    throw new ModelInputError("quantity must be positive");
  if (subject.kind === "product" && !Number.isInteger(quantity)) {
    throw new ModelInputError("products are quoted in whole units");
  }
  const warnings: string[] = [];
  const lines: QuoteLine[] = [];
  let unitCost = 0;
  let originNode: OrbitalNode;
  let deltaVMs: number;
  let transitDays: number;
  let leadDays = 7; // handling / loading at origin depot

  if (subject.kind === "material") {
    const landed = landedMaterialCost(subject.itemCode, deliveryNode, bases, params);
    lines.push({
      label: `Production cost basis at ${landed.basis.node}`,
      perUnitCents: landed.basis.costPerKgCents,
    });
    lines.push({
      label: `Transport ${landed.basis.node} → ${deliveryNode}`,
      perUnitCents: landed.transportPerKgCents,
    });
    unitCost = landed.perKgCents;
    originNode = landed.basis.node;
    deltaVMs = landed.deltaVMs;
    transitDays = landed.transitDays;
  } else {
    const product = subject.product;
    if (product.bom.length === 0)
      throw new PricingError(`Product ${product.code} has no bill of materials`);
    let materials = 0;
    for (const line of product.bom) {
      const landed = landedMaterialCost(line.itemCode, product.fabricationNode, bases, params);
      materials += line.kgPerUnit * landed.perKgCents;
    }
    const energy = product.energyKWhPerUnit * params.energyCostPerKWhCents;
    const ship = transportCostPerKgCents(product.fabricationNode, deliveryNode, params);
    const shipping = product.unitMassKg * ship.cents;
    lines.push({
      label: `Bill of materials landed at ${product.fabricationNode}`,
      perUnitCents: materials,
    });
    lines.push({ label: "Fabrication energy", perUnitCents: energy });
    lines.push({ label: "Fabrication operations", perUnitCents: product.opsCostPerUnitCents });
    lines.push({
      label: `Transport ${product.fabricationNode} → ${deliveryNode} (${roundKg(product.unitMassKg)} kg/unit)`,
      perUnitCents: shipping,
    });
    unitCost = materials + energy + product.opsCostPerUnitCents + shipping;
    originNode = product.fabricationNode;
    deltaVMs = ship.deltaVMs;
    transitDays = ship.transitDays;
    leadDays += product.leadTimeDays;
  }

  const marginCents = unitCost * (params.marginPercent / 100);
  lines.push({ label: `Margin (${params.marginPercent}%)`, perUnitCents: marginCents });
  const unitPriceCents = ceilCents(unitCost + marginCents);
  const totalCents = multiplyCents(unitPriceCents, quantity);

  const earliest = addDays(now, leadDays + Math.ceil(transitDays));
  if (input.targetDate && input.targetDate.getTime() < earliest.getTime()) {
    warnings.push(
      `Requested date is earlier than the earliest feasible delivery (${isoDate(earliest)}).`,
    );
  }

  return {
    unitCostCents: roundCents(unitCost),
    unitPriceCents,
    totalCents,
    marginPercent: params.marginPercent,
    lines: lines.map((l) => ({ label: l.label, perUnitCents: roundCents(l.perUnitCents) })),
    originNode,
    deltaVMs,
    transitDays,
    earliestDeliveryDate: isoDate(earliest),
    validUntil: addDays(now, params.validityDays).toISOString(),
    warnings,
  };
}

/** unit price (integer cents) × quantity (kg to the gram, or whole units), rounded up to the cent. */
export function multiplyCents(unitPriceCents: number, quantity: number): number {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0)
    throw new ModelInputError("unit price must be integer cents");
  const milli = BigInt(Math.round(quantity * 1000));
  const product = BigInt(unitPriceCents) * milli;
  const total = (product + 999n) / 1000n; // ceil for non-negative values
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ModelInputError("total exceeds the supported range");
  return Number(total);
}

/** Deposit = ceil(total × percent / 100), computed in integer arithmetic. */
export function depositCents(totalCents: number, depositPercent: number): number {
  if (!Number.isInteger(totalCents) || totalCents < 0)
    throw new ModelInputError("total must be integer cents");
  if (!(depositPercent >= 0 && depositPercent <= 100))
    throw new ModelInputError("deposit percent must be 0–100");
  const bps = BigInt(Math.round(depositPercent * 100));
  const numerator = BigInt(totalCents) * bps;
  return Number((numerator + 9_999n) / 10_000n);
}
