import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, PATCH } from "../src/app/api/group/route.ts";
import { POST } from "../src/app/api/groups/route.ts";
import { withApiResponse } from "../src/lib/http.ts";

// The actual route handlers run without touching an existing database.
delete process.env.DATABASE_URL;

const base = "https://ocompte.example";
const authorization = `Bearer ${"A".repeat(43)}`;

function mutation(method: "POST" | "PATCH", body: string, headers: Record<string, string> = {}) {
  return new Request(`${base}/api/${method === "POST" ? "groups" : "group"}`, {
    method, body, headers: { "content-type": "application/json", ...headers },
  });
}

async function expectFailure(response: Response, status: number): Promise<string> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
  return body.error;
}

test("POST validates input before connecting to the database", async () => {
  const error = await expectFailure(await POST(mutation("POST", '{"currency":"EUR","names":[]}')), 400);
  assert.match(error, /nom du groupe/i);
});

test("POST refuses cross-origin groups, even when the database is missing", async () => {
  await expectFailure(await POST(mutation("POST", "{}", { origin: "https://other.example" })), 403);
});

test("GET returns a Bearer challenge for an invalid capability", async () => {
  const response = await GET(new Request(`${base}/api/group`, { headers: { authorization: "Bearer invalid" } }));
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
  await expectFailure(response, 401);
});

test("PATCH rejects a negative or unsafe version before connecting to the database", async () => {
  for (const version of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "0"]) {
    const body = JSON.stringify({ version, action: { type: "member.add", name: "Noé" } });
    const error = await expectFailure(await PATCH(mutation("PATCH", body, { authorization })), 400);
    assert.match(error, /version/i);
  }
});

test("PATCH rejects a missing action before connecting to the database", async () => {
  const error = await expectFailure(await PATCH(mutation("PATCH", '{"version":0}', { authorization })), 400);
  assert.match(error, /action/i);
});

test("PATCH rejects a cross-origin request with an otherwise valid capability", async () => {
  await expectFailure(await PATCH(mutation("PATCH", "{}", { authorization, origin: "https://other.example" })), 403);
});

test("POST, GET, and PATCH return a localized 503 without database configuration", async () => {
  const create = mutation("POST", '{"name":"Voyage","currency":"EUR","names":["Noé"]}', { origin: base });
  const read = new Request(`${base}/api/group`, { headers: { authorization } });
  const patch = mutation("PATCH", '{"version":0,"action":{"type":"member.add","name":"Léa"}}', { authorization });
  for (const response of await Promise.all([POST(create), GET(read), PATCH(patch)])) {
    const error = await expectFailure(response, 503);
    assert.match(error, /stockage .*pas configuré/i);
  }
});

test("unexpected persistence failures return a generic error instead of internal details", async () => {
  const response = await withApiResponse(async () => {
    throw new Error("unexpected table detail");
  });
  const error = await expectFailure(response, 500);
  assert.doesNotMatch(error, /unexpected table detail/);
});
