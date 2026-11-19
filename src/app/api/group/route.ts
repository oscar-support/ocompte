import { apiJson, HttpError, readJsonBody, requireBearerToken, requireSameOrigin, withApiResponse } from "../../../lib/http.ts";
import { applyAction, type Group } from "../../../lib/ledger.ts";
import { getGroupStore } from "../../../lib/store.ts";

export const runtime = "nodejs";

function notFound(): never {
  throw new HttpError(404, "Ce groupe est introuvable.");
}

function conflict(group: Group): Response {
  return apiJson({ error: "Le groupe a été modifié. Vérifiez les changements avant de réessayer.", group }, 409);
}

export function GET(request: Request): Promise<Response> {
  return withApiResponse(async () => {
    const token = requireBearerToken(request);
    const store = await getGroupStore();
    const group = await store.get(token);
    if (!group) notFound();
    return apiJson({ group });
  });
}

export function PATCH(request: Request): Promise<Response> {
  return withApiResponse(async () => {
    requireSameOrigin(request);
    const token = requireBearerToken(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "La modification est invalide.");
    }
    const { version, action } = body as Record<string, unknown>;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
      throw new HttpError(400, "La version du groupe est invalide.");
    }
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new HttpError(400, "L’action est invalide.");
    }

    const store = await getGroupStore();
    const group = await store.get(token);
    if (!group) notFound();
    if (group.version !== version) return conflict(group);
    const updated = applyAction(group, action);
    if (await store.compareAndSwap(token, version, updated)) return apiJson({ group: updated });

    const latest = await store.get(token);
    if (!latest) notFound();
    return conflict(latest);
  });
}
