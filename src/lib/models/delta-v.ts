/**
 * Δv estimation — FIRST-ORDER PLANNING MODEL, not flight-grade trajectory design.
 *
 * NEA rendezvous uses a patched-conic, impulsive approximation:
 *  1. Earth is on a circular 1 AU heliocentric orbit with zero inclination.
 *  2. A coplanar Hohmann-type transfer runs from 1 AU to either the target's aphelion or its
 *     perihelion (whichever gives the lower total Δv).
 *  3. The hyperbolic excess speed v∞ at Earth departure is converted to a single Oberth burn
 *     from a circular 400 km LEO: Δv = sqrt(v∞² + v_esc²) − v_circ.
 *  4. Arrival rendezvous at the apsis matches speed AND performs the whole plane change in one
 *     burn, via the law of cosines: Δv = sqrt(v1² + v2² − 2·v1·v2·cos Δi).
 *
 * Ignored: launch windows / synodic phasing, Earth's orbital eccentricity, splitting the plane
 * change, gravity assists, finite-burn losses, low-thrust trajectories and the target's true
 * argument of perihelion / node geometry. Results typically differ from optimised trajectories
 * (e.g. the Shoemaker–Helin values published for accessible NEAs) by tens of percent and tend to
 * be pessimistic for inclined targets. Refresh orbital elements from JPL SBDB before use.
 *
 * Cis-lunar node-to-node values come from a widely reproduced Earth–Moon Δv map (impulsive,
 * fully propulsive — no aerobraking), e.g. the compilation in the "Delta-v budget" literature
 * derived from Hopkins/Wertz-style tables. They are one-way values accurate to roughly ±10%.
 */
import {
  AU_M,
  LEO_ALTITUDE_M,
  ModelInputError,
  MU_EARTH,
  MU_SUN,
  R_EARTH_M,
  SECONDS_PER_DAY,
  degToRad,
  roundMs,
  roundTo,
} from "./units";

// ---------------------------------------------------------------------------------------------
// Two-body helpers
// ---------------------------------------------------------------------------------------------

export const circularVelocity = (mu: number, r: number): number => Math.sqrt(mu / r);
export const escapeVelocity = (mu: number, r: number): number => Math.sqrt((2 * mu) / r);
/** Vis-viva: speed at radius r on an orbit with semi-major axis a. */
export function visViva(mu: number, r: number, a: number): number {
  const v2 = mu * (2 / r - 1 / a);
  if (v2 < 0) throw new ModelInputError("radius lies outside the orbit (vis-viva negative)");
  return Math.sqrt(v2);
}

/** Magnitude of the difference of two velocity vectors separated by `angleRad`. */
export function lawOfCosines(v1: number, v2: number, angleRad: number): number {
  return Math.sqrt(Math.max(0, v1 * v1 + v2 * v2 - 2 * v1 * v2 * Math.cos(angleRad)));
}

export const LEO_RADIUS_M = R_EARTH_M + LEO_ALTITUDE_M;

/** Single impulsive burn from a circular parking orbit to a hyperbola with excess speed vInf. */
export function oberthDepartureDeltaV(vInf: number, rPark: number = LEO_RADIUS_M): number {
  const vEsc = escapeVelocity(MU_EARTH, rPark);
  const vCirc = circularVelocity(MU_EARTH, rPark);
  return Math.sqrt(vInf * vInf + vEsc * vEsc) - vCirc;
}

/** Perigee burn that captures an arriving hyperbola (excess vInf) into a marginally bound orbit (C3≈0). */
export function captureToC3ZeroDeltaV(vInf: number, rPeri: number = LEO_RADIUS_M): number {
  const vEsc = escapeVelocity(MU_EARTH, rPeri);
  return Math.sqrt(vInf * vInf + vEsc * vEsc) - vEsc;
}

export interface HohmannResult {
  /** Transfer semi-major axis, m. */
  transferSmaM: number;
  /** Speed change needed at r1 (heliocentric), m/s. */
  dv1: number;
  /** Speed change needed at r2 to circularise (heliocentric), m/s. */
  dv2: number;
  /** Time of flight, days. */
  timeOfFlightDays: number;
}

/** Classic coplanar Hohmann transfer between circular orbits of radius r1 and r2. */
export function hohmann(mu: number, r1: number, r2: number): HohmannResult {
  if (!(r1 > 0) || !(r2 > 0)) throw new ModelInputError("radii must be positive");
  const at = (r1 + r2) / 2;
  const dv1 = Math.abs(visViva(mu, r1, at) - circularVelocity(mu, r1));
  const dv2 = Math.abs(circularVelocity(mu, r2) - visViva(mu, r2, at));
  const tof = Math.PI * Math.sqrt((at * at * at) / mu);
  return { transferSmaM: at, dv1, dv2, timeOfFlightDays: tof / SECONDS_PER_DAY };
}

// ---------------------------------------------------------------------------------------------
// NEA rendezvous estimate
// ---------------------------------------------------------------------------------------------

export interface OrbitalElements {
  /** Semi-major axis, AU. */
  aAu: number;
  /** Eccentricity (0 ≤ e < 1). */
  e: number;
  /** Inclination to the ecliptic, degrees. */
  iDeg: number;
}

export interface NeaTransferCandidate {
  apsis: "aphelion" | "perihelion";
  apsisRadiusAu: number;
  departureVInfMs: number;
  departureFromLeoMs: number;
  arrivalRendezvousMs: number;
  totalFromLeoMs: number;
  timeOfFlightDays: number;
}

export interface NeaDeltaVEstimate {
  method: "patched-conic hohmann-to-apsis v1";
  chosen: NeaTransferCandidate;
  candidates: NeaTransferCandidate[];
  /** Δv to bring product back: NEA departure (by symmetry) + capture to C3≈0 + C3≈0→EML1. */
  returnToEml1Ms: number;
  /** One-way Earth-return time of flight, days (same transfer ellipse). */
  returnTimeOfFlightDays: number;
}

export function validateElements(el: OrbitalElements): void {
  if (!Number.isFinite(el.aAu) || el.aAu <= 0.1 || el.aAu > 10) {
    throw new ModelInputError("semi-major axis must be between 0.1 and 10 AU");
  }
  if (!Number.isFinite(el.e) || el.e < 0 || el.e >= 1) {
    throw new ModelInputError("eccentricity must satisfy 0 ≤ e < 1");
  }
  if (!Number.isFinite(el.iDeg) || el.iDeg < 0 || el.iDeg > 180) {
    throw new ModelInputError("inclination must be between 0 and 180 degrees");
  }
}

function candidate(el: OrbitalElements, apsis: "aphelion" | "perihelion"): NeaTransferCandidate {
  const r1 = AU_M;
  const a = el.aAu * AU_M;
  const r2 = apsis === "aphelion" ? a * (1 + el.e) : a * (1 - el.e);
  const at = (r1 + r2) / 2;

  const vEarth = circularVelocity(MU_SUN, r1);
  const vTransferAtEarth = visViva(MU_SUN, r1, at);
  const vInf = Math.abs(vTransferAtEarth - vEarth);

  const vTransferAtTarget = visViva(MU_SUN, r2, at);
  const vTargetAtApsis = visViva(MU_SUN, r2, a);
  const arrival = lawOfCosines(vTransferAtTarget, vTargetAtApsis, degToRad(el.iDeg));

  const departure = oberthDepartureDeltaV(vInf);
  const tofDays = (Math.PI * Math.sqrt((at * at * at) / MU_SUN)) / SECONDS_PER_DAY;

  return {
    apsis,
    apsisRadiusAu: roundTo(r2 / AU_M, 4),
    departureVInfMs: roundMs(vInf),
    departureFromLeoMs: roundMs(departure),
    arrivalRendezvousMs: roundMs(arrival),
    totalFromLeoMs: roundMs(departure + arrival),
    timeOfFlightDays: roundTo(tofDays, 1),
  };
}

/** Estimate LEO→NEA rendezvous Δv (and product-return Δv) from orbital elements. */
export function estimateNeaDeltaV(el: OrbitalElements): NeaDeltaVEstimate {
  validateElements(el);
  const candidates = [candidate(el, "aphelion"), candidate(el, "perihelion")];
  const chosen = candidates.reduce((best, c) =>
    c.totalFromLeoMs < best.totalFromLeoMs ? c : best,
  );
  const capture = captureToC3ZeroDeltaV(chosen.departureVInfMs);
  const c3ToEml1 = directEdgeDeltaV("C3_ZERO", "EML1");
  return {
    method: "patched-conic hohmann-to-apsis v1",
    chosen,
    candidates,
    returnToEml1Ms: roundMs(chosen.arrivalRendezvousMs + capture + c3ToEml1),
    returnTimeOfFlightDays: chosen.timeOfFlightDays,
  };
}

// ---------------------------------------------------------------------------------------------
// Cis-lunar node map
// ---------------------------------------------------------------------------------------------

export const ORBITAL_NODES = ["LEO", "GEO", "EML1", "LLO", "LUNAR_SURFACE"] as const;
export type OrbitalNode = (typeof ORBITAL_NODES)[number];
type GraphNode = OrbitalNode | "C3_ZERO";

export const NODE_LABELS: Record<OrbitalNode, string> = {
  LEO: "Low Earth orbit (400 km)",
  GEO: "Geostationary orbit",
  EML1: "Earth–Moon L1",
  LLO: "Low lunar orbit (100 km)",
  LUNAR_SURFACE: "Lunar surface",
};

interface Edge {
  a: GraphNode;
  b: GraphNode;
  /** One-way impulsive Δv, m/s (same in both directions — fully propulsive, no aerobraking). */
  dvMs: number;
  /** Rough transit time, days. */
  days: number;
}

/**
 * Documented Δv map (m/s). Sources: commonly reproduced Earth–Moon Δv map values
 * (LEO→GEO 3.90 km/s equatorial, LEO→EML1 3.77, LEO→LLO 4.04, LLO↔surface 1.87,
 * EML1↔LLO 0.64, EML1↔GEO 1.38, LEO→C3=0 3.22, C3=0→EML1 0.14).
 */
export const DELTA_V_EDGES: readonly Edge[] = [
  { a: "LEO", b: "GEO", dvMs: 3900, days: 0.25 },
  { a: "LEO", b: "EML1", dvMs: 3770, days: 4 },
  { a: "LEO", b: "LLO", dvMs: 4040, days: 4 },
  { a: "LEO", b: "C3_ZERO", dvMs: 3220, days: 3 },
  { a: "EML1", b: "GEO", dvMs: 1380, days: 4 },
  { a: "EML1", b: "LLO", dvMs: 640, days: 2 },
  { a: "EML1", b: "C3_ZERO", dvMs: 140, days: 2 },
  { a: "LLO", b: "LUNAR_SURFACE", dvMs: 1870, days: 0.1 },
];

function directEdgeDeltaV(a: GraphNode, b: GraphNode): number {
  const edge = DELTA_V_EDGES.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  if (!edge) throw new ModelInputError(`no direct Δv edge between ${a} and ${b}`);
  return edge.dvMs;
}

export interface NodeTransfer {
  from: OrbitalNode;
  to: OrbitalNode;
  deltaVMs: number;
  transitDays: number;
  path: OrbitalNode[];
}

export function isOrbitalNode(value: string): value is OrbitalNode {
  return (ORBITAL_NODES as readonly string[]).includes(value);
}

/** Minimum-Δv route between two cis-lunar nodes (Dijkstra over the documented map). */
export function nodeToNodeDeltaV(from: OrbitalNode, to: OrbitalNode): NodeTransfer {
  if (!isOrbitalNode(from) || !isOrbitalNode(to)) throw new ModelInputError("unknown orbital node");
  if (from === to) return { from, to, deltaVMs: 0, transitDays: 0, path: [from] };

  const nodes: GraphNode[] = [...ORBITAL_NODES]; // C3_ZERO is not a routable waypoint
  const dist = new Map<GraphNode, number>(nodes.map((n) => [n, Infinity]));
  const days = new Map<GraphNode, number>(nodes.map((n) => [n, 0]));
  const prev = new Map<GraphNode, GraphNode | null>(nodes.map((n) => [n, null]));
  const unvisited = new Set<GraphNode>(nodes);
  dist.set(from, 0);

  while (unvisited.size > 0) {
    let current: GraphNode | null = null;
    for (const n of unvisited) {
      if (current === null || dist.get(n)! < dist.get(current)!) current = n;
    }
    if (current === null || dist.get(current) === Infinity) break;
    unvisited.delete(current);
    if (current === to) break;
    for (const edge of DELTA_V_EDGES) {
      const neighbour = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
      if (!neighbour || !unvisited.has(neighbour)) continue;
      const candidateDist = dist.get(current)! + edge.dvMs;
      if (candidateDist < dist.get(neighbour)!) {
        dist.set(neighbour, candidateDist);
        days.set(neighbour, days.get(current)! + edge.days);
        prev.set(neighbour, current);
      }
    }
  }

  const path: OrbitalNode[] = [];
  let cursor: GraphNode | null = to;
  while (cursor) {
    path.unshift(cursor as OrbitalNode);
    cursor = prev.get(cursor) ?? null;
  }
  return {
    from,
    to,
    deltaVMs: dist.get(to)!,
    transitDays: roundTo(days.get(to)!, 2),
    path,
  };
}

/** Standard lunar reference values called out in the docs. */
export const LUNAR_REFERENCE = {
  leoToLloMs: 4040,
  lloToSurfaceMs: 1870,
} as const;

// ---------------------------------------------------------------------------------------------
// Site-level transport helpers
// ---------------------------------------------------------------------------------------------

export type SiteLocation = { kind: "lunar_site" } | ({ kind: "nea" } & OrbitalElements);

export interface SiteTransport {
  /** LEO → site (used to deliver the plant), m/s. */
  outboundFromLeoMs: number;
  /** Site → delivery node (used to ship product), m/s. */
  returnToNodeMs: number;
  outboundTransitDays: number;
  returnTransitDays: number;
  notes: string[];
}

export function siteTransport(site: SiteLocation, deliveryNode: OrbitalNode): SiteTransport {
  if (site.kind === "lunar_site") {
    const out = nodeToNodeDeltaV("LEO", "LUNAR_SURFACE");
    const back = nodeToNodeDeltaV("LUNAR_SURFACE", deliveryNode);
    return {
      outboundFromLeoMs: out.deltaVMs,
      returnToNodeMs: back.deltaVMs,
      outboundTransitDays: out.transitDays,
      returnTransitDays: back.transitDays,
      notes: [`Product route: ${back.path.join(" → ")}`],
    };
  }
  const nea = estimateNeaDeltaV(site);
  const onward = nodeToNodeDeltaV("EML1", deliveryNode);
  return {
    outboundFromLeoMs: nea.chosen.totalFromLeoMs,
    returnToNodeMs: nea.returnToEml1Ms + onward.deltaVMs,
    outboundTransitDays: nea.chosen.timeOfFlightDays + 3,
    returnTransitDays: roundTo(nea.returnTimeOfFlightDays + onward.transitDays, 1),
    notes: [
      `NEA transfer via ${nea.chosen.apsis} (${nea.chosen.apsisRadiusAu} AU)`,
      `Product route: NEA → EML1${onward.path.length > 1 ? " → " + onward.path.slice(1).join(" → ") : ""}`,
      "Launch windows and synodic phasing are not modelled",
    ],
  };
}
