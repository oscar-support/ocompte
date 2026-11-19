import { apiJson, creationCaller, HttpError, readJsonBody, requireSameOrigin, withApiResponse } from "../../../lib/http.ts";
import { createGroup } from "../../../lib/ledger.ts";
import { getGroupStore } from "../../../lib/store.ts";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withApiResponse(async () => {
    requireSameOrigin(request);
    const group = createGroup(await readJsonBody(request));
    const store = await getGroupStore();
    const created = await store.create(group, creationCaller(request));
    if (!created) throw new HttpError(429, "La limite de création de groupes est atteinte. Réessayez plus tard.");
    return apiJson(created, 201);
  });
}
