import type { ReactNode } from "react";
import type { UserRole } from "@/db/schema";
import { ROLE_LABELS, type Actor } from "@/server/authz";
import { Logo } from "./logo";
import { NavLink } from "./nav-link";
import { SignOutButton } from "./sign-out-button";

interface NavItem {
  href: string;
  label: string;
  roles?: UserRole[];
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operations",
    items: [
      { href: "/ops", label: "Mission control" },
      { href: "/ops/rigs", label: "Extraction rigs" },
      { href: "/ops/alerts", label: "Alerts" },
      { href: "/ops/inventory", label: "Inventory ledger" },
      { href: "/ops/fabrication", label: "Fabrication" },
    ],
  },
  {
    title: "Planning",
    items: [
      { href: "/ops/targets", label: "Targets" },
      { href: "/ops/scenarios", label: "Mission scenarios" },
      { href: "/ops/economics", label: "Economics explorer" },
      { href: "/ops/missions", label: "Missions" },
    ],
  },
  {
    title: "Commercial",
    items: [
      { href: "/ops/quotes", label: "Quote queue", roles: ["engineer", "admin"] },
      { href: "/ops/orders", label: "Orders" },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/admin/users", label: "Users & roles", roles: ["admin"] },
      { href: "/admin/audit", label: "Audit log", roles: ["admin"] },
    ],
  },
];

function NavSections({ sections }: { sections: { title: string; items: NavItem[] }[] }) {
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {s.title}
          </p>
          <ul className="space-y-0.5">
            {s.items.map((i) => (
              <li key={i.href}>
                <NavLink href={i.href}>{i.label}</NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const sections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.roles || i.roles.includes(actor.role)),
  })).filter((s) => s.items.length);
  const who = (
    <div className="text-xs text-slate-400">
      <p className="truncate" title={actor.email}>
        {actor.name}
      </p>
      <p>{ROLE_LABELS[actor.role]}</p>
      <SignOutButton className="hover:bg-space-800 mt-2 -ml-3 text-slate-300" />
    </div>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Mobile: compact bar with a disclosure menu. */}
      <header className="bg-space-950 text-slate-100 lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <Logo href="/ops" />
            <span className="border-space-700 rounded-md border px-3 py-1 text-sm">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </summary>
          <nav aria-label="Staff" className="space-y-4 px-2 pb-4">
            <NavSections sections={sections} />
            <div className="border-space-800 border-t px-3 pt-3">{who}</div>
          </nav>
        </details>
      </header>
      {/* Desktop: full-height sidebar. */}
      <div className="bg-space-950 hidden text-slate-100 lg:block">
        <aside className="sticky top-0 flex h-screen flex-col overflow-y-auto">
          <div className="px-4 py-4">
            <Logo href="/ops" />
          </div>
          <nav aria-label="Staff" className="flex-1 px-2 pb-4">
            <NavSections sections={sections} />
          </nav>
          <div className="border-space-800 border-t px-4 py-3">{who}</div>
        </aside>
      </div>
      <main id="main" className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </div>
  );
}
