import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HttpError,
  MAX_JSON_BYTES,
  requireBearerToken,
  requireSameOrigin,
  readJsonBody,
} from "../src/lib/http.ts";

const token = "A".repeat(43);

function request(headers?: HeadersInit, url = "https://ocompte.example/api/group") {
  return new Request(url, { headers });
}

function status(code: number) {
  return (error: unknown) => error instanceof HttpError && error.status === code;
}

test("accepts a canonical 32-byte capability in a Bearer header", () => {
  assert.equal(requireBearerToken(request({ authorization: `Bearer ${token}` })), token);
  assert.equal(requireBearerToken(request({ authorization: `bearer ${token}` })), token);
});

test("rejects missing, malformed, or noncanonical capabilities", () => {
  for (const authorization of [undefined, token, `Basic ${token}`, `Bearer ${token}=`,
    `Bearer ${token.slice(1)}`, `Bearer ${token.slice(1)}B`, `Bearer ${token}, ${token}`]) {
    assert.throws(() => requireBearerToken(request(authorization ? { authorization } : {})), status(401));
  }
});

test("permits mutations with no Origin header or the exact request origin", () => {
  requireSameOrigin(request());
  requireSameOrigin(request({ origin: "https://ocompte.example" }));
});

test("rejects mismatched origins and ignores untrusted forwarding headers", () => {
  for (const origin of ["null", "http://ocompte.example", "https://ocompte.example:444", "https://other.example"]) {
    assert.throws(() => requireSameOrigin(request({
      origin, "x-forwarded-host": "other.example", "x-forwarded-proto": "http",
    }), false), status(403));
  }
});

test("uses the HTTP Host when Next.js rewrites the request URL to localhost", () => {
  const url = "http://localhost:3108/api/group";
  const headers = { origin: "http://127.0.0.1:3108", host: "127.0.0.1:3108" };
  requireSameOrigin(request(headers, url), false);
  assert.throws(() => requireSameOrigin(request({ ...headers, origin: "http://localhost:3108" }, url), false), status(403));
  assert.throws(() => requireSameOrigin(request({ ...headers, host: "127.0.0.1:3108/path" }, url), false), status(403));
});

test("uses Vercel's forwarded HTTPS host when the request URL is internal", () => {
  const headers = { origin: "https://preview.example", "x-forwarded-host": "preview.example" };
  requireSameOrigin(request(headers, "http://localhost:3000/api/group"), true);
  assert.throws(() => requireSameOrigin(request({ ...headers, origin: "http://localhost:3000" },
    "http://localhost:3000/api/group"), true), status(403));
  assert.throws(() => requireSameOrigin(request({ ...headers, "x-forwarded-host": "preview.example/path" }), true), status(403));
});

function json(body: BodyInit, headers: HeadersInit = { "content-type": "application/json" }) {
  return new Request("https://ocompte.example/api/group", {
    method: "PATCH", body, headers, duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("reads a UTF-8 JSON body with media-type parameters", async () => {
  assert.deepEqual(await readJsonBody(json('{"nom":"Éva"}', {
    "content-type": "application/json; charset=utf-8",
  })), { nom: "Éva" });
});

test("rejects non-JSON media types and malformed JSON or UTF-8", async () => {
  await assert.rejects(readJsonBody(json("{}", { "content-type": "text/plain" })), status(415));
  await assert.rejects(readJsonBody(json("{")), status(400));
  await assert.rejects(readJsonBody(json(new Uint8Array([34, 255, 34]))), status(400));
});

test("rejects an oversized declared body", async () => {
  await assert.rejects(readJsonBody(json("{}", {
    "content-type": "application/json", "content-length": String(MAX_JSON_BYTES + 1),
  })), status(413));
});

test("applies the byte limit to actual streamed UTF-8 bytes despite a short Content-Length", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('"'));
      controller.enqueue(encoder.encode("é".repeat(MAX_JSON_BYTES / 2)));
      controller.enqueue(encoder.encode('"'));
      controller.close();
    },
  });
  await assert.rejects(readJsonBody(json(stream, {
    "content-type": "application/json", "content-length": "2",
  })), status(413));
});

test("accepts a JSON body at the exact byte limit", async () => {
  const value = "x".repeat(MAX_JSON_BYTES - 2);
  assert.equal(await readJsonBody(json(JSON.stringify(value))), value);
});
