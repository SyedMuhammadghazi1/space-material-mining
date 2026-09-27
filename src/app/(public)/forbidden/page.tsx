import type { Metadata } from "next";
import { LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Not authorised" };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="text-sm font-semibold text-red-700">403</p>
      <h1 className="mt-2 text-2xl font-semibold">You don&apos;t have access to that page</h1>
      <p className="mt-2 text-slate-600">
        Your account&apos;s role does not include this area. Ask an administrator if you think this
        is a mistake.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <LinkButton href="/dashboard">Go to my dashboard</LinkButton>
        <LinkButton href="/" variant="secondary">
          Home
        </LinkButton>
      </div>
    </div>
  );
}
