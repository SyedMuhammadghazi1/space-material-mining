import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bomLines, depots, items, materialCostBases, products } from "@/db/schema";
import { getEnv } from "@/env";
import {
  type CostBasis,
  type OrbitalNode,
  type PricingParams,
  type ProductSpec,
  type QuotePricing,
  priceQuote,
} from "@/lib/models";
import { NotFoundError, ValidationError } from "./errors";
import { TRANSFER_ISP_SECONDS, TRANSFER_TANKAGE_FRACTION } from "./inventory";

export function pricingParams(marginPercent?: number): PricingParams {
  const env = getEnv();
  return {
    marginPercent: marginPercent ?? env.QUOTE_MARGIN_PERCENT,
    ispSeconds: TRANSFER_ISP_SECONDS,
    tankageFraction: TRANSFER_TANKAGE_FRACTION,
    inSpacePropellantCostPerKgCents: env.IN_SPACE_PROPELLANT_COST_PER_KG_CENTS,
    energyCostPerKWhCents: env.FABRICATION_ENERGY_COST_PER_KWH_CENTS,
    validityDays: env.QUOTE_VALIDITY_DAYS,
  };
}

export async function loadCostBases(): Promise<CostBasis[]> {
  const rows = await db.select().from(materialCostBases);
  return rows.map((r) => ({
    itemCode: r.itemCode,
    node: r.node,
    costPerKgCents: r.costPerKgCents,
  }));
}

export async function loadProductSpec(code: string): Promise<ProductSpec | null> {
  const [row] = await db
    .select({ product: products, item: items, depotNode: depots.node })
    .from(products)
    .innerJoin(items, eq(items.code, products.itemCode))
    .leftJoin(depots, eq(depots.id, products.defaultDepotId))
    .where(eq(products.itemCode, code));
  if (!row) return null;
  const bom = await db.select().from(bomLines).where(eq(bomLines.productCode, code));
  return {
    code,
    unitMassKg: row.item.unitMassKg,
    bom: bom.map((b) => ({ itemCode: b.inputCode, kgPerUnit: b.qtyPerUnit })),
    energyKWhPerUnit: row.product.energyKWhPerUnit,
    opsCostPerUnitCents: row.product.opsCostPerUnitCents,
    fabricationNode: row.depotNode ?? "LEO",
    leadTimeDays: row.product.leadTimeDays,
  };
}

/** Server-side price for any catalog item — the only source of prices (never the client). */
export async function priceItem(opts: {
  itemCode: string;
  quantity: number;
  deliveryNode: OrbitalNode;
  marginPercent?: number;
  targetDate?: string | null;
  now?: Date;
}): Promise<QuotePricing> {
  const [item] = await db.select().from(items).where(eq(items.code, opts.itemCode));
  if (!item) throw new NotFoundError("Unknown catalog item");
  const bases = await loadCostBases();
  const params = pricingParams(opts.marginPercent);
  const now = opts.now ?? new Date();
  const targetDate = opts.targetDate ? new Date(`${opts.targetDate}T00:00:00Z`) : null;
  if (item.kind === "product") {
    const spec = await loadProductSpec(item.code);
    if (!spec) throw new ValidationError("Product is missing fabrication data");
    return priceQuote({
      subject: { kind: "product", product: spec },
      quantity: opts.quantity,
      deliveryNode: opts.deliveryNode,
      bases,
      params,
      now,
      targetDate,
    });
  }
  return priceQuote({
    subject: { kind: "material", itemCode: item.code },
    quantity: opts.quantity,
    deliveryNode: opts.deliveryNode,
    bases,
    params,
    now,
    targetDate,
  });
}

export interface CatalogEntry {
  code: string;
  name: string;
  kind: "material" | "product";
  unit: "kg" | "unit";
  unitMassKg: number;
  description: string | null;
  indicativeUnitPriceCents: number | null;
  indicativeNode: OrbitalNode;
  bom: { itemCode: string; qtyPerUnit: number }[];
}

/** Public catalog with indicative (non-binding) unit prices at a reference node. */
export async function listCatalog(indicativeNode: OrbitalNode = "EML1"): Promise<CatalogEntry[]> {
  const rows = await db
    .select()
    .from(items)
    .where(eq(items.isPublic, true))
    .orderBy(asc(items.kind), asc(items.name));
  const allBom = await db.select().from(bomLines);
  const out: CatalogEntry[] = [];
  for (const item of rows) {
    let price: number | null = null;
    try {
      price = (await priceItem({ itemCode: item.code, quantity: 1, deliveryNode: indicativeNode }))
        .unitPriceCents;
    } catch {
      price = null;
    }
    out.push({
      code: item.code,
      name: item.name,
      kind: item.kind,
      unit: item.unit,
      unitMassKg: item.unitMassKg,
      description: item.description,
      indicativeUnitPriceCents: price,
      indicativeNode,
      bom: allBom
        .filter((b) => b.productCode === item.code)
        .map((b) => ({ itemCode: b.inputCode, qtyPerUnit: b.qtyPerUnit })),
    });
  }
  return out;
}
