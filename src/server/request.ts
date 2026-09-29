import { AppError, ValidationError } from "./errors";

export class PayloadTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super(`Payload too large (max ${Math.round(maxBytes / 1024)} KiB)`, 413, "payload_too_large");
  }
}

/**
 * Reads a request body as text but stops (413-style validation error) once `maxBytes` is exceeded,
 * so a client can't make the server buffer an arbitrarily large chunked body.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new PayloadTooLargeError(maxBytes);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  const text = await readBodyCapped(req, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Body must be valid JSON");
  }
}
