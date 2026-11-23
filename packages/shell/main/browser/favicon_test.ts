import assert from "node:assert/strict";
import { test } from "node:test";

import { faviconData, firstFaviconData } from "./favicon.ts";

function fakeResponse(
  body: Buffer,
  options: { ok?: boolean; contentType?: string | null } = {},
) {
  const ok = options.ok ?? true;
  const contentType =
    options.contentType === undefined ? "image/png" : options.contentType;
  return {
    ok,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    arrayBuffer: async () => {
      const copy = new Uint8Array(body.byteLength);
      copy.set(body);
      return copy.buffer;
    },
  };
}

test("small image and case-insensitive content-type pass through", async () => {
  const bytes = Buffer.from([1, 2, 3, 4]);
  const data = await faviconData("https://example.com/icon.png", async () =>
    fakeResponse(bytes, { contentType: "Image/PNG; charset=utf-8" }),
  );
  assert.equal(data, `data:image/png;base64,${bytes.toString("base64")}`);
});

test("oversized image is resized to png", async () => {
  const big = Buffer.alloc(60 * 1024, 7);
  const small = Buffer.from([9, 8, 7]);
  const data = await faviconData(
    "https://example.com/big.ico",
    async () => fakeResponse(big, { contentType: "image/x-icon" }),
    (buf) => (buf.byteLength === big.byteLength ? small : null),
  );
  assert.equal(data, `data:image/png;base64,${small.toString("base64")}`);
});

test("octet-stream or missing content-type falls back to resize decode", async () => {
  const raw = Buffer.from([4, 5, 6]);
  const png = Buffer.from([10, 20]);
  const data = await faviconData(
    "https://example.com/favicon.ico",
    async () => fakeResponse(raw, { contentType: "application/octet-stream" }),
    () => png,
  );
  assert.equal(data, `data:image/png;base64,${png.toString("base64")}`);
});

test("html challenge response is rejected even with resize", async () => {
  let called = false;
  const data = await faviconData(
    "https://example.com/favicon.ico",
    async () =>
      fakeResponse(Buffer.from("<html>challenge</html>"), {
        contentType: "text/html; charset=utf-8",
      }),
    () => {
      called = true;
      return Buffer.from([1]);
    },
  );
  assert.equal(data, null);
  assert.equal(called, false);
});

test("firstFaviconData falls back to next candidate and deduplicates", async () => {
  const seen: string[] = [];
  const okBytes = Buffer.from([1, 2]);
  const data = await firstFaviconData(
    [
      "https://example.com/missing.ico",
      "https://example.com/missing.ico",
      "https://example.com/good.png",
      "https://example.com/unused.png",
    ],
    async (url) => {
      seen.push(url);
      if (url.endsWith("good.png")) return fakeResponse(okBytes);
      return fakeResponse(Buffer.alloc(0), { ok: false });
    },
  );
  assert.equal(data, `data:image/png;base64,${okBytes.toString("base64")}`);
  assert.deepEqual(seen, [
    "https://example.com/missing.ico",
    "https://example.com/good.png",
  ]);
});
