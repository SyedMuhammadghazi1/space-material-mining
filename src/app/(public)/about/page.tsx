import type { Metadata } from "next";
import { Notice, TableWrap, td, th } from "@/components/ui";
import { APP_NAME } from "@/lib/app-config";
import {
  COMPOSITION_MODELS,
  DELTA_V_EDGES,
  MODEL_VERSION,
  PROCESS_MODELS,
  SOURCE_TYPES,
} from "@/lib/models";

export const metadata: Metadata = { title: "Model assumptions & disclaimer" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Model assumptions &amp; honest disclaimer
        </h1>
        <p className="mt-3 text-slate-700">
          {APP_NAME} is an operating platform for a space-materials company. The hardware to mine
          the Moon or an asteroid does not come from software — what this platform provides is
          planning, accounting and commercial tooling around it. Everything numeric in it rests on
          the assumptions below. Planning model version <strong>{MODEL_VERSION}</strong>; every
          saved mission scenario records the version that produced it.
        </p>
      </header>

      <Notice tone="warn" title="Not flight-grade analysis">
        All physics and economics are first-order planning models intended to compare options and
        frame decisions. They are not trajectory designs, engineering analyses or investment advice.
        Composition values are nominal planning values from published averages and meteorite
        analogues and must be replaced by site-specific survey data. Orbital elements shipped with
        the seed data are approximate; refresh them from the JPL Small-Body Database before use.
      </Notice>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Δv (velocity change)</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>
            <strong>Near-Earth asteroids:</strong> patched-conic, impulsive approximation. Earth on
            a circular 1 AU orbit; a Hohmann-type heliocentric transfer to the target&apos;s
            aphelion or perihelion (whichever is cheaper); v∞ at departure converted into a single
            Oberth burn from a 400 km LEO, Δv = √(v∞² + v<sub>esc</sub>²) − v<sub>circ</sub>;
            arrival speed-match and the entire plane change in one burn via the law of cosines, Δv =
            √(v₁² + v₂² − 2v₁v₂ cos Δi).
          </li>
          <li>
            Ignored: launch windows and synodic phasing, Earth&apos;s eccentricity, splitting the
            plane change, gravity assists, finite burns and low-thrust propulsion. Expect
            differences of tens of percent against optimised trajectories — usually pessimistic for
            inclined targets.
          </li>
          <li>
            Product return from an asteroid: departure Δv by symmetry, a perigee burn to capture
            into a barely-bound Earth orbit, then 0.14 km/s to EML1.
          </li>
          <li>
            Cis-lunar legs use a widely reproduced Earth–Moon Δv map (fully propulsive, no
            aerobraking), accurate to roughly ±10%:
          </li>
        </ul>
        <TableWrap label="Delta-v map edges">
          <thead>
            <tr>
              <th className={th}>From</th>
              <th className={th}>To</th>
              <th className={th}>Δv (km/s, one way)</th>
            </tr>
          </thead>
          <tbody>
            {DELTA_V_EDGES.map((e) => (
              <tr key={`${e.a}-${e.b}`}>
                <td className={td}>{e.a.replace("_", " ")}</td>
                <td className={td}>{e.b.replace("_", " ")}</td>
                <td className={td}>{(e.dvMs / 1000).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Rocket equation &amp; transport</h2>
        <p className="text-slate-700">
          Tsiolkovsky with a single expendable stage whose dry mass is a fixed fraction (default
          10%) of its propellant; default specific impulse 450 s (LOX/LH₂). The &ldquo;gear
          ratio&rdquo; is the mass that must be placed in LEO per kilogram delivered. In-space
          transport is costed as propellant mass × an in-space propellant price; tug hardware
          amortisation, boil-off and staging are not modelled.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Composition (nominal wt%)</h2>
        <p className="text-slate-700">
          Lunar soils: Apollo/Luna sample averages (Lunar Sourcebook), converted from oxide to
          element wt%. Asteroids: meteorite analogues — ordinary chondrites (S), CI/CM carbonaceous
          chondrites (C), iron meteorites and metal–silicate mixtures (M). Titanium in high-Ti mare
          is carried mainly by ilmenite (FeTiO₃).
        </p>
        <TableWrap label="Composition models">
          <thead>
            <tr>
              <th className={th}>Source</th>
              {["Si", "Ti", "Fe", "Al", "Mg", "O", "H₂O"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
              <th className={th}>Ilmenite</th>
            </tr>
          </thead>
          <tbody>
            {SOURCE_TYPES.map((st) => {
              const m = COMPOSITION_MODELS[st];
              return (
                <tr key={st}>
                  <td className={td}>{m.label}</td>
                  {(["Si", "Ti", "Fe", "Al", "Mg", "O", "H2O"] as const).map((el) => (
                    <td
                      key={el}
                      className={td}
                      title={`range ${m.elements[el].low}–${m.elements[el].high}`}
                    >
                      {m.elements[el].nominal}
                      <span className="block text-xs text-slate-500">
                        {m.elements[el].low}–{m.elements[el].high}
                      </span>
                    </td>
                  ))}
                  <td className={td}>{m.ilmeniteWtPct.nominal}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Extraction processes</h2>
        <p className="text-slate-700">
          Yield = mass processed × wt% × recovery. Throughput = process power ÷ specific energy.
          Order-of-magnitude literature values:
        </p>
        <TableWrap label="Process models">
          <thead>
            <tr>
              <th className={th}>Process</th>
              <th className={th}>kWh per kg processed</th>
              <th className={th}>Plant kg per kW</th>
              <th className={th}>Operating °C</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(PROCESS_MODELS).map((p) => (
              <tr key={p.id}>
                <td className={td}>
                  <strong>{p.label}</strong>
                  <span className="block max-w-md text-xs whitespace-normal text-slate-600">
                    {p.summary}
                  </span>
                </td>
                <td className={td}>{p.specificEnergyKWhPerKg}</td>
                <td className={td}>{p.specificMassKgPerKw}</td>
                <td className={td}>
                  {p.operatingTempC.min} – {p.operatingTempC.max}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Economics &amp; pricing</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>
            Capex at t = 0: plant hardware ($/kg) plus launching the plant to LEO and pushing it to
            the site (gear ratio × $/kg to LEO).
          </li>
          <li>
            Opex: one configurable annual operations figure. Transport of product to the delivery
            node priced from propellant mass.
          </li>
          <li>
            NPV: annual end-of-period cash flows at a chosen discount rate; breakeven price makes
            NPV zero. Cost is allocated across co-products by mass.
          </li>
          <li>
            Not modelled: ramp-up, degradation, insurance, tax, financing structure, demand limits
            and price elasticity.
          </li>
          <li>
            Quotes: cost basis from a mission scenario + transport to the requested node + a
            configurable margin; prices are computed server-side only and are binding only once
            issued by our engineers, until the stated validity date.
          </li>
        </ul>
      </section>
    </div>
  );
}
