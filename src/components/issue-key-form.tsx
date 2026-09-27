"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton, TextField, type FormState } from "./form";

type KeyState = FormState & { data?: { plaintext: string } };

export function IssueKeyForm({
  action,
}: {
  action: (state: KeyState, form: FormData) => Promise<KeyState>;
}) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <TextField
          label="Key label (optional)"
          name="label"
          maxLength={80}
          placeholder="e.g. flight computer A"
          className="min-w-56 flex-1"
        />
        <SubmitButton pendingLabel="Issuing…">Issue new key</SubmitButton>
      </form>
      <FormMessage state={state} />
      {state.status === "success" && state.data?.plaintext && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <label htmlFor="new-key" className="text-sm font-medium text-amber-950">
            New API key (shown once)
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="new-key"
              readOnly
              value={state.data.plaintext}
              className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 py-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="rounded-md border border-amber-400 bg-white px-3 py-1 text-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(state.data!.plaintext);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-900">
            Configure the rig with <code>Authorization: Bearer &lt;key&gt;</code> for{" "}
            <code>POST /api/v1/telemetry</code>. Only a SHA-256 hash is stored.
          </p>
        </div>
      )}
    </div>
  );
}
