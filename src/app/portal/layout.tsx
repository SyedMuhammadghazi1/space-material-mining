import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { requireUser } from "@/server/session";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const actor = await requireUser("/portal");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-space-900 text-slate-100">
        <nav
          aria-label="Customer portal"
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <Logo href="/portal" />
          <ul className="flex flex-wrap items-center gap-1 text-sm">
            <li>
              <Link className="hover:bg-space-700 rounded-md px-3 py-1.5" href="/portal">
                My quotes &amp; orders
              </Link>
            </li>
            <li>
              <Link className="hover:bg-space-700 rounded-md px-3 py-1.5" href="/quote">
                New quote
              </Link>
            </li>
            <li>
              <Link className="hover:bg-space-700 rounded-md px-3 py-1.5" href="/catalog">
                Catalog
              </Link>
            </li>
            <li className="hidden px-2 text-slate-400 sm:block" aria-label="Signed in as">
              {actor.email}
            </li>
            <li>
              <SignOutButton className="hover:bg-space-700 text-slate-200" />
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
