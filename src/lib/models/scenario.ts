/**
 * Scenario evaluation: composes the Δv, composition, process and economics models for one target.
 */
import type { SourceType } from "./composition";
import {
  type NeaDeltaVEstimate,
  type SiteTransport,
  estimateNeaDeltaV,
  siteTransport,
} from "./delta-v";
import {
  type EconomicsParams,
  type MissionEconomicsResult,
  evaluateMissionEconomics,
} from "./economics";
import type { ProcessId } from "./processes";
import { ModelInputError } from "./units";

export interface ScenarioTarget {
  kind: "lunar_site" | "nea";
  sourceType: SourceType;
  aAu?: number | null;
  e?: number | null;
  iDeg?: number | null;
}

export interface ScenarioResult extends MissionEconomicsResult {
  deltaV: SiteTransport & { nea: NeaDeltaVEstimate | null };
}

export function evaluateScenario(
  target: ScenarioTarget,
  processId: ProcessId,
  params: EconomicsParams,
): ScenarioResult {
  let transport: SiteTransport;
  let nea: NeaDeltaVEstimate | null = null;
  if (target.kind === "nea") {
    if (target.aAu == null || target.e == null || target.iDeg == null) {
      throw new ModelInputError("NEA targets need orbital elements (a, e, i)");
    }
    const elements = { aAu: target.aAu, e: target.e, iDeg: target.iDeg };
    nea = estimateNeaDeltaV(elements);
    transport = siteTransport({ kind: "nea", ...elements }, params.deliveryNode);
  } else {
    transport = siteTransport({ kind: "lunar_site" }, params.deliveryNode);
  }
  const economics = evaluateMissionEconomics({
    ...params,
    sourceType: target.sourceType,
    processId,
    outboundDeltaVMs: transport.outboundFromLeoMs,
    returnDeltaVMs: transport.returnToNodeMs,
  });
  return { ...economics, deltaV: { ...transport, nea } };
}
