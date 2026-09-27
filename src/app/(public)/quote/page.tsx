import type { Metadata } from "next";
import { Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { isStaff } from "@/server/authz";
import { listItems } from "@/server/inventory";
import { getActor } from "@/server/session";
import { QuoteForm } from "./quote-form";

export const metadata: Metadata = { title: "Request a quote" };

export default async function QuotePage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const { item } = await searchParams;
  const actor = await getActor();
  const items = actor && !isStaff(actor) ? await listItems({ publicOnly: true }) : [];
  const next = `/quote${item ? `?item=${encodeURIComponent(item)}` : ""}`;
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <PageHeader
        title="Request a quote"
        description="Tell us what you need, where and when. An engineer prices it from our current mission economics and transport costs, then issues a binding quote with a validity date."
      />
      {!actor ? (
        <Card>
          <p className="text-sm text-slate-700">
            Quotes are tied to a buyer account so that only you can see your pricing and orders.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <LinkButton href={`/sign-up?next=${encodeURIComponent(next)}`}>
              Create a buyer account
            </LinkButton>
            <LinkButton href={`/sign-in?next=${encodeURIComponent(next)}`} variant="secondary">
              Sign in
            </LinkButton>
          </div>
        </Card>
      ) : isStaff(actor) ? (
        <Notice tone="info">
          Staff accounts cannot request quotes. Review incoming requests in the quote queue instead.
        </Notice>
      ) : (
        <Card>
          <QuoteForm
            items={items.map((i) => ({ code: i.code, name: i.name, unit: i.unit }))}
            defaultItem={item}
          />
        </Card>
      )}
    </div>
  );
}
