import { describe, expect, it } from "vitest";
import {
  DELTA_V_EDGES,
  LEO_RADIUS_M,
  LUNAR_REFERENCE,
  ORBITAL_NODES,
  captureToC3ZeroDeltaV,
  circularVelocity,
  escapeVelocity,
  estimateNeaDeltaV,
  hohmann,
  lawOfCosines,
  nodeToNodeDeltaV,
  oberthDepartureDeltaV,
  siteTransport,
  visViva,
} from "./delta-v";
import { AU_M, MU_EARTH, MU_SUN, ModelInputError } from "./units";

describe("two-body helpers", () => {
  it("computes Earth's heliocentric speed ≈ 29.78 km/s", () => {
    expect(circularVelocity(MU_SUN, AU_M)).toBeCloseTo(29_784.7, 0);
  });

  it("computes LEO circular and escape speeds at 400 km", () => {
    expect(circularVelocity(MU_EARTH, LEO_RADIUS_M)).toBeCloseTo(7_668.6, 0);
    expect(escapeVelocity(MU_EARTH, LEO_RADIUS_M)).toBeCloseTo(10_845.1, 0);
  });

  it("vis-viva reduces to circular speed when r = a", () => {
    expect(visViva(MU_SUN, AU_M, AU_M)).toBeCloseTo(circularVelocity(MU_SUN, AU_M), 6);
  });

  it("vis-viva rejects radii beyond aphelion", () => {
    expect(() => visViva(MU_SUN, 3 * AU_M, AU_M)).toThrow(ModelInputError);
  });
});

describe("law of cosines plane change", () => {
  it("is zero for identical coplanar velocities", () => {
    expect(lawOfCosines(5000, 5000, 0)).toBe(0);
  });

  it("reduces to |v1 − v2| without a plane change", () => {
    expect(lawOfCosines(7000, 5000, 0)).toBeCloseTo(2000, 6);
  });

  it("is symmetric in v1 and v2", () => {
    expect(lawOfCosines(3000, 4000, 0.3)).toBeCloseTo(lawOfCosines(4000, 3000, 0.3), 9);
  });

  it("gives 2·v·sin(Δi/2) for a pure plane change", () => {
    const v = 7500;
    const di = (10 * Math.PI) / 180;
    expect(lawOfCosines(v, v, di)).toBeCloseTo(2 * v * Math.sin(di / 2), 6);
  });

  it("is monotonic in the angle on [0, π]", () => {
    let prev = -1;
    for (let deg = 0; deg <= 180; deg += 5) {
      const dv = lawOfCosines(20_000, 21_000, (deg * Math.PI) / 180);
      expect(dv).toBeGreaterThan(prev);
      prev = dv;
    }
  });
});

describe("Oberth departure and capture", () => {
  it("equals escape minus circular speed when v∞ = 0 (≈ 3.18 km/s from 400 km)", () => {
    expect(oberthDepartureDeltaV(0)).toBeCloseTo(3176.5, 0);
  });

  it("grows sub-linearly with v∞ (Oberth effect)", () => {
    const a = oberthDepartureDeltaV(1000) - oberthDepartureDeltaV(0);
    expect(a).toBeLessThan(1000);
    expect(a).toBeGreaterThan(0);
  });

  it("capture to C3≈0 is zero for v∞ = 0 and cheap for small v∞", () => {
    expect(captureToC3ZeroDeltaV(0)).toBe(0);
    expect(captureToC3ZeroDeltaV(1000)).toBeLessThan(100);
  });
});

describe("Hohmann transfer", () => {
  it("reproduces the Earth→Mars textbook values (~2.94 + 2.65 km/s, ~259 days)", () => {
    const r = hohmann(MU_SUN, AU_M, 1.524 * AU_M);
    expect(r.dv1).toBeGreaterThan(2_900);
    expect(r.dv1).toBeLessThan(3_000);
    expect(r.dv2).toBeGreaterThan(2_600);
    expect(r.dv2).toBeLessThan(2_700);
    expect(r.timeOfFlightDays).toBeGreaterThan(250);
    expect(r.timeOfFlightDays).toBeLessThan(265);
  });

  it("is symmetric: r1→r2 total equals r2→r1 total", () => {
    const out = hohmann(MU_SUN, AU_M, 1.3 * AU_M);
    const back = hohmann(MU_SUN, 1.3 * AU_M, AU_M);
    expect(out.dv1 + out.dv2).toBeCloseTo(back.dv1 + back.dv2, 6);
    expect(out.timeOfFlightDays).toBeCloseTo(back.timeOfFlightDays, 9);
  });

  it("costs nothing between identical orbits", () => {
    const r = hohmann(MU_SUN, AU_M, AU_M);
    expect(r.dv1).toBeCloseTo(0, 9);
    expect(r.dv2).toBeCloseTo(0, 9);
  });
});

describe("NEA rendezvous estimate", () => {
  const ryugu = { aAu: 1.19, e: 0.19, iDeg: 5.88 };

  it("an Earth-like orbit costs about the LEO escape Δv and needs no rendezvous burn", () => {
    const est = estimateNeaDeltaV({ aAu: 1, e: 0, iDeg: 0 });
    expect(est.chosen.arrivalRendezvousMs).toBe(0);
    expect(est.chosen.departureVInfMs).toBe(0);
    expect(est.chosen.totalFromLeoMs).toBeGreaterThan(3_150);
    expect(est.chosen.totalFromLeoMs).toBeLessThan(3_200);
  });

  it("gives sane bounds for real accessible NEAs (3–9 km/s from LEO)", () => {
    const targets = [
      ryugu,
      { aAu: 1.126, e: 0.204, iDeg: 6.03 }, // Bennu
      { aAu: 1.324, e: 0.28, iDeg: 1.62 }, // Itokawa
      { aAu: 1.489, e: 0.36, iDeg: 1.43 }, // Nereus
      { aAu: 1.643, e: 0.384, iDeg: 3.41 }, // Didymos
      { aAu: 0.977, e: 0.067, iDeg: 0.11 }, // 2000 SG344
    ];
    for (const t of targets) {
      const est = estimateNeaDeltaV(t);
      expect(est.chosen.totalFromLeoMs).toBeGreaterThan(3_000);
      expect(est.chosen.totalFromLeoMs).toBeLessThan(9_000);
      expect(est.returnToEml1Ms).toBeGreaterThan(0);
    }
  });

  it("2000 SG344 (very Earth-like orbit) is cheaper than Ryugu", () => {
    const sg344 = estimateNeaDeltaV({ aAu: 0.977, e: 0.067, iDeg: 0.11 });
    expect(sg344.chosen.totalFromLeoMs).toBeLessThan(
      estimateNeaDeltaV(ryugu).chosen.totalFromLeoMs,
    );
    expect(sg344.chosen.totalFromLeoMs).toBeLessThan(4_000);
  });

  it("picks the cheaper of the aphelion and perihelion transfers", () => {
    const est = estimateNeaDeltaV(ryugu);
    const totals = est.candidates.map((c) => c.totalFromLeoMs);
    expect(est.chosen.totalFromLeoMs).toBe(Math.min(...totals));
    expect(est.candidates).toHaveLength(2);
  });

  it("is monotonically non-decreasing in inclination", () => {
    let prev = 0;
    for (let i = 0; i <= 40; i += 2) {
      const total = estimateNeaDeltaV({ aAu: 1.2, e: 0.15, iDeg: i }).chosen.totalFromLeoMs;
      expect(total).toBeGreaterThanOrEqual(prev);
      prev = total;
    }
  });

  it("a circular coplanar target at r gives the Hohmann rendezvous values", () => {
    const est = estimateNeaDeltaV({ aAu: 1.3, e: 0, iDeg: 0 });
    const h = hohmann(MU_SUN, AU_M, 1.3 * AU_M);
    expect(est.chosen.departureVInfMs).toBeCloseTo(h.dv1, -1);
    expect(est.chosen.arrivalRendezvousMs).toBeCloseTo(h.dv2, -1);
  });

  it("aphelion and perihelion candidates coincide for circular orbits (symmetric case)", () => {
    const est = estimateNeaDeltaV({ aAu: 1.1, e: 0, iDeg: 3 });
    expect(est.candidates[0]!.totalFromLeoMs).toBe(est.candidates[1]!.totalFromLeoMs);
  });

  it("rejects invalid elements", () => {
    expect(() => estimateNeaDeltaV({ aAu: -1, e: 0.1, iDeg: 1 })).toThrow(ModelInputError);
    expect(() => estimateNeaDeltaV({ aAu: 1.1, e: 1.2, iDeg: 1 })).toThrow(ModelInputError);
    expect(() => estimateNeaDeltaV({ aAu: 1.1, e: 0.1, iDeg: 200 })).toThrow(ModelInputError);
    expect(() => estimateNeaDeltaV({ aAu: Number.NaN, e: 0.1, iDeg: 1 })).toThrow(ModelInputError);
  });
});

describe("cis-lunar node map", () => {
  it("uses the documented lunar values", () => {
    expect(nodeToNodeDeltaV("LEO", "LLO").deltaVMs).toBe(LUNAR_REFERENCE.leoToLloMs);
    expect(nodeToNodeDeltaV("LLO", "LUNAR_SURFACE").deltaVMs).toBe(LUNAR_REFERENCE.lloToSurfaceMs);
    expect(nodeToNodeDeltaV("LEO", "LUNAR_SURFACE").deltaVMs).toBe(4040 + 1870);
    expect(nodeToNodeDeltaV("LEO", "LUNAR_SURFACE").path).toEqual(["LEO", "LLO", "LUNAR_SURFACE"]);
  });

  it("is zero from a node to itself", () => {
    for (const n of ORBITAL_NODES) expect(nodeToNodeDeltaV(n, n).deltaVMs).toBe(0);
  });

  it("is symmetric for every pair", () => {
    for (const a of ORBITAL_NODES) {
      for (const b of ORBITAL_NODES) {
        expect(nodeToNodeDeltaV(a, b).deltaVMs).toBe(nodeToNodeDeltaV(b, a).deltaVMs);
      }
    }
  });

  it("satisfies the triangle inequality (shortest paths)", () => {
    for (const a of ORBITAL_NODES) {
      for (const b of ORBITAL_NODES) {
        for (const c of ORBITAL_NODES) {
          const direct = nodeToNodeDeltaV(a, c).deltaVMs;
          const via = nodeToNodeDeltaV(a, b).deltaVMs + nodeToNodeDeltaV(b, c).deltaVMs;
          expect(direct).toBeLessThanOrEqual(via);
        }
      }
    }
  });

  it("never exceeds a documented direct edge", () => {
    for (const e of DELTA_V_EDGES) {
      if (e.a === "C3_ZERO" || e.b === "C3_ZERO") continue;
      expect(nodeToNodeDeltaV(e.a, e.b).deltaVMs).toBeLessThanOrEqual(e.dvMs);
    }
  });

  it("EML1 sits between LEO and the lunar surface in Δv terms", () => {
    const toEml1 = nodeToNodeDeltaV("LUNAR_SURFACE", "EML1").deltaVMs;
    const toLeo = nodeToNodeDeltaV("LUNAR_SURFACE", "LEO").deltaVMs;
    expect(toEml1).toBeLessThan(toLeo);
    expect(toEml1).toBe(640 + 1870);
  });
});

describe("site transport", () => {
  it("lunar sites ship from the surface", () => {
    const t = siteTransport({ kind: "lunar_site" }, "EML1");
    expect(t.outboundFromLeoMs).toBe(5910);
    expect(t.returnToNodeMs).toBe(2510);
  });

  it("delivering at the lunar surface needs no product transport", () => {
    expect(siteTransport({ kind: "lunar_site" }, "LUNAR_SURFACE").returnToNodeMs).toBe(0);
  });

  it("NEA product return to LEO costs more than to EML1", () => {
    const el = { kind: "nea" as const, aAu: 1.126, e: 0.204, iDeg: 6.03 };
    expect(siteTransport(el, "LEO").returnToNodeMs).toBeGreaterThan(
      siteTransport(el, "EML1").returnToNodeMs,
    );
  });
});
