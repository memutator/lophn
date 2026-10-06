// documents/formats#R6, documents/file-tracking#R15: 사람 파일 route의 단계 분리. core가 판 확정을
// 따로 시도해 실패해도 이미 성공한 파일 쓰기를 취소하거나 이전 내용으로 바꾸지 않는다. 요청을
// 받는 쪽(coordinator)·판 확정·검사는 모두 대역이고 실제 통로는 documents-files_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type FileOperationResult,
  filesWrite,
} from "../../packages/contracts/documents/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../packages/contracts/platform/mod.ts";
import { DOCUMENT_OPS } from "../../packages/documents/file-tracking/mod.ts";
import { type FilesRouteDeps, fileWorkers } from "./documents-files.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const BASE = "ver_01kq12a1pha000000000000001";
const SAVED = "ver_01kq12a1pha000000000000002";
const HASH = "ab".repeat(32);
const BLOB = {
  preparation: "prep-1",
  principal: "person",
  purpose: "document_file",
  hash: HASH,
  size_bytes: 3,
};

const WRITTEN: FileOperationResult = {
  request_key: "key-1",
  operation: "write",
  target: { kind: "working_copy", document: DOC },
  outcome: "written",
  before_path: null,
  after_path: "/data/documents/working-copies/doc/content",
  before_hash: null,
  written_hash: HASH,
  observed_hash: HASH,
  observed_at: "2026-10-06T00:00:00.000Z",
  changed_again: false,
  recording: "recorded",
  event_seq: "7",
  version_result: "preparing",
};

type Fake = {
  deps: FilesRouteDeps;
  requests: string[];
  prepared: unknown[];
};

type FakeOptions = {
  prepare?: Result<WorkerResponse>;
  save?: Result<unknown>;
  eligible?: boolean;
  principal?: string | undefined;
  live?: boolean;
  written?: FileOperationResult;
};

function fake(over: FakeOptions = {}): Fake {
  const requests: string[] = [];
  const prepared: unknown[] = [];
  const deps: FilesRouteDeps = {
    request(op) {
      requests.push(op);
      return Promise.resolve(
        op === DOCUMENT_OPS.fileWrite
          ? ok(over.written ?? WRITTEN)
          : ok({ confirmed: true }),
      );
    },
    bound: () => true,
    readBlob: (_hash, _offset, length) =>
      Promise.resolve(ok({
        hash: HASH,
        sizeBytes: 3,
        bytes: new Uint8Array(Math.min(length, 3)),
      })),
    sendBytes: () => Promise.resolve(true),
    principalOf: () => "principal" in over ? over.principal : "person",
    live: () => over.live ?? true,
    copyCheck: () =>
      Promise.resolve(ok({
        eligible: over.eligible ?? true,
        latest_version: BASE,
        base: {
          version: BASE,
          primary_path: "note.md",
          media_type: "text/markdown",
          confirmed_hash: "cd".repeat(32),
        },
      })),
    version: {
      prepare: (_request, payload) => {
        prepared.push(payload);
        return Promise.resolve(
          over.prepare ?? ok({
            type: "worker_response",
            request_id: "cred/1",
            ok: true,
            payload: {
              preparation_ref: "ref",
              files: [{ preparation_ref: "f" }],
            },
          }),
        );
      },
      save: () =>
        Promise.resolve(
          over.save ?? ok({
            result: {
              status: "saved",
              document: DOC,
              version: SAVED,
              reference: { document: DOC, version: SAVED, section: null },
              warnings: [],
              event_seq: "9",
            },
          }),
        ),
    },
    observedAt: () => "2026-10-06T00:00:00.000Z",
  };
  return { deps, requests, prepared };
}

async function write(fakeDeps: Fake, input: Record<string, unknown> = {}) {
  const route = fileWorkers(fakeDeps.deps).get("files/write")!;
  const request: WorkerRequest = {
    type: "worker_request",
    request_id: "cred/1",
    op: filesWrite.name,
    payload: {
      request_key: "key-1",
      target: { kind: "working_copy", document: DOC },
      base_hash: null,
      content: { kind: "prepared", blob: BLOB },
      version_request: {
        document: DOC,
        base_version: BASE,
        idempotency_key: "version-key",
      },
      ...input,
    },
  };
  const answer = await route.handle.forward(request);
  assert(answer.ok);
  return answer.value;
}

function result(answer: WorkerResponse): FileOperationResult {
  assert(answer.ok);
  return answer.payload as FileOperationResult;
}

Deno.test("documents/formats#R6: 지정 format 검사가 실패해도 파일 쓰기는 성공으로 남고 이전 내용으로 되돌리는 요청이 없다", async () => {
  const subject = fake({
    prepare: ok({
      type: "worker_response",
      request_id: "cred/1",
      ok: false,
      error: { code: "invalid_input", message: "format error" },
    }),
  });
  const done = result(await write(subject));
  assertEquals(done.outcome, "written");
  assertEquals(done.recording, "recorded");
  assertEquals(done.version_result, "validation_failed");
  // 파일 쓰기 요청 하나뿐이다. 되돌리기·삭제·재쓰기 요청이 없다.
  assertEquals(subject.requests, [DOCUMENT_OPS.fileWrite]);
});

Deno.test("documents/file-tracking#R15: 판 확정의 conflict·일시 실패는 각각 conflict·preparing이고 파일 결과는 그대로다", async () => {
  const conflicted = result(
    await write(fake({
      prepare: ok({
        type: "worker_response",
        request_id: "cred/1",
        ok: false,
        error: { code: "conflict", message: "base changed" },
      }),
    })),
  );
  assertEquals(conflicted.version_result, "conflict");
  assertEquals(conflicted.outcome, "written");

  const saveConflict = result(
    await write(fake({ save: err({ code: "conflict", message: "stale" }) })),
  );
  assertEquals(saveConflict.version_result, "conflict");
  assertEquals(saveConflict.outcome, "written");

  const unavailable = result(
    await write(fake({
      save: err({ code: "unavailable", message: "writer down" }),
    })),
  );
  assertEquals(unavailable.version_result, "preparing");
  assertEquals(unavailable.outcome, "written");
  assertEquals(unavailable.recording, "recorded");
});

Deno.test("documents/file-tracking#R15: 판이 확정되면 확정 결과와 save_result를 따로 담고 사본 metadata를 갱신한다", async () => {
  const subject = fake();
  const done = result(await write(subject));
  assertEquals(done.version_result, "confirmed");
  assertEquals(
    (done.save_result as { version: string }).version,
    SAVED,
  );
  assertEquals(subject.requests, [
    DOCUMENT_OPS.fileWrite,
    DOCUMENT_OPS.workingCopyConfirm,
  ]);
  // 판 준비는 업로드한 원문의 blob과 연 판의 대표 파일 경로로 한다.
  const body = subject.prepared[0] as {
    base_version: string;
    source: null;
    files: { path: string; blob_hash: string }[];
  };
  assertEquals(body.base_version, BASE);
  assertEquals(body.source, null);
  assertEquals(body.files[0].path, "note.md");
  assertEquals(body.files[0].blob_hash, HASH);
});

Deno.test("documents/file-tracking#R15: 파일이 성공이 아니면(unverified) 판 확정을 시도하지 않는다", async () => {
  const subject = fake({
    written: {
      ...WRITTEN,
      outcome: "unverified",
      recording: "unverified",
      event_seq: null,
    },
  });
  const done = result(await write(subject));
  assertEquals(done.outcome, "unverified");
  assertEquals(subject.prepared.length, 0);
});

Deno.test("documents/file-tracking#R2 documents/file-tracking#R1: 남의 준비 blob·만기 blob·원본 연결 문서·instruction 목표는 coordinator에 닿기 전에 같은 invalid_input이다", async () => {
  const attempts: [string, FakeOptions, Record<string, unknown>][] = [
    ["foreign blob", { principal: "someone-else" }, {}],
    ["expired blob", { live: false }, {}],
    ["linked document", { eligible: false }, {}],
    [
      "existing source",
      {},
      {
        content: {
          kind: "existing",
          reference: {
            owner_kind: "document_version",
            owner_key: "x",
            field: "file",
            hash: HASH,
            registered_seq: "1",
          },
        },
      },
    ],
    [
      "instruction target",
      {},
      {
        target: {
          kind: "instruction_file",
          instruction_target: "ins_01kq12a1pha000000000000000",
          project: null,
          path: "/data/LOPHN.md",
        },
      },
    ],
    [
      "copy with a stranger's version request",
      {},
      {
        version_request: {
          document: "doc_01kq12a1pha000000000000009",
          base_version: BASE,
          idempotency_key: "k",
        },
      },
    ],
  ];
  const messages = new Set<string>();
  for (const [name, options, input] of attempts) {
    const subject = fake(options);
    const answer = await write(subject, input);
    assert(!answer.ok, name);
    assertEquals(answer.error.code, "invalid_input", name);
    messages.add(answer.error.message);
    assertEquals(subject.requests, [], name);
  }
  assertEquals(messages.size, 1);
});

Deno.test("documents/file-tracking#R2: credential이 없는 요청은 unauthorized다", async () => {
  const answer = await write(fake({ principal: undefined }));
  assert(!answer.ok);
  assertEquals(answer.error.code, "unauthorized");
});
