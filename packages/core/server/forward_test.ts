import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, type Result, seededRandom } from "../../base/mod.ts";
import { z } from "zod";
import type { ConfirmationHandleRegister } from "../../protocol/server/mod.ts";
import { defineFile, ERROR_HTTP_STATUS } from "../../protocol/base/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../protocol/supervision/mod.ts";
import {
  filesDelete,
  ROUTES as DOCUMENT_ROUTES,
} from "../../protocol/projects/mod.ts";
import {
  confirmationBinding,
  type ConfirmationBridge,
  confirmationBridge,
  ConfirmationRegistry,
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "./identity/mod.ts";
import {
  type WorkerRouteHandle,
  type WorkerRouteLimits,
  type WorkerRouteTarget as ResponsivenessTarget,
} from "../supervision/responsiveness/mod.ts";
import { startApiServer } from "./mod.ts";
import { RouteRegistry } from "./routes.ts";
import { call, value } from "./harness_test.ts";

const AT = "2026-10-04T00:00:00.000Z";

// 기본 harness USER(actor user, scope identity/current)는 files route를 못 쓴다.
// files.read·files.delete·files.rename 작업이 scope에 있는 credential을 따로 발급한다.
const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: {
    operations: ["files.read", "files.delete", "files.rename"],
    targets: {},
  },
  conditions: { process: "main-generation" },
};

const POLICIES: OperationPolicy[] = [
  { name: "files.read", actors: ["user"], kind: "read" },
  { name: "files.delete", actors: ["user"], kind: "read" },
  { name: "files.rename", actors: ["user"], kind: "read" },
  { name: "identity/current", actors: ["user"], kind: "read" },
];

function openRegistry(): {
  clock: ReturnType<typeof manualClock>;
  credentials: CredentialRegistry;
} {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  return {
    clock,
    credentials: new CredentialRegistry({
      epoch: "core-one",
      clock,
      random: seededRandom(5),
      operations: POLICIES,
    }),
  };
}

function target(
  handle: WorkerRouteHandle,
  limits?: WorkerRouteLimits,
): ResponsivenessTarget {
  return { handle, ...(limits === undefined ? {} : { limits }) };
}

// observing 동안 output 검사에 필요한 AT 등으로 만든 응답.
function okResponse(
  request: WorkerRequest,
  payload: unknown,
): Result<WorkerResponse, never> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: true,
    payload,
  });
}

function errorResponse(
  request: WorkerRequest,
  code: "conflict" | "forbidden",
  message: string,
): Result<WorkerResponse, never> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: false,
    error: { code, message },
  });
}

// filesDelete 입력(binding field 3개)과 그 canonical bind 내용.
const FILE_TARGET = {
  kind: "working_copy" as const,
  document: "doc_01arz3ndektsv4rrffq69g5fav",
};
const DELETE_INPUT = {
  request_key: "delete-request-1",
  target: FILE_TARGET,
  base_hash: "a".repeat(64),
};
const RENAME_INPUT = {
  request_key: "rename-request-1",
  target: FILE_TARGET,
  path: "/work/docs/renamed.md",
  base_hash: "a".repeat(64),
};

async function openWorkerServer(
  workers: ReadonlyMap<string, ResponsivenessTarget>,
  confirmation?: ConfirmationBridge,
  registry?: RouteRegistry,
) {
  const made = openRegistry();
  const credential = made.credentials;
  const issued = value(await credential.issue(USER));
  const server = await startApiServer({
    port: 0,
    clock: made.clock,
    credentials: credential,
    workers,
    // documents ROUTES에는 filesRead·filesDelete가 있다. 등록되지 않은 route는 404다.
    registry: registry ?? new RouteRegistry([...DOCUMENT_ROUTES]),
    ...(confirmation === undefined ? {} : { confirmation }),
  });
  return {
    server,
    base: `http://127.0.0.1:${server.port}`,
    token: issued.token,
  };
}

// filesRead는 file kind다. dispatch는 ledger queue 없이 감독 pipe 통로로 넘긴다.
Deno.test("platform/api#R3: file route는 인증·한도·schema 뒤 worker로 넘기고 바이트와 Content-Type을 그대로 돌려준다", async () => {
  const bytes = new TextEncoder().encode("# 원문 문서");
  const requests: WorkerRequest[] = [];
  const opened = await openWorkerServer(
    new Map([
      [
        "files/read",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async (request) => {
            requests.push(request);
            assertEquals(request.type, "worker_request");
            assertEquals(request.op, "files.read");
            assert(request.request_id.length > 0);
            // 감독 pipe로 file route 요청을 보낸다. 응답 payload에 원문 bytes를 싣는다.
            return ok({
              type: "worker_response",
              request_id: request.request_id,
              ok: true,
              payload: { bytes: [...bytes] },
            });
          },
        }),
      ],
    ]),
  );
  try {
    const response = await call(opened.base, "/v1/files/read", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: FILE_TARGET }),
    });
    assertEquals(response.status, 200);
    // 등록된 Content-Type이 그대로 나온다. JSON 포장·문자열 변환 없이 원본 바이트가 나온다(api R3).
    assertEquals(
      response.headers.get("content-type"),
      "application/octet-stream",
    );
    const raw = new Uint8Array(await response.arrayBuffer());
    assertEquals([...raw], [...bytes]);
    assertEquals(requests.length, 1);
    assertEquals(requests[0].payload, { target: FILE_TARGET });
  } finally {
    await opened.server.stop();
  }
});

// 계약: file 응답은 저장된 ContentFile.media_type을 싣고 route의 octet-stream은 fallback이다.
async function fileMediaType(
  payload: Record<string, unknown>,
): Promise<{ status: number; contentType: string | null; text: string }> {
  const opened = await openWorkerServer(
    new Map([
      [
        "files/read",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async (request) => okResponse(request, payload),
        }),
      ],
    ]),
  );
  try {
    const response = await call(opened.base, "/v1/files/read", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: FILE_TARGET }),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      text: await response.text(),
    };
  } finally {
    await opened.server.stop();
  }
}

Deno.test("platform/api#R3: file route는 worker가 준 저장된 media type을 Content-Type으로 보낸다", async () => {
  const markdown = await fileMediaType({
    bytes: [35, 32, 0xec, 0x9b, 0x90],
    media_type: "text/markdown",
  });
  assertEquals(markdown.status, 200);
  assertEquals(markdown.contentType, "text/markdown");
  const png = await fileMediaType({
    bytes: [1, 2, 3],
    media_type: "image/png",
  });
  assertEquals(png.contentType, "image/png");
  // 내용을 보고 고르지 않는다: markdown 본문이어도 저장된 값이 octet-stream이면 그대로다.
  const stored = await fileMediaType({
    bytes: [...new TextEncoder().encode("# 제목")],
    media_type: "application/octet-stream",
  });
  assertEquals(stored.contentType, "application/octet-stream");
  // media type이 없으면 route 등록값(fallback)이다.
  const absent = await fileMediaType({ bytes: [1] });
  assertEquals(absent.contentType, "application/octet-stream");
});

Deno.test("platform/api#R3: file route는 형식이 어긋난 media type을 fallback으로 바꾸지 않고 internal로 거절한다", async () => {
  for (
    const media_type of [
      "text/markdown\r\nset-cookie: a=b",
      "text/markdown; charset=utf-8",
      "text",
      "",
      " text/plain",
      7,
    ]
  ) {
    const rejected = await fileMediaType({ bytes: [1, 2], media_type });
    assertEquals(rejected.status, 500, String(media_type));
    assertEquals(JSON.parse(rejected.text).error.code, "internal");
    assertEquals(rejected.text.includes("set-cookie"), false);
  }
});

Deno.test("platform/api#R3: file route 실패는 JSON 공통 오류다", async () => {
  const opened = await openWorkerServer(
    new Map([
      [
        "files/read",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async (request) =>
            ok({
              type: "worker_response",
              request_id: request.request_id,
              ok: false,
              error: { code: "not_found", message: "파일이 없다" },
            }),
        }),
      ],
    ]),
  );
  try {
    const response = await call(opened.base, "/v1/files/read", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: FILE_TARGET }),
    });
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error.code, "not_found");
    // worker 문장은 새지 않는다. 코드별 고정 message로 바꾼다(platform/api#R4).
    assertEquals(body.error.message, "대상이 없다");
    assertEquals(body.error.details, undefined);
  } finally {
    await opened.server.stop();
  }
});

// problems의 report 같은 worker route(problems/report). 같은 길로 JSON 결과를 그대로 낸다.
Deno.test("platform/api#R3: worker route는 같은 길로 JSON 결과를 그대로 돌려준다", async () => {
  const requests: WorkerRequest[] = [];
  const opened = await openWorkerServer(
    new Map([
      [
        "files/rename",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async (request) => {
            requests.push(request);
            assertEquals(request.type, "worker_request");
            assertEquals(request.op, "files.rename");
            return okResponse(request, {
              request_key: RENAME_INPUT.request_key,
              operation: "rename",
              target: FILE_TARGET,
              outcome: "renamed",
              before_path: "/work/docs/report.md",
              after_path: RENAME_INPUT.path,
              before_hash: RENAME_INPUT.base_hash,
              written_hash: null,
              observed_hash: null,
              observed_at: null,
              changed_again: null,
              recording: "recorded",
              event_seq: "12",
              version_result: "not_requested",
            });
          },
        }),
      ],
    ]),
  );
  try {
    const response = await call(opened.base, "/v1/files/rename", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(RENAME_INPUT),
    });
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.operation, "rename");
    assertEquals(body.outcome, "renamed");
    assertEquals(body.event_seq, "12");
    assertEquals(requests.length, 1);
    assertEquals(requests[0].payload, RENAME_INPUT);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: worker route의 공통 오류는 envelope를 벗기지 않고 그대로 상태로 낸다", async () => {
  const opened = await openWorkerServer(
    new Map([
      [
        "files/rename",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async (request) =>
            errorResponse(request, "conflict", "파일이 이미 바뀌었다"),
        }),
      ],
    ]),
  );
  try {
    const response = await call(opened.base, "/v1/files/rename", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(RENAME_INPUT),
    });
    assertEquals(response.status, ERROR_HTTP_STATUS.conflict);
    const body = await response.json();
    assertEquals(body.error.code, "conflict");
    // worker 문장은 새지 않는다. 코드별 고정 message로 바꾼다(platform/api#R4).
    assertEquals(body.error.message, "대상이 이미 바뀌었다");
    assertEquals(body.error.details, undefined);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R2: file·worker route도 정확히 3구간 POST만 받는다", async () => {
  const opened = await openWorkerServer(
    new Map([
      [
        "files/read",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async () => {
            throw new Error("must not forward");
          },
        }),
      ],
      [
        "files/delete",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async () => {
            throw new Error("must not forward");
          },
        }),
      ],
    ]),
  );
  try {
    for (
      const path of [
        "/v1/files/read/extra",
        "/v1/Files/read",
        "/v2/files/read",
        "/v1/files/delete/extra",
        "/v2/files/delete",
      ]
    ) {
      const response = await call(opened.base, path, {
        method: "POST",
        token: opened.token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(FILE_TARGET),
      });
      assertEquals(response.status, 404, path);
      assertEquals((await response.json()).error.code, "not_found");
    }
    const get = await call(opened.base, "/v1/files/read", {
      method: "GET",
      token: opened.token,
    });
    assertEquals(get.status, 400);
    await get.body?.cancel();
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: worker가 없으면 unavailable이다", async () => {
  const opened = await openWorkerServer(new Map());
  try {
    const response = await call(opened.base, "/v1/files/read", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: FILE_TARGET }),
    });
    assertEquals(response.status, ERROR_HTTP_STATUS.unavailable);
    const body = await response.json();
    assertEquals(body.error.code, "unavailable");

    // 초기 404 gate는 없다. 등록된 worker kind가 없어도 입력 검사는 먼저 거친다.
    const invalid = await call(opened.base, "/v1/files/read", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wrong: "shape" }),
    });
    assertEquals(invalid.status, ERROR_HTTP_STATUS.invalid_input);
    assertEquals((await invalid.json()).error.code, "invalid_input");
  } finally {
    await opened.server.stop();
  }
});

// worker가 없거나 ready가 아니면 unavailable이다(plan platform#T12).
Deno.test("platform/api#R3: worker가 ready가 아니면 unavailable이다", async () => {
  const opened = await openWorkerServer(
    new Map([
      [
        "files/read",
        target({
          observation: () => ({
            component: "documents/worker",
            available: false,
            reason: "worker 시작 중",
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async () => {
            throw new Error("must not forward");
          },
        }),
      ],
    ]),
  );
  try {
    const response = await call(opened.base, "/v1/files/read", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: FILE_TARGET }),
    });
    assertEquals(response.status, ERROR_HTTP_STATUS.unavailable);
    const body = await response.json();
    assertEquals(body.error.code, "unavailable");
  } finally {
    await opened.server.stop();
  }
});

// 기한·응답 상한은 route마다 등록값이다(responsiveness R1, plan platform#T12).
Deno.test("platform/responsiveness#R1: 기한과 응답 상한은 route 등록값이고 초과는 unavailable이다", async () => {
  const slow = await openWorkerServer(
    new Map([
      [
        "files/read",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          forward: () => new Promise(() => {}), // 끝나지 않는다
        }, { timeoutMs: 50 }),
      ],
    ]),
  );
  try {
    const response = await call(slow.base, "/v1/files/read", {
      method: "POST",
      token: slow.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: FILE_TARGET }),
    });
    assertEquals(response.status, ERROR_HTTP_STATUS.unavailable);
    assertEquals((await response.json()).error.code, "unavailable");
  } finally {
    await slow.server.stop();
  }

  const limited = await openWorkerServer(
    new Map([
      [
        "files/read",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async (request) =>
            Promise.resolve(okResponse(request, {
              bytes: Array.from({ length: 40 }, () => 120),
            })),
        }, { responseMaxBytes: 20 }),
      ],
    ]),
  );
  try {
    const response = await call(limited.base, "/v1/files/read", {
      method: "POST",
      token: limited.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: FILE_TARGET }),
    });
    assertEquals(response.status, ERROR_HTTP_STATUS.unavailable);
    assertEquals((await response.json()).error.code, "unavailable");
  } finally {
    await limited.server.stop();
  }
});

// 사람 결정 확인은 넘기기 전에 소비한다. 넘긴 뒤 worker가 conflict를 내도 handle은 소비된 채다(ledger#R22).
Deno.test("platform/api#R3: worker route는 사람 결정 확인을 소비한 뒤 넘기고 conflict여도 handle은 소비된 채다", async () => {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const random = seededRandom(7);
  const handles = new ConfirmationRegistry({
    clock,
    random: (bytes) => random.fill(bytes),
  });
  const bridge = confirmationBridge(handles);
  const binding = await confirmationBinding(filesDelete, DELETE_INPUT);
  assert(binding !== undefined);
  const request: ConfirmationHandleRegister = {
    type: "confirmation_handle_register",
    window_id: "win-1",
    target_ref: binding.target,
    content_hash: binding.content,
    allowed_decisions: ["files.delete"],
    expires_at: new Date(Date.parse("2026-10-04T00:05:00.000Z")).toISOString(),
  };
  const issued = handles.issue(request);
  assert(issued.ok, issued.ok ? undefined : JSON.stringify(issued.error));
  let forwarded = 0;
  const opened = await openWorkerServer(
    new Map([
      [
        "files/delete",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          // deno-lint-ignore require-await -- WorkerRouteHandle.forward의 모양을 그대로 따르는 fake다.
          forward: async (workerRequest) => {
            forwarded += 1;
            return errorResponse(
              workerRequest,
              "conflict",
              "파일이 이미 바뀌었다",
            );
          },
        }),
      ],
    ]),
    bridge,
  );
  try {
    const first = await call(opened.base, "/v1/files/delete", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...DELETE_INPUT,
        confirmation: issued.value.confirmation,
      }),
    });
    assertEquals(first.status, ERROR_HTTP_STATUS.conflict);
    assertEquals(forwarded, 1);

    // handle은 소비된 채다. 같은 확인으로 다시 요청하면 forbidden이다.
    const second = await call(opened.base, "/v1/files/delete", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...DELETE_INPUT,
        confirmation: issued.value.confirmation,
      }),
    });
    assertEquals(second.status, ERROR_HTTP_STATUS.forbidden);
    assertEquals((await second.json()).error.code, "forbidden");
    assertEquals(forwarded, 1);

    // 확인 없는 요청도 forbidden이다.
    const missing = await call(opened.base, "/v1/files/delete", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(DELETE_INPUT),
    });
    assertEquals(missing.status, ERROR_HTTP_STATUS.forbidden);
    assertEquals((await missing.json()).error.code, "forbidden");
    assertEquals(forwarded, 1);
  } finally {
    await opened.server.stop();
  }
});

// scope가 files 작업 밖인 credential은 worker·file route를 치지 못한다. worker에 닿지 않는다.
Deno.test("platform/api#R2: credential scope 밖 동작은 worker에 닿지 않고 forbidden이다", async () => {
  // 같은 registry에서 scope가 files 작업 밖인 credential을 발급한다.
  const made = openRegistry();
  const issued = value(
    await made.credentials.issue({
      actor: "user",
      principal: "user",
      scope: { operations: ["identity/current"], targets: {} },
      conditions: { process: "main-generation" },
    }),
  );
  let forwarded = 0;
  const workers = new Map([
    [
      "files/read",
      target({
        observation: () => ({
          component: "documents/worker",
          available: true,
          observed_at: AT,
        }),
        forward: () => {
          forwarded += 1;
          throw new Error("must not forward");
        },
      }),
    ],
    [
      "files/delete",
      target({
        observation: () => ({
          component: "documents/worker",
          available: true,
          observed_at: AT,
        }),
        forward: () => {
          forwarded += 1;
          throw new Error("must not forward");
        },
      }),
    ],
  ]);
  // 확인 bridge는 없다. scope 검사가 먼저 막으므로 확인 없는 files.delete도 forbidden이다.
  const server = await startApiServer({
    port: 0,
    clock: made.clock,
    credentials: made.credentials,
    workers,
    registry: new RouteRegistry([...DOCUMENT_ROUTES]),
  });
  const opened = {
    server,
    base: `http://127.0.0.1:${server.port}`,
    token: issued.token,
  };
  try {
    for (
      const [path, requestBody] of [
        ["/v1/files/read", JSON.stringify({ target: FILE_TARGET })],
        ["/v1/files/delete", JSON.stringify(DELETE_INPUT)],
      ] as const
    ) {
      const response = await call(opened.base, path, {
        method: "POST",
        token: issued.token,
        headers: { "content-type": "application/json" },
        body: requestBody,
      });
      assertEquals(response.status, ERROR_HTTP_STATUS.forbidden, path);
      assertEquals((await response.json()).error.code, "forbidden");
    }
    assertEquals(forwarded, 0);
  } finally {
    await opened.server.stop();
  }
});

// file route도 사람 결정 확인의 binding이 등록 내용과 다르면 worker를 부르지 않는다.
Deno.test("platform/api#R3: file route는 확인 binding이 다르면 worker를 부르지 않고 forbidden이다", async () => {
  // documents agreement에는 confirmation이 필요한 file kind route가 없다. 같은 모양의
  // review file route를 따로 등록한다. binding은 request_key·target·base_hash다.
  const reviewFile = defineFile({
    resource: "files",
    method: "review",
    name: "files.review",
    input: z.strictObject({
      request_key: z.string().min(1),
      target: z.unknown(),
      base_hash: z.string(),
    }),
    contentType: "application/octet-stream",
    actors: ["user"] as const,
    errors: ["invalid_input", "forbidden", "not_found", "unavailable"] as const,
    confirmation: "required",
    binding: ["request_key", "target", "base_hash"],
  });
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const random = seededRandom(7);
  const handles = new ConfirmationRegistry({
    clock,
    random: (bytes) => random.fill(bytes),
  });
  const bridge = confirmationBridge(handles);
  const binding = await confirmationBinding(reviewFile, DELETE_INPUT);
  assert(binding !== undefined);
  const request: ConfirmationHandleRegister = {
    type: "confirmation_handle_register",
    window_id: "win-1",
    target_ref: binding.target,
    content_hash: binding.content,
    allowed_decisions: ["files.review"],
    expires_at: new Date(Date.parse("2026-10-04T00:05:00.000Z")).toISOString(),
  };
  const issued = handles.issue(request);
  assert(issued.ok, issued.ok ? undefined : JSON.stringify(issued.error));
  let forwarded = 0;
  const made = openRegistry();
  const issuedToken = value(await made.credentials.issue(USER)).token;
  const server = await startApiServer({
    port: 0,
    clock: made.clock,
    credentials: made.credentials,
    workers: new Map([
      [
        "files/review",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          forward: () => {
            forwarded += 1;
            throw new Error("must not forward");
          },
        }),
      ],
    ]),
    confirmation: bridge,
    registry: new RouteRegistry([reviewFile]),
  });
  try {
    // 등록된 handle은 DELETE_INPUT에 묶였다. base_hash가 다른 입력은 binding이 다르다.
    const response = await call(
      `http://127.0.0.1:${server.port}`,
      "/v1/files/review",
      {
        method: "POST",
        token: issuedToken,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...DELETE_INPUT,
          base_hash: "b".repeat(64),
          confirmation: issued.value.confirmation,
        }),
      },
    );
    assertEquals(response.status, ERROR_HTTP_STATUS.forbidden);
    assertEquals((await response.json()).error.code, "forbidden");
    assertEquals(forwarded, 0);
  } finally {
    await server.stop();
  }
});
