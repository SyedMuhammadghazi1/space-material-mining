import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";

export function Logo({ href = "/", tone = "light" }: { href?: string; tone?: "light" | "dark" }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 font-semibold tracking-tight ${tone === "light" ? "text-white" : "text-slate-900"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 32 32" className="h-7 w-7">
        <circle cx="16" cy="16" r="9" fill="#cbd5e1" />
        <circle cx="12.5" cy="13" r="2.2" fill="#94a3b8" />
        <circle cx="19" cy="19.5" r="1.6" fill="#94a3b8" />
        <ellipse
          cx="16"
          cy="16"
          rx="15"
          ry="5"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.6"
          transform="rotate(-20 16 16)"
        />
      </svg>
      <span>{APP_NAME}</span>
    </Link>
  );
}
