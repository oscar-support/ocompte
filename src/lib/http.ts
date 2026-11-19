import { isIP } from "node:net";
import { ValidationError } from "./ledger.ts";
import { DatabaseUnavailableError } from "./store.ts";

export const MAX_JSON_BYTES = 16 * 1024;

export function creationCaller(request: Request, onVercel = process.env.VERCEL === '1'): string | null {
  if (!onVercel) return null;
  const ip = request.headers.get('x-vercel-forwarded-for')?.trim() ?? '';
  const type = isIP(ip);
  if (type === 4) return ip;
  if (type !== 6 || ip.includes('%')) return 'unknown';
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  if (canonical.startsWith('::ffff:')) return canonical;
  const [prefix, suffix] = canonical.split('::');
  const left = prefix ? prefix.split(':') : [];
  const right = suffix ? suffix.split(':') : [];
  return `v6:${[...left, ...Array(8 - left.length - right.length).fill('0'), ...right].slice(0, 4).join(':')}`;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function requireBearerToken(request: Request): string {
  // A 32-byte unpadded base64url value has two zero bits in its final character.
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i);
  if (!match || !/[AEIMQUYcgkosw048]$/.test(match[1])) {
    throw new HttpError(401, "Un lien d’accès valide est nécessaire.");
  }
  return match[1];
}

export function requireSameOrigin(request: Request, onVercel = process.env.VERCEL === "1"): void {
  const origin = request.headers.get("origin");
  if (origin === null) return;
  const url = new URL(request.url);

  // Only Vercel's proxy supplies a trusted forwarded host; public requests there use HTTPS.
  const forwardedHost = onVercel ? request.headers.get("x-forwarded-host") : null;
  // Next.js can canonicalize the Request URL to localhost; Host is still the
  // browser's routed authority, even when the server was bound by IP.
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const expected = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i.test(host)
    ? URL.parse(`${onVercel ? "https:" : url.protocol}//${host}`)
    : null;
  if (!expected || origin !== expected.origin) throw new HttpError(403, "Origine de la requête non autorisée.");
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "Le corps de la requête doit être au format JSON.");
  }
  const oversized = () => new HttpError(413, "La requête est trop volumineuse.");
  if (Number(request.headers.get("content-length")) > MAX_JSON_BYTES) throw oversized();

  const invalidJson = () => new HttpError(400, "Le corps JSON de la requête est invalide.");
  if (!request.body) throw invalidJson();

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) throw oversized();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof HttpError) throw error;
    throw invalidJson();
  } finally {
    reader.releaseLock();
  }
}

export function apiJson(body: unknown, status = 200): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (status === 401) headers.set("WWW-Authenticate", "Bearer");
  return Response.json(body, { status, headers });
}

export async function withApiResponse(handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle();
  } catch (error) {
    if (error instanceof HttpError) return apiJson({ error: error.message }, error.status);
    if (error instanceof ValidationError) return apiJson({ error: error.message }, 400);
    if (error instanceof DatabaseUnavailableError) return apiJson({ error: error.message }, 503);
    return apiJson({ error: "Une erreur du serveur est survenue. Réessayez dans un instant." }, 500);
  }
}
