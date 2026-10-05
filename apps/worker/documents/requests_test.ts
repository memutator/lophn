// documents/file-tracking#R9: core가 pipe로 묻는 FileStatus 요청을 coordinator 메모리로 답한다.
import { assert, assertEquals } from "@std/assert";
import {
  createStatusRecorder,
  DOCUMENT_OPS,
} from "../../../packages/documents/file-tracking/mod.ts";
import { createRequestHandler } from "./requests.ts";

const TARGET = {
  kind: "project_file" as const,
  project: "prj_01arz3ndektsv4rrffq69g5fav",
  path: "/work/a.md",
};

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
  const handle = createRequestHandler({ status });
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
  const handle = createRequestHandler({ status: createStatusRecorder() });
  const bad = await handle(request(DOCUMENT_OPS.fileStatus, { kind: "x" }));
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
  const unknown = await handle(request("documents.nope", {}));
  assert(!unknown.ok);
  assertEquals(unknown.error.code, "invalid_input");
});
