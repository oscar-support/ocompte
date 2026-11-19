import assert from "node:assert/strict";
import { test } from "node:test";
import { requireBearerToken } from "../src/lib/http.ts";
import {
  DatabaseUnavailableError,
  databaseConnectionUrl,
  getGroupStore,
  hashGroupToken,
  issueGroupToken,
} from "../src/lib/store.ts";

test("Neon URLs use certificate and hostname checks instead of unsupported channel binding", () => {
  const input = "postgres://app@ep-example-pooler.eu-central-1.aws.neon.tech/db?sslmode=require&channel_binding=require";
  const url = new URL(databaseConnectionUrl(input));
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.has("channel_binding"), false);
  assert.equal(url.hostname, new URL(input).hostname);
  const local = "postgres://app@127.0.0.1:5432/db";
  assert.equal(databaseConnectionUrl(local), local);
});

test("issues distinct canonical capabilities encoding 32 bytes", () => {
  const tokens = new Set(Array.from({ length: 32 }, issueGroupToken));
  assert.equal(tokens.size, 32);
  for (const token of tokens) {
    const request = new Request("https://ocompte.example/api/group", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(requireBearerToken(request), token);
    assert.equal(Buffer.from(token, "base64url").byteLength, 32);
  }
});

test("derives the persistent lookup key as the hex SHA-256 of the token", () => {
  assert.equal(
    hashGroupToken("A".repeat(43)),
    "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
  );
});

test("fails closed when the database URL is not configured", async (t) => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
  await assert.rejects(getGroupStore(), DatabaseUnavailableError);
});
