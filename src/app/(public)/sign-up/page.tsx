import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth-forms";
import { getActor } from "@/server/session";

export const metadata: Metadata = { title: "Create a buyer account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await getActor()) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create a buyer account</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        For organisations buying in-space materials and components. Staff accounts are created by an
        administrator.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <SignUpForm next={next} />
      </div>
    </div>
  );
}
