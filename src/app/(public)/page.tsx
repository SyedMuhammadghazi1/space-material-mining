import { LinkButton, PlanningDisclaimer, TableWrap, td, th } from "@/components/ui";
import { getEnv } from "@/env";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";
import { formatMoney, formatNumber } from "@/lib/format";
import {
  DEFAULT_ECONOMICS_PARAMS,
  NODE_LABELS,
  ORBITAL_NODES,
  evaluateScenario,
  leoMassPerDeliveredKg,
  nodeToNodeDeltaV,
} from "@/lib/models";

export const dynamic = "force-dynamic";

function valueProposition() {
  const launch = getEnv().LAUNCH_COST_PER_KG_CENTS;
  const params = { ...DEFAULT_ECONOMICS_PARAMS, launchCostPerKgCents: launch };
  return ORBITAL_NODES.map((node) => {
    const dv = nodeToNodeDeltaV("LEO", node).deltaVMs;
    const gear = leoMassPerDeliveredKg(dv, params.ispSeconds, params.tankageFraction);
    const lunar = evaluateScenario(
      { kind: "lunar_site", sourceType: "lunar_mare_high_ti" },
      "mre",
      { ...params, deliveryNode: node },
    );
    return {
      node,
      earthCents: Math.round(launch * gear),
      gear,
      lunarCents: lunar.unitEconomics.costPerDeliveredKgCents,
    };
  });
}

const materials = [
  {
    name: "Oxygen",
    detail: "≈40–45% of regolith by mass. Oxidiser for propellant and breathable O₂ for habitats.",
  },
  {
    name: "Silicon",
    detail: "Feedstock for in-orbit solar cells and glass; recovered in MRE cathode alloy.",
  },
  {
    name: "Titanium",
    detail: "From ilmenite-rich high-Ti mare regolith; truss and pressure-vessel alloys.",
  },
  {
    name: "Iron",
    detail: "From mare regolith and metal-rich asteroids; beams, rails and shielding.",
  },
  {
    name: "Water",
    detail:
      "Bound in carbonaceous (C-type) asteroids; propellant, radiation shielding, life support.",
  },
];

const products = [
  "Solar-grade silicon feedstock",
  "Titanium truss segments (2 m)",
  "Iron structural beams (3 m)",
  "Sintered-regolith radiation-shielding tiles",
  "Liquid-oxygen propellant",
];

export default function LandingPage() {
  const rows = valueProposition();
  return (
    <>
      <section className="bg-space-900 text-slate-100">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[3fr_2fr] md:py-24">
          <div>
            <p className="text-sm font-semibold tracking-wide text-amber-400 uppercase">
              In-space resource utilisation
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {APP_TAGLINE}
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-300">
              {APP_NAME} extracts basic materials — oxygen, silicon, titanium, iron and water — from
              lunar regolith and near-Earth asteroids, and turns them into structures, propellant
              and feedstock where they are needed: already in orbit.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/quote">Request a quote</LinkButton>
              <LinkButton href="/catalog" variant="secondary">
                Browse the catalog
              </LinkButton>
            </div>
          </div>
          <div className="border-space-700 bg-space-800/60 rounded-xl border p-6 text-sm text-slate-300">
            <h2 className="text-base font-semibold text-white">
              The platform behind the operation
            </h2>
            <ul className="mt-3 space-y-2">
              <li>• Prospecting & mission economics for lunar sites and near-Earth asteroids</li>
              <li>• Extraction-rig telemetry, alerts and production accounting</li>
              <li>• An append-only material ledger across space depots</li>
              <li>• In-space fabrication with bills of materials</li>
              <li>• A B2B portal for quotes, orders and reservation deposits</li>
            </ul>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-14">
        <section aria-labelledby="what">
          <h2 id="what" className="text-2xl font-semibold tracking-tight">
            What we extract
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {materials.map((m) => (
              <li
                key={m.name}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h3 className="font-semibold">{m.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{m.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="where" className="grid gap-8 md:grid-cols-2">
          <div>
            <h2 id="where" className="text-2xl font-semibold tracking-tight">
              Where
            </h2>
            <p className="mt-3 text-slate-700">
              <strong>The Moon:</strong> high-titanium mare (e.g. Mare Tranquillitatis) for
              ilmenite, oxygen and titanium; low-Ti mare and feldspathic highlands for oxygen,
              silicon and aluminium; and illuminated south-polar crater rims for near-continuous
              solar power.
            </p>
            <p className="mt-3 text-slate-700">
              <strong>Near-Earth asteroids:</strong> carbonaceous C-types (such as Ryugu and Bennu)
              for water, stony S-types for silicates and metal grains, and metal-rich M-types for
              iron–nickel. Some are cheaper to reach in Δv than the lunar surface — but launch
              windows are rare and trips are long.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">What we build in space</h2>
            <ul className="mt-3 space-y-2 text-slate-700">
              {products.map((p) => (
                <li key={p} className="flex gap-2">
                  <span aria-hidden="true" className="text-amber-600">
                    ◆
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="why" className="space-y-4">
          <h2 id="why" className="text-2xl font-semibold tracking-tight">
            Why make it in space?
          </h2>
          <p className="max-w-3xl text-slate-700">
            Every kilogram launched from Earth must first reach low Earth orbit and then be pushed
            further with more propellant — which also had to be launched. The rocket equation turns
            that into a &ldquo;gear ratio&rdquo;. Material that is already in space skips the
            deepest part of the gravity well. The table compares the modelled cost per kilogram
            delivered to each node for Earth-launched mass versus a reference lunar MRE plant
            (default assumptions: {formatMoney(getEnv().LAUNCH_COST_PER_KG_CENTS)}/kg to LEO,
            LOX/LH₂ stages at 450 s, fully propulsive transfers).
          </p>
          <TableWrap label="Cost per kilogram by delivery node">
            <thead>
              <tr>
                <th className={th}>Delivery node</th>
                <th className={th}>Gear ratio (kg in LEO per kg delivered)</th>
                <th className={th}>Launched from Earth</th>
                <th className={th}>Made on the Moon (reference plant)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.node}>
                  <td className={td}>{NODE_LABELS[r.node]}</td>
                  <td className={td}>{formatNumber(r.gear, 2)}×</td>
                  <td className={td}>{formatMoney(r.earthCents)}/kg</td>
                  <td className={td}>
                    {formatMoney(r.lunarCents)}/kg{" "}
                    {r.lunarCents !== null && r.lunarCents > r.earthCents && (
                      <span className="text-xs text-slate-500">(Earth is cheaper here)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="max-w-3xl text-sm text-slate-600">
            Read this honestly: lunar material wins on the Moon, in lunar orbit and at EML1, but
            shipping it all the way down to LEO propulsively can cost more than launching from
            Earth. That is why our depots sit high in the gravity well.
          </p>
          <PlanningDisclaimer />
        </section>
      </div>
    </>
  );
}
