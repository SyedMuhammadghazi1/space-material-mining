import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="text-sm font-semibold text-slate-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-slate-600">It may have moved, or you may not have access to it.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-blue-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-800"
      >
        Back to home
      </Link>
    </main>
  );
}
