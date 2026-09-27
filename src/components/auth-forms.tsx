"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { safeNextPath } from "@/lib/safe-redirect";
import { TextField } from "./form";
import { Button, Notice } from "./ui";

function friendly(error: { status?: number; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return error.message || "Something went wrong. Please try again.";
}

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        const { error: err } = await authClient.signIn.email({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        });
        if (err) {
          setError(err.status === 401 ? "Incorrect email or password." : friendly(err));
          setPending(false);
          return;
        }
        router.push(safeNextPath(next));
        router.refresh();
      }}
    >
      {error && <Notice tone="bad">{error}</Notice>}
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        minLength={10}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        New customer?{" "}
        <Link
          className="font-medium text-blue-700 underline underline-offset-2"
          href={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ""}`}
        >
          Create a buyer account
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const password = String(form.get("password") ?? "");
        if (password !== String(form.get("confirm") ?? "")) {
          setError("Passwords do not match.");
          return;
        }
        setPending(true);
        setError(null);
        const { error: err } = await authClient.signUp.email({
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password,
          company: String(form.get("company") ?? "") || undefined,
        });
        if (err) {
          setError(friendly(err));
          setPending(false);
          return;
        }
        router.push(safeNextPath(next, "/portal"));
        router.refresh();
      }}
    >
      {error && <Notice tone="bad">{error}</Notice>}
      <TextField label="Full name" name="name" autoComplete="name" required maxLength={120} />
      <TextField
        label="Company"
        name="company"
        autoComplete="organization"
        maxLength={160}
        hint="Shown on quotes and invoices."
      />
      <TextField label="Work email" name="email" type="email" autoComplete="email" required />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      <TextField
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link className="font-medium text-blue-700 underline underline-offset-2" href="/sign-in">
          Sign in
        </Link>
      </p>
    </form>
  );
}
