import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CALL_RESULT_MAX_BYTES, nodeInvoke } from "./app-invoke.ts";

test("shell/app-frame#R9, shell/app-frame#R15: main client는 연결 socket의 고정 invoke 경로로 Authorization과 JSON만 보내고 큰 응답은 받지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-call-"));
  const socket = join(dir, "app.sock");
  const seen: {
    method?: string;
    url?: string;
    headers: unknown;
    body: string;
  }[] = [];
  let big = false;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        big
          ? JSON.stringify({
            result: { result: "x".repeat(CALL_RESULT_MAX_BYTES) },
          })
          : JSON.stringify({ result: { result: 1 }, mode: "live" }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  try {
    const reply = await nodeInvoke({
      endpoint: socket,
      authorization: "signed-connection",
      body: { request_key: "req-1", command: "usage.list" },
    });
    assert.deepEqual(reply, {
      status: 200,
      body: { result: { result: 1 }, mode: "live" },
    });
    assert.equal(seen[0]!.method, "POST");
    assert.equal(seen[0]!.url, "/_lophn/commands/invoke");
    const headers = seen[0]!.headers as Record<string, string>;
    assert.equal(headers.authorization, "signed-connection");
    assert.equal(headers.host, "lophn.invalid");
    assert.deepEqual(JSON.parse(seen[0]!.body), {
      request_key: "req-1",
      command: "usage.list",
    });
    big = true;
    await assert.rejects(
      nodeInvoke({ endpoint: socket, authorization: "a", body: {} }),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
