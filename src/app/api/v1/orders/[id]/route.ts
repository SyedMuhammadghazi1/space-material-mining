import { errorResponse } from "@/server/errors";
import { getOrderForActor } from "@/server/orders";
import { getApiActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Order status. Customers can only read their own orders (others return 404). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getApiActor(req);
    const { id } = await ctx.params;
    const { order, itemName } = await getOrderForActor(actor, id);
    return Response.json({
      id: order.id,
      reference: order.reference,
      status: order.status,
      itemCode: order.itemCode,
      itemName,
      quantity: order.quantity,
      deliveryNode: order.deliveryNode,
      totalCents: order.totalCents,
      depositCents: order.depositCents,
      createdAt: order.createdAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
