"use client";

import { SelectField, TextField } from "./form";

export interface Option {
  value: string;
  label: string;
}

export type ScenarioFormValues = Record<string, string | string[]>;

const PROCESS_OPTIONS: Option[] = [
  { value: "mre", label: "Molten Regolith Electrolysis" },
  { value: "h2_ilmenite", label: "Hydrogen reduction of ilmenite" },
  { value: "magnetic_separation", label: "Magnetic / metal separation" },
  { value: "volatiles", label: "Volatiles extraction (C-types)" },
];

const NODE_OPTIONS: Option[] = [
  { value: "LUNAR_SURFACE", label: "Lunar surface" },
  { value: "LLO", label: "Low lunar orbit" },
  { value: "EML1", label: "Earth–Moon L1" },
  { value: "GEO", label: "Geostationary orbit" },
  { value: "LEO", label: "Low Earth orbit" },
];

const ELEMENT_OPTIONS = [
  { value: "O", label: "O₂" },
  { value: "Si", label: "Si" },
  { value: "Ti", label: "Ti" },
  { value: "Fe", label: "Fe" },
  { value: "H2O", label: "H₂O" },
];

interface Props {
  targets: Option[];
  values: ScenarioFormValues;
  onChange?: (name: string, value: string | string[]) => void;
  errors?: Record<string, string[]>;
}

/** Scenario inputs, shared by the "new scenario" form (uncontrolled) and the explorer (controlled). */
export function ScenarioFields({ targets, values, onChange, errors = {} }: Props) {
  const bind = (name: string) =>
    onChange
      ? {
          value: String(values[name] ?? ""),
          onChange: (e: { target: { value: string } }) => onChange(name, e.target.value),
        }
      : { defaultValue: String(values[name] ?? "") };
  const num = (name: string, label: string, hint?: string, step: string = "any") => (
    <TextField
      label={label}
      name={name}
      type="number"
      inputMode="decimal"
      step={step}
      required
      hint={hint}
      errors={errors[name]}
      {...bind(name)}
    />
  );
  const selected = new Set(Array.isArray(values.productElements) ? values.productElements : []);
  return (
    <div className="space-y-6">
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Target & process</legend>
        <SelectField
          label="Target"
          name="targetId"
          required
          options={targets}
          errors={errors.targetId}
          {...bind("targetId")}
        />
        <SelectField
          label="Extraction process"
          name="processId"
          required
          options={PROCESS_OPTIONS}
          errors={errors.processId}
          {...bind("processId")}
        />
        <SelectField
          label="Delivery node"
          name="deliveryNode"
          required
          options={NODE_OPTIONS}
          errors={errors.deliveryNode}
          {...bind("deliveryNode")}
        />
      </fieldset>
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Plant & operations</legend>
        {num("powerKw", "Process power (kW)")}
        {num("uptimePercent", "Uptime (%)", "Fraction of mission time the plant runs.")}
        {num("missionDurationDays", "Mission duration (days)", undefined, "1")}
        {num("powerSystemKgPerKw", "Power system (kg per kW)", "Arrays, storage, radiators.")}
        <div className="md:col-span-2">
          <p className="text-sm font-medium text-slate-800" id="products-label">
            Products to ship &amp; sell
          </p>
          <div role="group" aria-labelledby="products-label" className="mt-2 flex flex-wrap gap-4">
            {ELEMENT_OPTIONS.map((el) => (
              <label key={el.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="productElements"
                  value={el.value}
                  className="h-4 w-4 rounded border-slate-300"
                  {...(onChange
                    ? {
                        checked: selected.has(el.value),
                        onChange: (e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(el.value);
                          else next.delete(el.value);
                          onChange("productElements", [...next]);
                        },
                      }
                    : { defaultChecked: selected.has(el.value) })}
                />
                {el.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Leave all unticked to ship everything the process recovers.
          </p>
        </div>
      </fieldset>
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Transport</legend>
        {num("ispSeconds", "Stage specific impulse (s)", "450 s ≈ LOX/LH₂; 360 s ≈ LOX/CH₄.")}
        {num("tankageFraction", "Tankage fraction", "Stage dry mass ÷ propellant mass.")}
        {num("inSpacePropellantCostPerKgUsd", "In-space propellant ($/kg)")}
      </fieldset>
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Costs & finance (USD)</legend>
        {num("launchCostPerKgUsd", "Launch to LEO ($/kg)")}
        {num("plantHardwareCostPerKgUsd", "Plant hardware ($/kg)")}
        {num("opsCostPerYearUsd", "Operations ($/year)")}
        {num("salePricePerKgUsd", "Sale price at node ($/kg)")}
        {num("discountRatePercent", "Discount rate (%/year)")}
      </fieldset>
    </div>
  );
}
