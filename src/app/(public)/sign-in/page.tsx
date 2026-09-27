import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth-forms";
import { safeNextPath } from "@/lib/safe-redirect";
import { getActor } from "@/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await getActor()) redirect(safeNextPath(next));
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        Customers, engineers and operations staff all sign in here.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <SignInForm next={next} />
      </div>
    </div>
  );
}
