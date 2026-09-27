/** Only allow same-origin relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return fallback;
  // Control characters are rejected outright: URL parsers silently strip tab/CR/LF, which would
  // turn e.g. "/\t/evil.example" into the protocol-relative "//evil.example".
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
