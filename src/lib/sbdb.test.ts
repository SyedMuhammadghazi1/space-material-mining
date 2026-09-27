import { describe, expect, it, vi } from "vitest";
import { SbdbError, fetchSbdbTarget, mapSbdbResponse, sbdbUrl } from "./sbdb";

/** Trimmed-down but structurally faithful SBDB payload for 101955 Bennu. */
const bennu = {
  object: {
    fullname: "101955 Bennu (1999 RQ36)",
    des: "101955",
    shortname: "101955 Bennu",
    neo: true,
    pha: true,
    orbit_class: { code: "APO", name: "Apollo" },
  },
  orbit: {
    epoch: "2460600.5",
    elements: [
      { name: "e", value: ".2037450762416414", title: "eccentricity" },
      { name: "a", value: "1.126391025894812", units: "au" },
      { name: "q", value: ".8968943016749305", units: "au" },
      { name: "i", value: "6.03494377024794", units: "deg" },
      { name: "om", value: "2.06086619569642", units: "deg" },
    ],
  },
  phys_par: [
    { name: "H", value: "20.21" },
    { name: "diameter", value: "0.49", units: "km" },
    { name: "spec_B", value: "B" },
  ],
};

const okResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("mapSbdbResponse", () => {
  it("maps elements, physical parameters and spectral class", () => {
    const t = mapSbdbResponse(bennu);
    expect(t.name).toBe("101955 Bennu (1999 RQ36)");
    expect(t.designation).toBe("101955");
    expect(t.aAu).toBeCloseTo(1.1264, 4);
    expect(t.e).toBeCloseTo(0.2037, 4);
    expect(t.iDeg).toBeCloseTo(6.035, 3);
    expect(t.hMag).toBe(20.21);
    expect(t.diameterKm).toBe(0.49);
    expect(t.spectralClass).toBe("B");
    expect(t.sourceType).toBe("nea_c");
    expect(t.mappingConfidence).toBe("high");
    expect(t.elementsEpoch).toBe("2460600.5");
    expect(t.orbitClass).toBe("Apollo");
  });

  it("falls back to the Tholen class and tolerates missing physical data", () => {
    const t = mapSbdbResponse({ ...bennu, phys_par: [{ name: "spec_T", value: "S" }] });
    expect(t.spectralClass).toBe("S");
    expect(t.sourceType).toBe("nea_s");
    expect(t.hMag).toBeNull();
    expect(t.diameterKm).toBeNull();
    const none = mapSbdbResponse({ object: bennu.object, orbit: bennu.orbit });
    expect(none.spectralClass).toBeNull();
    expect(none.sourceType).toBeNull();
    expect(none.mappingConfidence).toBe("none");
  });

  it("reports not-found and ambiguous responses", () => {
    expect(() => mapSbdbResponse({ message: "specified object was not found" })).toThrow(
      /not found/,
    );
    expect(() =>
      mapSbdbResponse({
        code: "300",
        list: [
          { pdes: "1", name: "Ceres" },
          { pdes: "2", name: "Pallas" },
        ],
      }),
    ).toThrow(/ambiguous/);
  });

  it("rejects missing or invalid elements", () => {
    const missing = {
      ...bennu,
      orbit: { ...bennu.orbit, elements: bennu.orbit.elements.filter((e) => e.name !== "i") },
    };
    expect(() => mapSbdbResponse(missing)).toThrow(SbdbError);
    const hyperbolic = {
      ...bennu,
      orbit: {
        ...bennu.orbit,
        elements: [
          { name: "a", value: "1.1" },
          { name: "e", value: "1.3" },
          { name: "i", value: "3" },
        ],
      },
    };
    expect(() => mapSbdbResponse(hyperbolic)).toThrow();
    expect(() => mapSbdbResponse("nonsense")).toThrow(SbdbError);
  });
});

describe("fetchSbdbTarget", () => {
  it("calls the SBDB API with the designation and physical parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(bennu));
    const t = await fetchSbdbTarget("101955", fetchMock as unknown as typeof fetch);
    expect(t.designation).toBe("101955");
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://ssd-api.jpl.nasa.gov/sbdb.api");
    expect(url.searchParams.get("sstr")).toBe("101955");
    expect(url.searchParams.get("phys-par")).toBe("1");
    expect(url.searchParams.get("full-prec")).toBe("1");
  });

  it("encodes designations with spaces", () => {
    expect(sbdbUrl("2000 SG344")).toContain("sstr=2000+SG344");
  });

  it("wraps network failures and HTTP errors", async () => {
    const down = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(fetchSbdbTarget("101955", down as unknown as typeof fetch)).rejects.toThrow(
      /Could not reach/,
    );
    const err500 = vi.fn().mockResolvedValue(okResponse({}, 500));
    await expect(fetchSbdbTarget("101955", err500 as unknown as typeof fetch)).rejects.toThrow(
      /HTTP 500/,
    );
    const notFound = vi
      .fn()
      .mockResolvedValue(okResponse({ message: "specified object was not found" }, 404));
    await expect(fetchSbdbTarget("zzz", notFound as unknown as typeof fetch)).rejects.toThrow(
      /not found/,
    );
  });

  it("rejects unsafe designations before calling the network", async () => {
    const fetchMock = vi.fn();
    await expect(
      fetchSbdbTarget("bennu&sstr=x", fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/Invalid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
