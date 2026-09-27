import type { Metadata } from "next";
import { LinkButton, Notice, PageHeader } from "@/components/ui";
import { formatMass, formatMoney } from "@/lib/format";
import { NODE_LABELS } from "@/lib/models";
import { listCatalog } from "@/server/catalog";

export const metadata: Metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const catalog = await listCatalog("EML1");
  const materials = catalog.filter((c) => c.kind === "material");
  const products = catalog.filter((c) => c.kind === "product");
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <PageHeader
        title="Catalog"
        description={`Indicative, non-binding unit prices for delivery at ${NODE_LABELS.EML1}. Final prices depend on quantity, delivery node and date and are set when an engineer issues your quote.`}
        actions={<LinkButton href="/quote">Request a quote</LinkButton>}
      />
      <div className="space-y-10">
        <section aria-labelledby="materials">
          <h2 id="materials" className="mb-3 text-lg font-semibold">
            Materials (per kg)
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {materials.map((m) => (
              <li
                key={m.code}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h3 className="font-semibold">{m.name}</h3>
                <p className="mt-1 flex-1 text-sm text-slate-600">{m.description}</p>
                <p className="mt-3 text-sm">
                  <span className="text-slate-600">Indicative: </span>
                  <strong>
                    {m.indicativeUnitPriceCents === null
                      ? "on request"
                      : `${formatMoney(m.indicativeUnitPriceCents)}/kg`}
                  </strong>
                </p>
                <LinkButton
                  href={`/quote?item=${m.code}`}
                  variant="secondary"
                  className="mt-3 self-start"
                >
                  Quote {m.code}
                </LinkButton>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="products">
          <h2 id="products" className="mb-3 text-lg font-semibold">
            Fabricated products (per unit)
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <li
                key={p.code}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{p.description}</p>
                <p className="mt-2 flex-1 text-xs text-slate-500">
                  {formatMass(p.unitMassKg)} per unit · made from{" "}
                  {p.bom.map((b) => `${formatMass(b.qtyPerUnit)} ${b.itemCode}`).join(", ")}
                </p>
                <p className="mt-3 text-sm">
                  <span className="text-slate-600">Indicative: </span>
                  <strong>
                    {p.indicativeUnitPriceCents === null
                      ? "on request"
                      : `${formatMoney(p.indicativeUnitPriceCents)}/unit`}
                  </strong>
                </p>
                <LinkButton
                  href={`/quote?item=${p.code}`}
                  variant="secondary"
                  className="mt-3 self-start"
                >
                  Quote this product
                </LinkButton>
              </li>
            ))}
          </ul>
        </section>
        <Notice tone="warn">
          Prices are derived from first-order mission-economics models and published cost
          assumptions, not from operating history. See{" "}
          <a className="underline" href="/about">
            model assumptions
          </a>
          .
        </Notice>
      </div>
    </div>
  );
}
