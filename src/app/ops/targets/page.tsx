import type { Metadata } from "next";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge, Card, PageHeader, PlanningDisclaimer, TableWrap, td, th } from "@/components/ui";
import { formatDeltaV, formatNumber } from "@/lib/format";
import {
  COMPOSITION_MODELS,
  SOURCE_TYPES,
  estimateNeaDeltaV,
  nodeToNodeDeltaV,
} from "@/lib/models";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { requireRole } from "@/server/session";
import { listTargets } from "@/server/targets";
import { importSbdbAction, refreshTargetAction } from "./actions";

export const metadata: Metadata = { title: "Targets" };

export default async function TargetsPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/targets");
  const targets = await listTargets(actor);
  const canEdit = hasRole(actor, ["engineer", "admin"]);
  const lunarDv = nodeToNodeDeltaV("LEO", "LUNAR_SURFACE").deltaVMs;
  return (
    <>
      <PageHeader
        title="Target catalog"
        description="Lunar sites and near-Earth asteroids with composition models and first-order Δv from a 400 km LEO."
      />
      <div className="space-y-6">
        <PlanningDisclaimer compact />
        <Card title="Targets">
          <TableWrap label="Targets">
            <thead>
              <tr>
                <th className={th}>Target</th>
                <th className={th}>Composition model</th>
                <th className={th}>Orbit / location</th>
                <th className={th}>Δv from LEO</th>
                <th className={th}>Data</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => {
                let dv: number | null = null;
                if (t.kind === "lunar_site") dv = lunarDv;
                else if (t.aAu != null && t.e != null && t.iDeg != null)
                  dv = estimateNeaDeltaV({ aAu: t.aAu, e: t.e, iDeg: t.iDeg }).chosen
                    .totalFromLeoMs;
                return (
                  <tr key={t.id}>
                    <td className={td}>
                      <p className="font-medium">{t.name}</p>
                      <p className="max-w-sm text-xs whitespace-normal text-slate-600">
                        {t.description}
                      </p>
                    </td>
                    <td className={td}>
                      {COMPOSITION_MODELS[t.sourceType].label}
                      {t.spectralClass && (
                        <span className="block text-xs text-slate-500">
                          Spectral class {t.spectralClass}
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      {t.kind === "nea" ? (
                        <span>
                          a {formatNumber(t.aAu, 3)} AU · e {formatNumber(t.e, 3)} · i{" "}
                          {formatNumber(t.iDeg, 2)}°
                        </span>
                      ) : (
                        <span>
                          {formatNumber(Math.abs(t.latitudeDeg ?? 0), 1)}°
                          {(t.latitudeDeg ?? 0) >= 0 ? "N" : "S"},{" "}
                          {formatNumber(Math.abs(t.longitudeDeg ?? 0), 1)}°
                          {(t.longitudeDeg ?? 0) >= 0 ? "E" : "W"}
                        </span>
                      )}
                    </td>
                    <td className={td}>{formatDeltaV(dv)}</td>
                    <td className={td}>
                      {t.dataSource === "jpl_sbdb" ? (
                        <Badge tone="good">
                          JPL SBDB {t.refreshedAt ? t.refreshedAt.toISOString().slice(0, 10) : ""}
                        </Badge>
                      ) : t.kind === "nea" ? (
                        <Badge tone="warn">Approximate — refresh from JPL SBDB</Badge>
                      ) : (
                        <Badge>Nominal site model</Badge>
                      )}
                      {canEdit && t.kind === "nea" && t.designation && (
                        <ActionForm
                          action={refreshTargetAction.bind(null, t.designation)}
                          className="mt-2"
                        >
                          <SubmitButton
                            variant="secondary"
                            pendingLabel="Fetching…"
                            className="px-2 py-1 text-xs"
                          >
                            Refresh from SBDB
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
        {canEdit && (
          <Card
            title="Import from JPL SBDB"
            description="Fetches osculating elements, H, diameter and spectral class from ssd-api.jpl.nasa.gov."
          >
            <ActionForm
              action={importSbdbAction}
              className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <TextField
                label="Designation"
                name="designation"
                placeholder="e.g. 101955 or 2000 SG344"
                required
                maxLength={40}
              />
              <SelectField
                label="Composition model override"
                name="sourceType"
                placeholder="Map from spectral class"
                options={SOURCE_TYPES.filter((s) => s.startsWith("nea")).map((s) => ({
                  value: s,
                  label: COMPOSITION_MODELS[s].label,
                }))}
              />
              <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
