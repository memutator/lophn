// document.prepare worker route를 in-process assembly로 돌리는 API 통합 테스트.
// core harness에는 workers injection이 없어 workers map을 직접 넣는다(forward_test.ts의
// worker route 테스트와 같은 길이다).
import { assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../../../base/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../../protocol/supervision/mod.ts";
import { DOCUMENT_ROUTES } from "../../../../protocol/projects/mod.ts";
import {
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "../../../server/identity/mod.ts";
import {
  type WorkerRouteHandle,
  type WorkerRouteTarget as ResponsivenessTarget,
} from "../../../supervision/responsiveness/mod.ts";
import { startApiServer } from "../../../server/mod.ts";
import { RouteRegistry } from "../../../server/routes.ts";
import { call, value } from "../../../server/harness_test.ts";
import {
  createPrepareAssembly,
  type PrepareDeps,
} from "../../versions/work.ts";

const AT = "2026-10-04T00:00:00.000Z";
const BUILTIN_MODULE_HASH =
  "859415856f59662c5bcdfc30adf2677d9fc296b193c7137fece8f5385e02f9d8";
const HASH = "ab".repeat(32);

const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: {
    operations: ["document.prepare", "identity/current"],
    targets: {},
  },
  conditions: { process: "main-generation" },
};

const POLICIES: OperationPolicy[] = [
  { name: "document.prepare", actors: ["user"], kind: "read" },
  { name: "document.save", actors: ["user"], kind: "command" },
  { name: "identity/current", actors: ["user"], kind: "read" },
];

function target(
  handle: WorkerRouteHandle,
): ResponsivenessTarget {
  return { handle };
}

function assemblyDeps(): PrepareDeps {
  return {
    // deno-lint-ignore require-await -- ValidatePort의 모양을 그대로 따르는 fake다.
    validateFiles: async () =>
      ok({
        input_hash: HASH,
        module_hash: BUILTIN_MODULE_HASH,
        status: "passed",
        error_count: 0,
        warning_count: 0,
        diagnostics: [],
      }),
    // deno-lint-ignore require-await -- PrepareFilesPort의 모양을 그대로 따르는 fake다.
    prepareFiles: async () =>
      ok({ preparation: "pack-1", hash: HASH, size_bytes: 12 }),
    // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
    loadBaseVersion: async () => ok(null),
  };
}

function openWorkerServer(workers: Map<string, ResponsivenessTarget>) {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const credentials = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random: seededRandom(5),
    operations: POLICIES,
  });
  return {
    clock,
    credentials,
    async server() {
      const started = await startApiServer({
        port: 0,
        clock,
        credentials,
        workers,
        registry: new RouteRegistry([...DOCUMENT_ROUTES]),
      });
      return {
        server: started,
        base: `http://127.0.0.1:${started.port}`,
        token: value(await credentials.issue(USER)).token,
      };
    },
  };
}

async function start(
  workers: Map<string, ResponsivenessTarget>,
) {
  const opened = openWorkerServer(workers);
  const made = await opened.server();
  return { ...made, close: () => made.server.stop() };
}

Deno.test("documents/formats#R4: worker route는 assembly를 envelope로 부르고 준비 결과를 200으로 돌려준다", async () => {
  const requests: WorkerRequest[] = [];
  const prepare = createPrepareAssembly(assemblyDeps());
  const made = await start(
    new Map([
      [
        "documents/prepare",
        target({
          observation: () => ({
            component: "documents/prepare",
            available: true,
            observed_at: AT,
          }),
          forward: async (request) => {
            requests.push(request);
            assertEquals(request.type, "worker_request");
            assertEquals(request.op, "document.prepare");
            const payload = request.payload as { idempotency_key: string };
            assertEquals(payload["idempotency_key"], "prepare-save-1");
            // envelope를 벗기고 assembly를 부른 뒤 worker_response로 되돌린다.
            const ran = await prepare(
              request.payload as Parameters<typeof prepare>[0],
            );
            if (!ran.ok) {
              const failed: WorkerResponse = {
                type: "worker_response",
                request_id: request.request_id,
                ok: false,
                error: { code: "invalid_input", message: ran.error.message },
              };
              return ok(failed);
            }
            return ok(
              {
                type: "worker_response",
                request_id: request.request_id,
                ok: true,
                payload: ran.value,
              } satisfies WorkerResponse,
            );
          },
        }),
      ],
    ]),
  );
  try {
    // 호출자 자격(user)으로 파일 목록·대표 파일·내용 참조·FormatRef·idempotency key를 받는다.
    const answer = await call(made.base, "/v1/documents/prepare", {
      method: "POST",
      token: made.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document: "doc_01arz3ndektsv4rrffq69g5fav",
        base_version: null,
        metadata: { title: "보고서", place: null, name: "report" },
        files: [{
          path: "docs/report.md",
          blob_hash: HASH,
          bytes: 12,
          media_type: "text/markdown",
          primary: true,
          content: {
            kind: "prepared",
            blob: {
              preparation: "blob-prep",
              principal: "user",
              purpose: "document_file",
              hash: HASH,
              size_bytes: 12,
            },
          },
        }],
        format: {
          name: "document",
          module_hash: BUILTIN_MODULE_HASH,
          explicit: true,
        },
        file_basis: {
          kind: "project_file",
          project: "prj_01arz3ndektsv4rrffq69g5fav",
          path: "/work/docs/report.md",
          project_revision: "4",
          file_source: null,
          original_hash: HASH,
          observed_at: AT,
        },
        source: {
          kind: "file",
          project: "prj_01arz3ndektsv4rrffq69g5fav",
          path: "/work/docs/report.md",
          original_hash: HASH,
          observed_at: AT,
        },
        idempotency_key: "prepare-save-1",
      }),
    });
    assertEquals(answer.status, 200);
    const payload = await answer.json();
    const validation = payload["validation"] as { status: string };
    assertEquals(validation["status"], "passed");
    assertEquals(payload["document"], "doc_01arz3ndektsv4rrffq69g5fav");
    assertEquals(payload["preparation_ref"], "pack-1");
    assertEquals(payload["format"], {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit: true,
    });
  } finally {
    made.close();
  }
});

Deno.test("documents/formats#R5: 미지정 새 문서는 MIME 기본 format으로 준비된다", async () => {
  const prepare = createPrepareAssembly(assemblyDeps());
  const made = await start(
    new Map([
      [
        "documents/prepare",
        target({
          observation: () => ({
            component: "documents/prepare",
            available: true,
            observed_at: AT,
          }),
          forward: async (request) => {
            const ran = await prepare(
              request.payload as Parameters<typeof prepare>[0],
            );
            if (!ran.ok) {
              return ok(
                {
                  type: "worker_response",
                  request_id: request.request_id,
                  ok: false,
                  error: { code: "invalid_input", message: ran.error.message },
                } satisfies WorkerResponse,
              );
            }
            return ok(
              {
                type: "worker_response",
                request_id: request.request_id,
                ok: true,
                payload: ran.value,
              } satisfies WorkerResponse,
            );
          },
        }),
      ],
    ]),
  );
  try {
    const answer = await call(made.base, "/v1/documents/prepare", {
      method: "POST",
      token: made.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document: "doc_01arz3ndektsv4rrffq69g5fav",
        base_version: null,
        metadata: { title: "보고서", place: null, name: "report" },
        files: [{
          path: "docs/report.md",
          blob_hash: HASH,
          bytes: 12,
          media_type: "text/markdown",
          primary: true,
          content: {
            kind: "prepared",
            blob: {
              preparation: "blob-prep",
              principal: "user",
              purpose: "document_file",
              hash: HASH,
              size_bytes: 12,
            },
          },
        }],
        // format 생략. owner worker가 MIME 기본 implicit contract를 골라 반환한다.
        source: null,
        idempotency_key: "prepare-save-1",
      }),
    });
    assertEquals(answer.status, 200);
    const payload = await answer.json();
    assertEquals(payload["format"], {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit: false,
    });
  } finally {
    made.close();
  }
});
