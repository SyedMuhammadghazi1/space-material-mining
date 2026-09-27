"use client";

import { useActionState, useState } from "react";
import { FormMessage, SelectField, SubmitButton, TextArea, TextField } from "@/components/form";
import type { ActionState } from "@/server/actions";
import { requestQuoteAction } from "./actions";

interface ItemOption {
  code: string;
  name: string;
  unit: "kg" | "unit";
}

const NODES = [
  { value: "LEO", label: "Low Earth orbit (400 km)" },
  { value: "GEO", label: "Geostationary orbit" },
  { value: "EML1", label: "Earth–Moon L1" },
  { value: "LLO", label: "Low lunar orbit" },
  { value: "LUNAR_SURFACE", label: "Lunar surface" },
];

export function QuoteForm({ items, defaultItem }: { items: ItemOption[]; defaultItem?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(requestQuoteAction, {
    status: "idle",
  });
  const [itemCode, setItemCode] = useState(
    defaultItem && items.some((i) => i.code === defaultItem) ? defaultItem : "",
  );
  const unit = items.find((i) => i.code === itemCode)?.unit;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <SelectField
        label="Product or material"
        name="itemCode"
        required
        value={itemCode}
        onChange={(e) => setItemCode(e.target.value)}
        placeholder="Choose…"
        options={items.map((i) => ({
          value: i.code,
          label: `${i.name} (${i.unit === "kg" ? "per kg" : "per unit"})`,
        }))}
        errors={errors.itemCode}
      />
      <TextField
        label={unit === "unit" ? "Quantity (units)" : "Quantity (kg)"}
        name="quantity"
        type="number"
        inputMode="decimal"
        min={unit === "unit" ? 1 : 0.001}
        step={unit === "unit" ? 1 : "any"}
        required
        errors={errors.quantity}
      />
      <SelectField
        label="Delivery node"
        name="deliveryNode"
        required
        defaultValue="EML1"
        options={NODES}
        errors={errors.deliveryNode}
      />
      <TextField
        label="Target delivery date (optional)"
        name="targetDate"
        type="date"
        errors={errors.targetDate}
        hint="We will tell you if the date is earlier than we can deliver."
      />
      <TextArea
        label="Notes (optional)"
        name="notes"
        maxLength={2000}
        errors={errors.notes}
        hint="Purity, packaging, interface or schedule requirements."
      />
      <SubmitButton pendingLabel="Submitting…">Submit request for quote</SubmitButton>
    </form>
  );
}
