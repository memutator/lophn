// documents/file-tracking#R9: core가 pipe로 묻는 FileStatus 요청을 coordinator 메모리로 답한다.
import { assert, assertEquals } from "@std/assert";
import {
  createStatusRecorder,
  DOCUMENT_OPS,
  VALIDATE_INPUT_MAX_BYTES,
} from "../../../packages/documents/file-tracking/mod.ts";
import { createRequestHandler, type RequestDeps } from "./requests.ts";
import { createBasisStore } from "./basis.ts";
import { err, ok } from "../../../packages/base/mod.ts";

const TARGET = {
  kind: "project_file" as const,
  project: "prj_01arz3ndektsv4rrffq69g5fav",
  path: "/work/a.md",
};

function deps(
  status: ReturnType<typeof createStatusRecorder>,
  validate?: RequestDeps["validate"],
): RequestDeps {
  return {
    status,
    basis: createBasisStore(),
    validate: validate ??
      (() => Promise.resolve(err({ code: "unavailable", message: "none" }))),
  };
}

function request(op: string, payload: unknown) {
  return {
    type: "worker_request" as const,
    request_id: "r-1",
    op,
    payload,
  };
}

Deno.test("documents/file-tracking#R9: 보고한 관측을 같은 request_id로 답하고 없으면 null이다", async () => {
  const status = createStatusRecorder();
  const handle = createRequestHandler(deps(status));
  const none = await handle(request(DOCUMENT_OPS.fileStatus, TARGET));
  assert(none.ok);
  assertEquals((none.payload as { observation: unknown }).observation, null);
  status.report(TARGET, {
    tracked: true,
    missing: false,
    unverified: false,
    validationFailed: false,
    observedHash: "ab".repeat(32),
    latestHash: null,
    observedAt: "2026-10-06T00:00:00.000Z",
    comparedVersion: null,
    projectRevision: "1",
    details: null,
  });
  const found = await handle(request(DOCUMENT_OPS.fileStatus, TARGET));
  assert(found.ok);
  assertEquals(found.request_id, "r-1");
  assertEquals(
    (found.payload as { observation: { observedHash: string } }).observation
      .observedHash,
    "ab".repeat(32),
  );
});

Deno.test("documents/file-tracking#R9: 잘못된 대상과 모르는 op는 invalid_input이다", async () => {
  const handle = createRequestHandler(deps(createStatusRecorder()));
  const bad = await handle(request(DOCUMENT_OPS.fileStatus, { kind: "x" }));
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
  const unknown = await handle(request("documents.nope", {}));
  assert(!unknown.ok);
  assertEquals(unknown.error.code, "invalid_input");
});

Deno.test("documents/file-tracking#R3: core가 보낸 관측 근거 조각은 마지막 조각에서 반영된다", async () => {
  const basis = createBasisStore();
  const handle = createRequestHandler({
    ...deps(createStatusRecorder()),
    basis,
  });
  const root = {
    root: "/work",
    project: "prj_01arz3ndektsv4rrffq69g5fav",
    project_revision: "2",
    patterns: [{ effect: "include", glob: "**/*.md" }],
    use_gitignore: false,
  };
  const first = await handle(request(DOCUMENT_OPS.observationBasis, {
    begin: true,
    full: true,
    roots: [root],
    upsert: [],
    remove: [],
    more: true,
  }));
  assert(first.ok);
  assertEquals((first.payload as { committed: boolean }).committed, false);
  // 마지막 조각 전에는 반영되지 않는다.
  assertEquals(basis.roots().length, 0);
  const last = await handle(request(DOCUMENT_OPS.observationBasis, {
    begin: false,
    full: true,
    roots: null,
    upsert: [],
    remove: [],
    more: false,
  }));
  assert(last.ok);
  assertEquals((last.payload as { committed: boolean }).committed, true);
  assertEquals(basis.roots().map((entry) => entry.root), ["/work"]);
});

Deno.test("documents/file-tracking#R3: 모양이 틀리거나 시작 없는 근거 조각은 반영하지 않는다", async () => {
  const basis = createBasisStore();
  const handle = createRequestHandler({
    ...deps(createStatusRecorder()),
    basis,
  });
  const malformed = await handle(
    request(DOCUMENT_OPS.observationBasis, { begin: true }),
  );
  assert(!malformed.ok);
  assertEquals(malformed.error.code, "invalid_input");
  const orphan = await handle(request(DOCUMENT_OPS.observationBasis, {
    begin: false,
    full: false,
    roots: null,
    upsert: [],
    remove: [],
    more: false,
  }));
  assert(!orphan.ok);
  assertEquals(orphan.error.code, "invalid_input");
  assertEquals(basis.version, 0);
});

const VALIDATE_BODY = {
  files: [{
    path: "a.md",
    media_type: "text/markdown",
    primary: true,
    bytes: 3,
    blob_hash: "cd".repeat(32),
    channel: 1,
  }],
  format: { name: "document", module_hash: "ab".repeat(32), explicit: false },
};

Deno.test("documents/formats#R4: 준비 route의 format 검사 요청은 runner 결과를 그대로 답한다", async () => {
  const seen: unknown[] = [];
  const handle = createRequestHandler(
    deps(createStatusRecorder(), (asked) => {
      seen.push(asked);
      return Promise.resolve(ok({ status: "passed" }));
    }),
  );
  const answered = await handle(
    request(DOCUMENT_OPS.validateFiles, VALIDATE_BODY),
  );
  assert(answered.ok);
  assertEquals(answered.payload, { status: "passed" });
  assertEquals(seen.length, 1);
});

Deno.test("documents/formats#R4: runner가 실패하면 통과로 꾸미지 않고 unavailable이다", async () => {
  const handle = createRequestHandler(
    deps(
      createStatusRecorder(),
      () => Promise.resolve(err({ code: "unavailable", message: "crashed" })),
    ),
  );
  const answered = await handle(
    request(DOCUMENT_OPS.validateFiles, VALIDATE_BODY),
  );
  assert(!answered.ok);
  assertEquals(answered.error.code, "unavailable");
  const invalid = await handle(request(DOCUMENT_OPS.validateFiles, {}));
  assert(!invalid.ok);
  assertEquals(invalid.error.code, "invalid_input");
});

Deno.test("documents/formats#R4: 검사 요청이 대표 파일 1 MiB 한도를 넘으면 거절하고 바이트를 보내지 않은 큰 첨부는 한도에 들지 않는다", async () => {
  const handle = createRequestHandler(
    deps(
      createStatusRecorder(),
      () => Promise.resolve(ok({ status: "passed" })),
    ),
  );
  const over = await handle(request(DOCUMENT_OPS.validateFiles, {
    ...VALIDATE_BODY,
    files: [{ ...VALIDATE_BODY.files[0], bytes: VALIDATE_INPUT_MAX_BYTES + 1 }],
  }));
  assert(!over.ok);
  assertEquals(over.error.code, "invalid_input");
  const withAttachment = await handle(request(DOCUMENT_OPS.validateFiles, {
    ...VALIDATE_BODY,
    files: [VALIDATE_BODY.files[0], {
      path: "big.png",
      media_type: "image/png",
      primary: false,
      bytes: 64 * 1024 * 1024,
      blob_hash: "ef".repeat(32),
      channel: null,
    }],
  }));
  assert(withAttachment.ok);
});

Deno.test("documents/formats#R4: runner가 invalid_input으로 답하면 그 code를 unavailable로 낮추지 않는다", async () => {
  const handle = createRequestHandler(
    deps(
      createStatusRecorder(),
      () =>
        Promise.resolve(err({ code: "invalid_input", message: "too large" })),
    ),
  );
  const answered = await handle(
    request(DOCUMENT_OPS.validateFiles, VALIDATE_BODY),
  );
  assert(!answered.ok);
  assertEquals(answered.error.code, "invalid_input");
});
