import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { isStaff } from "@/server/authz";
import { getActor } from "@/server/session";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  const home = actor ? (isStaff(actor) ? "/ops" : "/portal") : null;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-space-900 text-slate-100">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <Logo />
          <ul className="flex flex-wrap items-center gap-1 text-sm">
            <li>
              <Link className="hover:bg-space-700 rounded-md px-3 py-1.5" href="/catalog">
                Catalog
              </Link>
            </li>
            <li>
              <Link className="hover:bg-space-700 rounded-md px-3 py-1.5" href="/quote">
                Request a quote
              </Link>
            </li>
            <li>
              <Link className="hover:bg-space-700 rounded-md px-3 py-1.5" href="/about">
                Assumptions
              </Link>
            </li>
            {home ? (
              <>
                <li>
                  <Link
                    className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500"
                    href={home}
                  >
                    Dashboard
                  </Link>
                </li>
                <li>
                  <SignOutButton className="hover:bg-space-700 text-slate-200" />
                </li>
              </>
            ) : (
              <li>
                <Link
                  className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500"
                  href="/sign-in"
                >
                  Sign in
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-slate-600 sm:flex-row sm:justify-between">
          <p>
            © 2026 {APP_NAME}. All engineering and economic figures are first-order planning
            estimates.
          </p>
          <p className="flex gap-4">
            <Link href="/about" className="underline underline-offset-2">
              Model assumptions &amp; disclaimer
            </Link>
            <Link href="/catalog" className="underline underline-offset-2">
              Catalog
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
