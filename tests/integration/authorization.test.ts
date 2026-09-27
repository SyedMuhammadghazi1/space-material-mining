import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as economicsPOST } from "@/app/api/v1/economics/route";
import { GET as orderGET } from "@/app/api/v1/orders/[id]/route";
import { POST as cronPOST } from "@/app/api/cron/[job]/route";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DEFAULT_SCENARIO_FORM } from "@/lib/scenario-input";
import type { Actor } from "@/server/authz";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/server/errors";
import { createFabricationJob, listFabricationJobs } from "@/server/fabrication";
import { recordAdjustment } from "@/server/inventory";
import {
  acceptQuote,
  getQuoteForActor,
  issueQuote,
  listQuoteQueue,
  listQuotesForCustomer,
  requestQuote,
} from "@/server/quotes";
import { getOrderForActor, listOrders, listOrdersForCustomer, reserveOrder } from "@/server/orders";
import { createRig, issueRigKey, listRigs } from "@/server/rigs";
import { createScenario, listScenarios } from "@/server/scenarios";
import { listUsers, setUserRole } from "@/server/users";
import { createActor, seedReference, signUpWithSession, type Reference } from "./helpers";

let ref: Reference;

beforeEach(async () => {
  ref = await seedReference();
});

async function orderFor(customer: Actor) {
  const engineer = await createActor("engineer");
  const q = await requestQuote(customer, { itemCode: "O2", quantity: 50, deliveryNode: "LLO" });
  await issueQuote(engineer, q.id, { marginPercent: 20 });
  return acceptQuote(customer, q.id);
}

describe("customer data isolation", () => {
  it("customer A can never see customer B's quotes or orders (service layer)", async () => {
    const a = await createActor("customer");
    const b = await createActor("customer");
    const orderB = await orderFor(b);
    await expect(getOrderForActor(a, orderB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getQuoteForActor(a, orderB.quoteId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listOrdersForCustomer(a)).toHaveLength(0);
    expect(await listQuotesForCustomer(a)).toHaveLength(0);
    await expect(acceptQuote(a, orderB.quoteId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getOrderForActor(b, orderB.id)).order.id).toBe(orderB.id);
    expect(await listOrdersForCustomer(b)).toHaveLength(1);
    await expect(getOrderForActor(a, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("customer A gets 404 for customer B's order over HTTP, B gets 200", async () => {
    const a = await signUpWithSession("customer");
    const b = await signUpWithSession("customer");
    const orderB = await orderFor(b.actor);
    const req = (cookie: string) =>
      new Request(`http://localhost:3002/api/v1/orders/${orderB.id}`, { headers: { cookie } });
    const params = { params: Promise.resolve({ id: orderB.id }) };
    expect((await orderGET(req(a.cookie), params)).status).toBe(404);
    const ok = await orderGET(req(b.cookie), params);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: orderB.id, status: "awaiting_deposit" });
    expect(
      (await orderGET(new Request(`http://localhost:3002/api/v1/orders/${orderB.id}`), params))
        .status,
    ).toBe(401);
  });
});

describe("role enforcement", () => {
  it("customers cannot reach engineer, operator or admin services", async () => {
    const customer = await createActor("customer");
    const checks: Promise<unknown>[] = [
      createScenario(customer, {
        ...DEFAULT_SCENARIO_FORM,
        name: "Nope",
        targetId: ref.targets["mare-tranquillitatis"],
        processId: "mre",
      }),
      listScenarios(customer),
      listQuoteQueue(customer),
      issueQuote(customer, "00000000-0000-0000-0000-000000000000", { marginPercent: 0 }),
      createRig(customer, {
        missionId: ref.missionId,
        name: "Rogue",
        processId: "mre",
        ratedPowerKw: 10,
      }),
      listRigs(customer),
      recordAdjustment(customer, {
        depotId: ref.depots.LSP,
        itemCode: "O2",
        delta: 1e6,
        reason: "Free oxygen",
      }),
      createFabricationJob(customer, {
        productCode: "LOX-100",
        depotId: ref.depots["EML1-GW"],
        quantity: 1,
      }),
      listFabricationJobs(customer),
      listOrders(customer),
      reserveOrder(customer, "00000000-0000-0000-0000-000000000000", { depotId: ref.depots.LSP }),
      listUsers(customer),
      setUserRole(customer, { userId: customer.id, role: "admin" }),
    ];
    for (const p of checks) await expect(p).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("separates engineer and operator duties", async () => {
    const engineer = await createActor("engineer");
    const operator = await createActor("operator");
    await expect(
      createRig(engineer, {
        missionId: ref.missionId,
        name: "Eng rig",
        processId: "mre",
        ratedPowerKw: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createScenario(operator, {
        ...DEFAULT_SCENARIO_FORM,
        name: "Ops plan",
        targetId: ref.targets["mare-tranquillitatis"],
        processId: "mre",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const rig = await createRig(operator, {
      missionId: ref.missionId,
      name: "Ops rig",
      processId: "mre",
      ratedPowerKw: 10,
    });
    await expect(issueRigKey(engineer, rig.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requestQuote(engineer, { itemCode: "O2", quantity: 1, deliveryNode: "LEO" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only admins change roles, and never their own", async () => {
    const admin = await createActor("admin");
    const target = await createActor("customer");
    await setUserRole(admin, { userId: target.id, role: "engineer" });
    const [row] = await db.select().from(user).where(eq(user.id, target.id));
    expect(row!.role).toBe("engineer");
    await expect(setUserRole(admin, { userId: admin.id, role: "customer" })).rejects.toThrow(
      /own role/,
    );
  });

  it("does not let sign-up self-assign a role", async () => {
    const res = await auth.api
      .signUpEmail({
        body: {
          email: "sneaky@example.test",
          password: "correct-horse-battery",
          name: "Sneaky",
          role: "admin",
        } as never,
      })
      .catch((e: unknown) => e);
    const [row] = await db.select().from(user).where(eq(user.email, "sneaky@example.test"));
    if (row) expect(row.role).toBe("customer");
    else expect(res).toBeInstanceOf(Error);
  });

  it("enforces the minimum password length", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: "short@example.test", password: "short", name: "Short" },
      }),
    ).rejects.toThrow();
  });

  it("guards the economics API by session role", async () => {
    const customer = await signUpWithSession("customer");
    const engineer = await signUpWithSession("engineer");
    const body = JSON.stringify({
      ...DEFAULT_SCENARIO_FORM,
      targetId: ref.targets["mare-tranquillitatis"],
      processId: "mre",
    });
    const call = (cookie?: string) =>
      economicsPOST(
        new Request("http://localhost:3002/api/v1/economics", {
          method: "POST",
          headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
          body,
        }),
      );
    expect((await call()).status).toBe(401);
    expect((await call(customer.cookie)).status).toBe(403);
    const ok = await call(engineer.cookie);
    expect(ok.status).toBe(200);
    const result = await ok.json();
    expect(result.deltaV.outboundFromLeoMs).toBe(5910);
    expect(result.unitEconomics.costPerDeliveredKgCents).toBeGreaterThan(0);
    const bad = await economicsPOST(
      new Request("http://localhost:3002/api/v1/economics", {
        method: "POST",
        headers: { cookie: engineer.cookie },
        body: JSON.stringify({ powerKw: -1 }),
      }),
    );
    expect(bad.status).toBe(422);
  });

  it("protects cron endpoints with the shared secret", async () => {
    const params = { params: Promise.resolve({ job: "rig-health" }) };
    expect(
      (
        await cronPOST(
          new Request("http://localhost/api/cron/rig-health", { method: "POST" }),
          params,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await cronPOST(
          new Request("http://localhost/api/cron/rig-health", {
            method: "POST",
            headers: { authorization: "Bearer wrong-secret-wrong-secret" },
          }),
          params,
        )
      ).status,
    ).toBe(401);
    const ok = await cronPOST(
      new Request("http://localhost/api/cron/rig-health", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret-0123456789" },
      }),
      params,
    );
    expect(ok.status).toBe(200);
    const unknown = await cronPOST(
      new Request("http://localhost/api/cron/nope", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret-0123456789" },
      }),
      { params: Promise.resolve({ job: "nope" }) },
    );
    expect(unknown.status).toBe(404);
  });

  it("treats unauthenticated service calls as 401", async () => {
    await expect(listRigs(null as unknown as Actor)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
