/**
 * JPL Small-Body Database (SBDB) importer.
 * API: https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=<designation>&phys-par=1&full-prec=1
 * (without full-prec the API rounds elements to ~3 significant figures).
 * Maps osculating elements (a, e, i), H, diameter and spectral class into a target record.
 */
import { z } from "zod";
import { type SourceType, spectralClassToSourceType } from "@/lib/models/composition";
import { validateElements } from "@/lib/models/delta-v";

export const SBDB_ENDPOINT = "https://ssd-api.jpl.nasa.gov/sbdb.api";

const numeric = z.union([z.string(), z.number()]).nullable().optional();

const sbdbResponseSchema = z.object({
  object: z
    .object({
      fullname: z.string(),
      des: z.string(),
      shortname: z.string().optional(),
      neo: z.boolean().optional(),
      pha: z.boolean().optional(),
      orbit_class: z
        .object({ code: z.string().optional(), name: z.string().optional() })
        .optional(),
    })
    .optional(),
  orbit: z
    .object({
      epoch: numeric,
      elements: z.array(z.object({ name: z.string(), value: numeric })),
    })
    .optional(),
  phys_par: z.array(z.object({ name: z.string(), value: numeric })).optional(),
  message: z.string().optional(),
  list: z.array(z.object({ pdes: z.string().optional(), name: z.string().optional() })).optional(),
});

export interface SbdbTarget {
  name: string;
  designation: string;
  aAu: number;
  e: number;
  iDeg: number;
  hMag: number | null;
  diameterKm: number | null;
  spectralClass: string | null;
  sourceType: SourceType | null;
  mappingConfidence: "high" | "medium" | "low" | "none";
  mappingNote: string;
  elementsEpoch: string | null;
  orbitClass: string | null;
  isNeo: boolean | null;
}

export class SbdbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SbdbError";
  }
}

const toNum = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Pure mapping from an SBDB JSON payload to a target record. */
export function mapSbdbResponse(json: unknown): SbdbTarget {
  const parsed = sbdbResponseSchema.safeParse(json);
  if (!parsed.success) throw new SbdbError("Unexpected SBDB response format");
  const data = parsed.data;
  if (!data.object || !data.orbit) {
    if (data.list?.length) {
      throw new SbdbError(
        `Designation is ambiguous; matches include ${data.list
          .slice(0, 5)
          .map((m) => m.name ?? m.pdes)
          .join(", ")}`,
      );
    }
    throw new SbdbError(data.message ?? "Object not found in SBDB");
  }
  const el = (name: string) => toNum(data.orbit!.elements.find((x) => x.name === name)?.value);
  const a = el("a");
  const e = el("e");
  const i = el("i");
  if (a === null || e === null || i === null)
    throw new SbdbError("SBDB response is missing a, e or i");
  validateElements({ aAu: a, e, iDeg: i });

  const phys = (name: string) => data.phys_par?.find((p) => p.name === name)?.value ?? null;
  const specB = phys("spec_B");
  const specT = phys("spec_T");
  const spectralClass =
    (typeof specB === "string" && specB.trim()) ||
    (typeof specT === "string" && specT.trim()) ||
    null;
  const mapping = spectralClassToSourceType(spectralClass);

  return {
    name: data.object.fullname.trim(),
    designation: data.object.des.trim(),
    aAu: a,
    e,
    iDeg: i,
    hMag: toNum(phys("H")),
    diameterKm: toNum(phys("diameter")),
    spectralClass,
    sourceType: mapping.sourceType,
    mappingConfidence: mapping.confidence,
    mappingNote: mapping.note,
    elementsEpoch: data.orbit.epoch == null ? null : String(data.orbit.epoch),
    orbitClass: data.object.orbit_class?.name ?? null,
    isNeo: data.object.neo ?? null,
  };
}

export function sbdbUrl(designation: string): string {
  const url = new URL(SBDB_ENDPOINT);
  url.searchParams.set("sstr", designation.trim());
  url.searchParams.set("phys-par", "1");
  url.searchParams.set("full-prec", "1");
  return url.toString();
}

/** Fetches and maps one object. `fetchImpl` is injectable for tests (network may be blocked). */
export async function fetchSbdbTarget(
  designation: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SbdbTarget> {
  const clean = designation.trim();
  if (!/^[A-Za-z0-9 ()'-]{1,40}$/.test(clean)) throw new SbdbError("Invalid designation");
  let res: Response;
  try {
    res = await fetchImpl(sbdbUrl(clean), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new SbdbError(`Could not reach JPL SBDB: ${(err as Error).message}`);
  }
  if (res.status === 404) throw new SbdbError("Object not found in SBDB");
  if (!res.ok && res.status !== 300) throw new SbdbError(`JPL SBDB returned HTTP ${res.status}`);
  return mapSbdbResponse(await res.json());
}
