"use client";

import { useEffect, useRef, useState } from "react";
import type { OrbitalNode, ScenarioResult } from "@/lib/models";
import { type Option, ScenarioFields, type ScenarioFormValues } from "./scenario-fields";
import { ScenarioResults } from "./scenario-results";
import { Notice } from "./ui";

interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string[]> };
}

/** Interactive explorer: every change is validated and computed server-side (POST /api/v1/economics). */
export function EconomicsExplorer({
  targets,
  initial,
}: {
  targets: Option[];
  initial: ScenarioFormValues;
}) {
  const [values, setValues] = useState<ScenarioFormValues>(initial);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<ApiError["error"] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const current = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/v1/economics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        });
        const body = await res.json();
        if (current !== seq.current) return;
        if (!res.ok) {
          setError((body as ApiError).error);
        } else {
          setError(null);
          setResult(body as ScenarioResult);
        }
      } catch {
        if (current === seq.current)
          setError({ code: "network", message: "Could not reach the server." });
      } finally {
        if (current === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [values]);

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section
        aria-label="Inputs"
        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      >
        <ScenarioFields
          targets={targets}
          values={values}
          onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
          errors={error?.fields}
        />
      </section>
      <section aria-label="Results" aria-busy={loading} className="min-w-0 space-y-3">
        <p className="text-sm text-slate-600" aria-live="polite">
          {loading ? "Computing…" : error ? "" : "Results update as you type."}
        </p>
        {error && <Notice tone="bad">{error.message}</Notice>}
        {result && (
          <div className={loading || error ? "opacity-60" : undefined}>
            <ScenarioResults
              result={result}
              deliveryNode={String(values.deliveryNode) as OrbitalNode}
            />
          </div>
        )}
      </section>
    </div>
  );
}
