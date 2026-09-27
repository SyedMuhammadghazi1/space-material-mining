import type { ScenarioResult } from "@/lib/models";
import { NODE_LABELS, type OrbitalNode } from "@/lib/models";
import { formatDeltaV, formatMass, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { Card, DefinitionList, Notice, Stat, TableWrap, td, th } from "./ui";

/** Presentational view of a scenario result (used by saved snapshots and the live explorer). */
export function ScenarioResults({
  result,
  deliveryNode,
}: {
  result: ScenarioResult;
  deliveryNode: OrbitalNode;
}) {
  const ue = result.unitEconomics;
  const nea = result.deltaV.nea;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat
          label={`Cost per kg delivered to ${NODE_LABELS[deliveryNode]}`}
          value={formatMoney(ue.costPerDeliveredKgCents)}
          hint={
            ue.costRatioVsEarth === null
              ? undefined
              : `${formatPercent(ue.costRatioVsEarth, 0)} of Earth-launched`
          }
        />
        <Stat
          label="Earth-launched equivalent"
          value={formatMoney(ue.earthLaunchCostPerKgAtNodeCents)}
          hint={`${formatNumber(ue.earthGearRatio, 2)} kg in LEO per kg delivered`}
        />
        <Stat
          label="NPV"
          value={formatMoney(result.finance.npvCents, { compact: true })}
          hint={`at ${result.finance.discountRatePercent}% over ${formatNumber(result.finance.years, 1)} years`}
        />
        <Stat
          label="Breakeven sale price"
          value={
            ue.costPerDeliveredKgCents === null
              ? "—"
              : `${formatMoney(result.finance.breakevenPricePerKgCents)}/kg`
          }
          hint={`vs. ${formatMoney(result.finance.salePricePerKgCents)}/kg assumed`}
        />
      </div>

      {result.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Δv budget">
          <DefinitionList
            items={[
              ["LEO → site (plant delivery)", formatDeltaV(result.deltaV.outboundFromLeoMs)],
              [
                `Site → ${NODE_LABELS[deliveryNode]} (product)`,
                formatDeltaV(result.deltaV.returnToNodeMs),
              ],
              [
                "Plant gear ratio",
                `${formatNumber(result.transport.plantGearRatio, 2)} kg in LEO per kg landed`,
              ],
              [
                "Propellant per kg product",
                `${formatNumber(result.transport.propellantKgPerKgProduct, 3)} kg`,
              ],
              ["Transport cost per kg", formatMoney(result.transport.transportCostPerKgCents)],
              ...(nea
                ? ([
                    [
                      "NEA transfer",
                      `Hohmann-type to ${nea.chosen.apsis} (${nea.chosen.apsisRadiusAu} AU)`,
                    ],
                    [
                      "Departure v∞ / LEO burn",
                      `${formatDeltaV(nea.chosen.departureVInfMs)} / ${formatDeltaV(nea.chosen.departureFromLeoMs)}`,
                    ],
                    [
                      "Arrival rendezvous (incl. plane change)",
                      formatDeltaV(nea.chosen.arrivalRendezvousMs),
                    ],
                    [
                      "Transfer time",
                      `${formatNumber(nea.chosen.timeOfFlightDays, 0)} days one way`,
                    ],
                  ] as [string, string][])
                : []),
            ]}
          />
          <ul className="mt-3 list-disc pl-5 text-xs text-slate-500">
            {result.deltaV.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Card>
        <Card title="Plant & production">
          <DefinitionList
            items={[
              ["Plant mass (incl. power system)", formatMass(result.plant.massKg)],
              ["Mass to place in LEO", formatMass(result.plant.leoMassKg)],
              [
                "Throughput",
                `${formatNumber(result.plant.throughputKgPerHour, 1)} kg/h at ${formatNumber(result.plant.powerKw, 0)} kW`,
              ],
              ["Operating hours", formatNumber(result.production.operatingHours, 0)],
              ["Feedstock processed", formatMass(result.production.regolithProcessedKg)],
              [
                "Delivered product",
                `${formatMass(result.production.deliveredKg)} (${formatMass(result.production.deliveredKgPerYear)}/yr)`,
              ],
            ]}
          />
        </Card>
      </div>

      <Card title="Yield by element" description="yield = mass processed × nominal wt% × recovery">
        <TableWrap label="Yields">
          <thead>
            <tr>
              <th className={th}>Element</th>
              <th className={`${th} text-right`}>wt%</th>
              <th className={`${th} text-right`}>Recovery</th>
              <th className={`${th} text-right`}>Yield</th>
              <th className={th}>Product form</th>
              <th className={th}>Shipped</th>
            </tr>
          </thead>
          <tbody>
            {result.production.yields.map((y) => (
              <tr key={y.element}>
                <td className={td}>{y.element === "O" ? "O₂" : y.element}</td>
                <td className={`${td} text-right`}>{formatNumber(y.wtPct, 2)}</td>
                <td className={`${td} text-right`}>{formatPercent(y.recovery)}</td>
                <td className={`${td} text-right`}>{formatMass(y.kg)}</td>
                <td className={`${td} max-w-xs whitespace-normal`}>{y.form}</td>
                <td className={td}>{y.delivered ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Costs">
        <TableWrap label="Cost breakdown">
          <tbody>
            {(
              [
                ["Plant hardware", result.costs.hardwareCents],
                ["Launch & transfer of plant", result.costs.launchCents],
                ["Capex (t = 0)", result.costs.capexCents],
                ["Operations", result.costs.opsCents],
                ["Product transport", result.costs.transportCents],
                ["Total mission cost", result.costs.totalCents],
                ["Revenue at assumed price", result.finance.revenueCents],
              ] as [string, number][]
            ).map(([k, v]) => (
              <tr key={k}>
                <td className={td}>{k}</td>
                <td className={`${td} text-right font-medium`}>{formatMoney(v)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
      <p className="text-xs text-slate-500">
        Planning model v{result.modelVersion}. First-order estimates — not flight-grade analysis;
        composition values are nominal and must be replaced by survey data.
      </p>
    </div>
  );
}
