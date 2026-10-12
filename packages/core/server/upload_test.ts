// upload route 테스트다(platform/api#R3, R6; coding-agent#T14). 입력은 header의
// base64url JSON, body는 바이트다. 인증·scope·한도·선언 길이를 handler 앞에서 검사하고
// 바이트는 해석 없이 stream으로 넘긴다.
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  defineUpload,
  UPLOAD_INPUT_HEADER,
} from "../../protocol/server/mod.ts";
import {
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "./identity/mod.ts";
import { manualClock, seededRandom } from "../../base/mod.ts";
import { startApiServer, type UploadHandler } from "./mod.ts";
import { RouteRegistry } from "./routes.ts";
import { value } from "./harness_test.ts";

const upload = defineUpload({
  resource: "documents",
  method: "upload",
  name: "document.upload",
  input: z.strictObject({ bytes: z.number().int().min(0) }),
  output: z.object({ received: z.number() }),
  actors: ["user"],
  errors: ["invalid_input", "unavailable"],
  max_bytes: 16,
});

const POLICIES: OperationPolicy[] = [
  { name: "document.upload", actors: ["user"], kind: "read" },
  { name: "identity/current", actors: ["user"], kind: "read" },
];

const ALLOWED: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: { operations: ["document.upload"], targets: {} },
  conditions: { process: "main-generation" },
};

const OTHER: CredentialIssue = {
  ...ALLOWED,
  scope: { operations: ["identity/current"], targets: {} },
};

function header(input: unknown): string {
  return btoa(JSON.stringify(input)).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");
}

async function open(
  handler: UploadHandler | undefined,
  issue: CredentialIssue = ALLOWED,
) {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const credentials = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random: seededRandom(5),
    operations: POLICIES,
  });
  const allowed = value(await credentials.issue(issue));
  const server = await startApiServer({
    port: 0,
    clock,
    credentials,
    registry: new RouteRegistry([upload]),
    ...(handler === undefined ? {} : {
      uploads: new Map([["documents/upload", handler]]),
    }),
  });
  return {
    server,
    url: `http://127.0.0.1:${server.port}/v1/documents/upload`,
    token: allowed.token,
  };
}

const collecting = (seen: { bytes: number[]; inputs: unknown[] }) =>
  (async (_ctx, input, body): Promise<Result<unknown>> => {
    seen.inputs.push(input);
    const reader = body.bytes.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      seen.bytes.push(...next.value);
    }
    return ok({ received: seen.bytes.length });
  }) satisfies UploadHandler;

function send(
  opened: { url: string; token: string },
  init: {
    input?: unknown;
    body?: BodyInit | null;
    type?: string;
    token?: string;
    headers?: Record<string, string>;
  },
) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${init.token ?? opened.token}`);
  headers.set("content-type", init.type ?? "application/octet-stream");
  if (init.input !== undefined) {
    headers.set(UPLOAD_INPUT_HEADER, header(init.input));
  }
  return fetch(opened.url, {
    method: "POST",
    headers,
    body: init.body ?? null,
  });
}

Deno.test("platform/api#R3: upload route는 header 입력과 바이트 body를 handler에 흘려 보내고 결과 JSON을 그대로 낸다", async () => {
  const seen = { bytes: [] as number[], inputs: [] as unknown[] };
  const opened = await open(collecting(seen));
  try {
    const response = await send(opened, {
      input: { bytes: 5 },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { received: 5 });
    assertEquals(seen.bytes, [1, 2, 3, 4, 5]);
    assertEquals(seen.inputs, [{ bytes: 5 }]);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R6: upload는 인증·scope·content type·입력·한도를 handler 앞에서 거절한다", async () => {
  const seen = { bytes: [] as number[], inputs: [] as unknown[] };
  const opened = await open(collecting(seen));
  try {
    const body = new Uint8Array([1, 2, 3]);
    const noToken = await fetch(opened.url, { method: "POST", body });
    assertEquals(noToken.status, 401);
    await noToken.body?.cancel();
    const json = await send(opened, {
      input: { bytes: 3 },
      body,
      type: "application/json",
    });
    assertEquals(json.status, 400);
    await json.body?.cancel();
    const noInput = await send(opened, { body });
    assertEquals(noInput.status, 400);
    await noInput.body?.cancel();
    const badInput = await send(opened, { input: { bytes: "3" }, body });
    assertEquals(badInput.status, 400);
    await badInput.body?.cancel();
    const extra = await send(opened, { input: { bytes: 3, path: "/x" }, body });
    assertEquals(extra.status, 400);
    await extra.body?.cancel();
    // route 상한(16바이트)을 넘는 선언은 body를 읽기 전에 거절한다.
    const big = await send(opened, {
      input: { bytes: 17 },
      body: new Uint8Array(17),
    });
    assertEquals(big.status, 400);
    await big.body?.cancel();
    assertEquals(seen.inputs, []);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R6: 이 operation이 scope에 없는 credential은 handler에 닿지 못한다", async () => {
  const seen = { bytes: [] as number[], inputs: [] as unknown[] };
  const opened = await open(collecting(seen), OTHER);
  try {
    const response = await send(opened, {
      input: { bytes: 3 },
      body: new Uint8Array([1, 2, 3]),
    });
    assertEquals(response.status, 403);
    await response.body?.cancel();
    assertEquals(seen.inputs, []);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R6: upload body가 선언 길이와 다르면 handler 안에서 stream이 오류로 끝난다", async () => {
  let failed = 0;
  const opened = await open(async (_ctx, _input, body) => {
    try {
      const reader = body.bytes.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
      }
      return ok({ received: 0 });
    } catch {
      failed += 1;
      return err({ code: "invalid_input", message: "body mismatch" });
    }
  });
  try {
    // 선언보다 긴 body(chunked 없이 content-length를 직접 줄여 보낸다).
    const raw = await Deno.connect({
      hostname: "127.0.0.1",
      port: opened.server.port,
    });
    const encoder = new TextEncoder();
    await raw.write(encoder.encode(
      `POST /v1/documents/upload HTTP/1.1\r\nHost: 127.0.0.1:${opened.server.port}\r\n` +
        `Authorization: Bearer ${opened.token}\r\n` +
        `Content-Type: application/octet-stream\r\n` +
        `${UPLOAD_INPUT_HEADER}: ${header({ bytes: 4 })}\r\n` +
        `Content-Length: 4\r\nConnection: close\r\n\r\nab`,
    ));
    raw.closeWrite();
    const answer = new TextDecoder().decode(await readAll(raw));
    assert(answer.startsWith("HTTP/1.1 400"), answer.slice(0, 40));
    raw.close();
    assertEquals(failed, 1);
  } finally {
    await opened.server.stop();
  }
});

async function readAll(conn: Deno.Conn): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(1024);
  for (;;) {
    const count = await conn.read(buffer);
    if (count === null) break;
    chunks.push(buffer.slice(0, count));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}

Deno.test("platform/api#R6: chunked body도 route 상한을 넘으면 흐르는 동안 stream이 오류로 끝난다", async () => {
  let failed = 0;
  let received = 0;
  const opened = await open(async (_ctx, _input, body) => {
    try {
      const reader = body.bytes.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.length;
      }
      return ok({ received });
    } catch {
      failed += 1;
      return err({ code: "invalid_input", message: "too long" });
    }
  });
  try {
    // Content-Length 없이 보낸다(stream body). 상한은 16바이트다.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
        controller.enqueue(new Uint8Array(10));
        controller.close();
      },
    });
    const response = await fetch(opened.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opened.token}`,
        "content-type": "application/octet-stream",
        [UPLOAD_INPUT_HEADER]: header({ bytes: 20 }),
      },
      body: stream,
      // @ts-ignore Deno의 stream body 옵션이다.
      duplex: "half",
    });
    assertEquals(response.status, 400);
    await response.body?.cancel();
    assertEquals(failed, 1);
    assert(received <= 16);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: upload handler가 없으면 unavailable이고 handler 오류는 고정 문구다", async () => {
  const none = await open(undefined);
  try {
    const response = await send(none, {
      input: { bytes: 1 },
      body: new Uint8Array([1]),
    });
    assertEquals(response.status, 503);
    await response.body?.cancel();
  } finally {
    await none.server.stop();
  }
  const failing = await open(() =>
    Promise.resolve(
      err({ code: "unavailable", message: "I/O worker /secret/path 실패" }),
    )
  );
  try {
    const response = await send(failing, {
      input: { bytes: 1 },
      body: new Uint8Array([1]),
    });
    assertEquals(response.status, 503);
    const text = await response.text();
    assertEquals(text.includes("/secret/path"), false);
  } finally {
    await failing.server.stop();
  }
});
