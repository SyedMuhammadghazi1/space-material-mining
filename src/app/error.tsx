"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Generic error boundary — never shows stack traces or internal messages. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page error", error.digest ?? "");
  }, [error]);
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="text-sm font-semibold text-red-700">Error</p>
      <h1 className="mt-2 text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-slate-600">
        The problem has been logged{error.digest ? ` (reference ${error.digest})` : ""}. Please try
        again.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-blue-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-800"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
