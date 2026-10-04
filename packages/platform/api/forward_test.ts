import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, type Result, seededRandom } from "../../base/mod.ts";
import {
  type ConfirmationHandleRegister,
  ERROR_HTTP_STATUS,
  type WorkerRequest,
  type WorkerResponse,
} from "../../contracts/platform/mod.ts";
import {
  filesDelete,
  ROUTES as DOCUMENT_ROUTES,
} from "../../contracts/documents/mod.ts";
import {
  confirmationBinding,
  type ConfirmationBridge,
  confirmationBridge,
  ConfirmationRegistry,
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "../identity/mod.ts";
import {
  type WorkerRouteHandle,
  type WorkerRouteLimits,
  type WorkerRouteTarget as ResponsivenessTarget,
} from "../responsiveness/mod.ts";
import { startApiServer } from "./mod.ts";
import { RouteRegistry } from "./routes.ts";
import { call, value } from "./harness_test.ts";

const AT = "2026-10-04T00:00:00.000Z";

// 기본 harness USER(actor user, scope identity/current)는 files route를 못 쓴다.
// files.read·files.delete 작업이 scope에 있는 credential을 따로 발급한다.
const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: { operations: ["files.read", "files.delete"], targets: {} },
  conditions: { process: "main-generation" },
};

const POLICIES: OperationPolicy[] = [
  { name: "files.read", actors: ["user"], kind: "read" },
  { name: "files.delete", actors: ["user"], kind: "read" },
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

// filesRead�� file kind다. dispatch는 ledger queue 없이 감독 pipe 통로로 넘긴다.
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
    assertEquals(body.error.message, "파일이 없다");
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
    assertEquals(body.error.message, "파일이 이미 바뀌었다");
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
