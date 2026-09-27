"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active =
    href === "/ops" ? pathname === "/ops" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "block rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
        active
          ? "bg-space-700 font-medium text-white"
          : "hover:bg-space-800 text-slate-300 hover:text-white",
      )}
    >
      {children}
    </Link>
  );
}
