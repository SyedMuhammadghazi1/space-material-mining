import { describe, expect, it } from "vitest";
import {
  type CostBasis,
  type PricingParams,
  type ProductSpec,
  PricingError,
  depositCents,
  landedMaterialCost,
  multiplyCents,
  priceQuote,
  transportCostPerKgCents,
} from "./pricing";
import { ModelInputError } from "./units";

const params: PricingParams = {
  marginPercent: 25,
  ispSeconds: 450,
  tankageFraction: 0.1,
  inSpacePropellantCostPerKgCents: 100_000,
  energyCostPerKWhCents: 200,
  validityDays: 30,
};

const bases: CostBasis[] = [
  { itemCode: "O2", node: "LUNAR_SURFACE", costPerKgCents: 30_000 },
  { itemCode: "O2", node: "EML1", costPerKgCents: 200_000 },
  { itemCode: "TI", node: "LUNAR_SURFACE", costPerKgCents: 90_000 },
];

const truss: ProductSpec = {
  code: "TI-TRUSS-2M",
  unitMassKg: 14,
  bom: [{ itemCode: "TI", kgPerUnit: 15.5 }],
  energyKWhPerUnit: 40,
  opsCostPerUnitCents: 150_000,
  fabricationNode: "LUNAR_SURFACE",
  leadTimeDays: 10,
};

const now = new Date("2026-09-01T00:00:00Z");

describe("transport cost", () => {
  it("is zero at the same node", () => {
    expect(transportCostPerKgCents("EML1", "EML1", params).cents).toBe(0);
  });
  it("grows with Δv", () => {
    const a = transportCostPerKgCents("LUNAR_SURFACE", "LLO", params).cents;
    const b = transportCostPerKgCents("LUNAR_SURFACE", "EML1", params).cents;
    expect(b).toBeGreaterThan(a);
  });
});

describe("landed material cost", () => {
  it("picks the cheapest basis after transport", () => {
    const landed = landedMaterialCost("O2", "EML1", bases, params);
    expect(landed.basis.node).toBe("LUNAR_SURFACE");
    expect(landed.perKgCents).toBeLessThan(200_000);
  });
  it("errors without a basis", () => {
    expect(() => landedMaterialCost("FE", "EML1", bases, params)).toThrow(PricingError);
  });
});

describe("priceQuote", () => {
  it("prices materials as (basis + transport) × (1 + margin), rounded up", () => {
    const q = priceQuote({
      subject: { kind: "material", itemCode: "O2" },
      quantity: 1000,
      deliveryNode: "LUNAR_SURFACE",
      bases,
      params,
      now,
    });
    expect(q.unitCostCents).toBe(30_000);
    expect(q.unitPriceCents).toBe(37_500);
    expect(q.totalCents).toBe(37_500_000);
    expect(q.deltaVMs).toBe(0);
  });

  it("adds transport for other nodes and never undercharges", () => {
    const q = priceQuote({
      subject: { kind: "material", itemCode: "O2" },
      quantity: 10,
      deliveryNode: "EML1",
      bases,
      params,
      now,
    });
    const t = transportCostPerKgCents("LUNAR_SURFACE", "EML1", params).cents;
    expect(q.unitPriceCents).toBeGreaterThanOrEqual((30_000 + t) * 1.25);
    expect(q.unitPriceCents - (30_000 + t) * 1.25).toBeLessThan(1);
    expect(q.originNode).toBe("LUNAR_SURFACE");
  });

  it("prices products from BOM, energy, ops and shipping", () => {
    const q = priceQuote({
      subject: { kind: "product", product: truss },
      quantity: 4,
      deliveryNode: "LUNAR_SURFACE",
      bases,
      params,
      now,
    });
    const expectedCost = 15.5 * 90_000 + 40 * 200 + 150_000;
    expect(q.unitCostCents).toBe(expectedCost);
    expect(q.unitPriceCents).toBe(Math.ceil(expectedCost * 1.25));
    expect(q.totalCents).toBe(q.unitPriceCents * 4);
    expect(q.lines.map((l) => l.label).join("|")).toMatch(/Bill of materials/);
  });

  it("requires whole units for products", () => {
    expect(() =>
      priceQuote({
        subject: { kind: "product", product: truss },
        quantity: 1.5,
        deliveryNode: "EML1",
        bases,
        params,
        now,
      }),
    ).toThrow(ModelInputError);
  });

  it("sets validity and warns about infeasible dates", () => {
    const q = priceQuote({
      subject: { kind: "material", itemCode: "O2" },
      quantity: 5,
      deliveryNode: "LEO",
      bases,
      params,
      now,
      targetDate: new Date("2026-09-02T00:00:00Z"),
    });
    expect(q.validUntil).toBe("2026-10-01T00:00:00.000Z");
    expect(q.warnings.join(" ")).toMatch(/earliest feasible delivery/);
  });

  it("higher margin gives a higher price", () => {
    const a = priceQuote({
      subject: { kind: "material", itemCode: "O2" },
      quantity: 1,
      deliveryNode: "LLO",
      bases,
      params,
      now,
    });
    const b = priceQuote({
      subject: { kind: "material", itemCode: "O2" },
      quantity: 1,
      deliveryNode: "LLO",
      bases,
      params: { ...params, marginPercent: 40 },
      now,
    });
    expect(b.unitPriceCents).toBeGreaterThan(a.unitPriceCents);
  });

  it("rejects bad parameters", () => {
    expect(() =>
      priceQuote({
        subject: { kind: "material", itemCode: "O2" },
        quantity: 0,
        deliveryNode: "LLO",
        bases,
        params,
        now,
      }),
    ).toThrow(ModelInputError);
    expect(() =>
      priceQuote({
        subject: { kind: "material", itemCode: "O2" },
        quantity: 1,
        deliveryNode: "LLO",
        bases,
        params: { ...params, validityDays: 0 },
        now,
      }),
    ).toThrow(ModelInputError);
  });
});

describe("integer money helpers", () => {
  it("multiplies cents by fractional kg, rounding up", () => {
    expect(multiplyCents(333, 1.5)).toBe(500); // 499.5 → 500
    expect(multiplyCents(100, 2)).toBe(200);
    expect(multiplyCents(1, 0.001)).toBe(1);
  });

  it("computes deposits with ceiling in integer arithmetic", () => {
    expect(depositCents(1_000_000, 10)).toBe(100_000);
    expect(depositCents(999, 10)).toBe(100); // 99.9 → 100
    expect(depositCents(0, 10)).toBe(0);
    expect(depositCents(12_345, 12.5)).toBe(1_544);
    expect(depositCents(9_007_199_254_740, 10)).toBe(900_719_925_474);
  });

  it("rejects fractional cents", () => {
    expect(() => depositCents(10.5, 10)).toThrow(ModelInputError);
    expect(() => multiplyCents(1.5, 2)).toThrow(ModelInputError);
  });
});
