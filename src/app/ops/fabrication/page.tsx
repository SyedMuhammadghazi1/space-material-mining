import type { Metadata } from "next";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form";
import { Card, EmptyState, PageHeader, StatusBadge, TableWrap, td, th } from "@/components/ui";
import { formatDateTime, formatMass, formatMoney } from "@/lib/format";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { listFabricationJobs, listProductCatalog } from "@/server/fabrication";
import { listDepots } from "@/server/inventory";
import { requireRole } from "@/server/session";
import {
  cancelJobAction,
  completeJobAction,
  createJobAction,
  failJobAction,
  startJobAction,
} from "./actions";

export const metadata: Metadata = { title: "Fabrication" };

export default async function FabricationPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/fabrication");
  const canManage = hasRole(actor, ["operator", "admin"]);
  const [catalog, jobs, depotList] = await Promise.all([
    listProductCatalog(),
    listFabricationJobs(actor),
    listDepots(),
  ]);
  return (
    <>
      <PageHeader
        title="In-space fabrication"
        description="Starting a job atomically consumes its bill of materials at the depot; completing it adds finished goods. Failed jobs scrap their inputs."
      />
      <div className="space-y-6">
        <Card title="Product catalog & bills of materials">
          <TableWrap label="Products">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Bill of materials (per unit)</th>
                <th className={`${th} text-right`}>Energy</th>
                <th className={`${th} text-right`}>Ops cost</th>
                <th className={th}>Default depot</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((p) => (
                <tr key={p.code}>
                  <td className={td}>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-slate-500">
                      {p.code} · {formatMass(p.unitMassKg)} · {p.lead} d lead
                    </span>
                  </td>
                  <td className={td}>
                    {p.bom.map((b) => `${formatMass(b.qtyPerUnit)} ${b.inputCode}`).join(", ")}
                  </td>
                  <td className={`${td} text-right`}>{p.energy} kWh</td>
                  <td className={`${td} text-right`}>{formatMoney(p.ops)}</td>
                  <td className={td}>{p.depotName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        {canManage && (
          <Card title="Queue a job">
            <ActionForm action={createJobAction} className="grid gap-4 md:grid-cols-4 md:items-end">
              <SelectField
                label="Product"
                name="productCode"
                required
                placeholder="Choose…"
                options={catalog.map((p) => ({ value: p.code, label: p.name }))}
              />
              <SelectField
                label="Depot"
                name="depotId"
                required
                placeholder="Choose…"
                options={depotList.map((d) => ({ value: d.id, label: d.name }))}
              />
              <TextField
                label="Quantity (units)"
                name="quantity"
                type="number"
                min={1}
                step={1}
                required
              />
              <SubmitButton>Queue job</SubmitButton>
            </ActionForm>
          </Card>
        )}
        <Card title="Jobs">
          {jobs.length === 0 ? (
            <EmptyState>No fabrication jobs yet.</EmptyState>
          ) : (
            <TableWrap label="Fabrication jobs">
              <thead>
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>Depot</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={th}>Status</th>
                  <th className={th}>Timeline</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className={td}>{j.productName}</td>
                    <td className={td}>{j.depotName}</td>
                    <td className={`${td} text-right`}>{j.quantity}</td>
                    <td className={td}>
                      <StatusBadge status={j.status} />
                      {j.failureReason && (
                        <span className="block max-w-48 text-xs whitespace-normal text-red-800">
                          {j.failureReason}
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-xs text-slate-600`}>
                      Queued {formatDateTime(j.createdAt)}
                      {j.startedAt && (
                        <span className="block">Started {formatDateTime(j.startedAt)}</span>
                      )}
                      {j.finishedAt && (
                        <span className="block">Finished {formatDateTime(j.finishedAt)}</span>
                      )}
                    </td>
                    <td className={td}>
                      {canManage && j.status === "queued" && (
                        <div className="flex flex-wrap gap-2">
                          <ActionForm action={startJobAction.bind(null, j.id)}>
                            <SubmitButton className="px-2 py-1 text-xs">Start</SubmitButton>
                          </ActionForm>
                          <ActionForm action={cancelJobAction.bind(null, j.id)}>
                            <SubmitButton variant="secondary" className="px-2 py-1 text-xs">
                              Cancel
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                      {canManage && j.status === "in_progress" && (
                        <div className="flex flex-wrap items-end gap-2">
                          <ActionForm action={completeJobAction.bind(null, j.id)}>
                            <SubmitButton className="px-2 py-1 text-xs">Complete</SubmitButton>
                          </ActionForm>
                          <ActionForm
                            action={failJobAction.bind(null, j.id)}
                            className="flex items-end gap-2"
                          >
                            <TextField
                              label="Failure reason"
                              name="reason"
                              id={`reason-${j.id}`}
                              required
                              minLength={3}
                              className="w-40"
                            />
                            <SubmitButton variant="danger" className="px-2 py-1 text-xs">
                              Fail
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
