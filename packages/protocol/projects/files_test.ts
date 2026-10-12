import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import {
  doc,
  fileInput,
  hash,
  key,
  otherHash,
  project,
  saved,
  version,
} from "./document-fixtures.ts";
import {
  FILE_EVENTS,
  FILE_ROUTES,
  fileDeleted,
  fileRecordResult,
  fileRenamed,
  filesDelete,
  filesList,
  filesRead,
  filesRename,
  filesStatus,
  filesWatch,
  filesWrite,
  fileWritten,
} from "./files.ts";
import {
  FILE_OPERATION_OUTCOMES,
  FILE_STATUS_STATES,
  FILE_VERSION_RESULTS,
  fileOperationResultSchema,
  fileStatusSchema,
  fileTargetSchema,
  fileWriteRequestSchema,
} from "./file-values.ts";

const at = "2026-10-04T00:00:00.000Z";
const path = "/work/docs/report.md";
const projectTarget = { kind: "project_file" as const, project, path };
const workingCopy = { kind: "working_copy" as const, document: doc };
const instructionTarget = {
  kind: "instruction_file" as const,
  instruction_target: "global:LOPHN.md",
  project: null,
  path: "/home/owner/.lophn/LOPHN.md",
};

const writeRequest = {
  request_key: key,
  target: projectTarget,
  base_hash: otherHash,
  content: fileInput.content,
};

const written = {
  request_key: key,
  operation: "write" as const,
  target: projectTarget,
  outcome: "written" as const,
  before_path: path,
  after_path: path,
  before_hash: otherHash,
  written_hash: hash,
  observed_hash: hash,
  observed_at: at,
  changed_again: false,
  recording: "recorded" as const,
  event_seq: "12",
  version_result: "not_requested" as const,
};

Deno.test("documents/file-tracking#R2: file routes match the architecture table and only the person uses them", () => {
  assertEquals(FILE_ROUTES.map(routePath), [
    "/v1/files/list",
    "/v1/files/read",
    "/v1/files/status",
    "/v1/files/watch",
    "/v1/files/write",
    "/v1/files/rename",
    "/v1/files/delete",
    "/v1/files/record_result",
  ]);
  assertEquals(FILE_ROUTES.map((route) => route.name), [
    "files.list",
    "files.read",
    "files.status",
    "files.watch",
    "files.write",
    "files.rename",
    "files.delete",
    "file.record_result",
  ]);
  assertEquals(filesRead.kind, "file");
  assertEquals(fileRecordResult.kind, "command");
  assertEquals(filesWrite.kind, "worker");
  for (const route of FILE_ROUTES) {
    assertEquals(ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(
      [...route.actors],
      route === fileRecordResult ? ["machine"] : ["user"],
    );
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
  assertEquals(FILE_EVENTS.map((event) => event.type), [
    "FileWritten",
    "FileRenamed",
    "FileDeleted",
  ]);
  for (const event of FILE_EVENTS) {
    assertEquals(EVENTS.filter((entry) => entry === event).length, 1);
  }
});

Deno.test("documents/file-tracking#R9: file status keeps the six computed states and a compared version", () => {
  assertEquals([...FILE_STATUS_STATES], [
    "not_tracked",
    "tracked",
    "version_pending",
    "validation_failed",
    "source_missing",
    "unverified",
  ]);
  const status = {
    state: "version_pending" as const,
    target: projectTarget,
    observed_at: at,
    observed_hash: hash,
    compared_version: "ver_01arz3ndektsv4rrffq69g5fav",
    project_revision: "4",
    details: null,
  };
  assert(fileStatusSchema.safeParse(status).success);
  assert(filesStatus.input.safeParse({ target: projectTarget }).success);
  assert(
    filesStatus.output.safeParse({
      status,
      as_of_seq: "8",
      next_cursor: null,
    }).success,
  );
  assert(!fileStatusSchema.safeParse({ ...status, state: "conflict" }).success);
  assert(!fileStatusSchema.safeParse({ ...status, state: "missing" }).success);
});

Deno.test("documents/file-tracking#R11: a write names its target and the hash from before the edit", () => {
  assert(fileWriteRequestSchema.safeParse(writeRequest).success);
  assert(
    fileWriteRequestSchema.safeParse({ ...writeRequest, base_hash: null })
      .success,
  );
  assert(filesWrite.input.safeParse(writeRequest).success);
  assert(
    filesRename.input.safeParse({
      request_key: key,
      target: projectTarget,
      path: "/work/docs/renamed.md",
      base_hash: otherHash,
    }).success,
  );
  assert(
    !fileWriteRequestSchema.safeParse({ ...writeRequest, extra: true }).success,
  );
  assert(
    !fileWriteRequestSchema.safeParse({ ...writeRequest, base_hash: "ABC" })
      .success,
  );
  assert(
    !fileTargetSchema.safeParse({ ...projectTarget, document: doc }).success,
  );
  assert(!fileTargetSchema.safeParse({ kind: "project_file", path }).success);
  assert(!fileTargetSchema.safeParse({ kind: "working_copy" }).success);
});

Deno.test("documents/file-tracking#R15: file, recording and version results stay independent", () => {
  assertEquals([...FILE_OPERATION_OUTCOMES], [
    "written",
    "renamed",
    "deleted",
    "unverified",
  ]);
  assertEquals([...FILE_VERSION_RESULTS], [
    "not_requested",
    "preparing",
    "validation_failed",
    "conflict",
    "confirmed",
  ]);
  assert(fileOperationResultSchema.safeParse(written).success);
  assert(
    fileOperationResultSchema.safeParse({
      ...written,
      version_result: "validation_failed",
    }).success,
  );
  assert(
    fileOperationResultSchema.safeParse({
      ...written,
      version_result: "confirmed",
      save_result: saved,
    }).success,
  );
  assert(
    !fileOperationResultSchema.safeParse({
      ...written,
      recording: "recorded",
      event_seq: null,
    }).success,
  );
  assert(
    !fileOperationResultSchema.safeParse({
      ...written,
      version_result: "confirmed",
    }).success,
  );
  assert(
    !fileOperationResultSchema.safeParse({
      ...written,
      observed_hash: hash,
      changed_again: null,
    }).success,
  );
  assert(filesWrite.output.safeParse(written).success);
  assert(fileRecordResult.input.safeParse(written).success);
});

Deno.test("documents/file-tracking#R16: file events keep only the path and the hash", () => {
  assert(
    fileWritten.payload.safeParse({
      path,
      before_hash: otherHash,
      after_hash: hash,
    }).success,
  );
  assert(
    fileWritten.payload.safeParse({ path, before_hash: null, after_hash: hash })
      .success,
  );
  assert(
    fileRenamed.payload.safeParse({
      before_path: path,
      after_path: "/work/docs/renamed.md",
      before_hash: otherHash,
      after_hash: hash,
    }).success,
  );
  assert(
    fileDeleted.payload.safeParse({
      path,
      before_hash: otherHash,
      after_hash: null,
    })
      .success,
  );
  assert(
    !fileDeleted.payload.safeParse({
      path,
      before_hash: otherHash,
      after_hash: hash,
    })
      .success,
  );
  assert(fileWritten.subject.safeParse(project).success);
  assert(fileWritten.subject.safeParse(doc).success);
  assert(!fileWritten.subject.safeParse("notes/a.md").success);
});

Deno.test("documents/file-tracking#R2: delete registers the owner decision and the other file routes do not", () => {
  assertEquals(filesDelete.confirmation, "required");
  assertEquals(filesDelete.display_read, "/v1/files/status");
  assertEquals([...(filesDelete.binding ?? [])], [
    "request_key",
    "target",
    "base_hash",
  ]);
  for (
    const route of [
      filesList,
      filesRead,
      filesStatus,
      filesWatch,
      filesWrite,
      filesRename,
      fileRecordResult,
    ]
  ) {
    assertEquals(route.confirmation, undefined);
  }
  assert(
    filesDelete.input.safeParse({
      request_key: key,
      target: workingCopy,
      base_hash: hash,
    }).success,
  );
  assert(filesRead.input.safeParse({ target: instructionTarget }).success);
  assert(filesList.input.safeParse({}).success);
  assert(filesWatch.input.safeParse({ target: workingCopy }).success);
  assert(!filesList.input.safeParse({ project: "project-1" }).success);
  assert(
    !filesRead.input.safeParse({ target: { kind: "disk", path } }).success,
  );
});

const existingContent = {
  kind: "existing" as const,
  reference: {
    owner_kind: "document_version",
    owner_key: `${version}/report.md`,
    field: "file",
    hash,
    registered_seq: "7",
  },
};
const placeWrite = {
  request_key: key,
  target: projectTarget,
  base_hash: null,
  content: existingContent,
  place: { document: doc, version },
};

Deno.test("documents/file-tracking#R13: 두기 의도는 새 project 파일과 판 파일의 원본 참조에만 붙고 기존 호출은 그대로다", () => {
  assert(filesWrite.input.safeParse(placeWrite).success);
  assert(fileWriteRequestSchema.safeParse(placeWrite).success);
  // 의도가 없는 기존 쓰기는 바뀌지 않는다.
  assert(fileWriteRequestSchema.safeParse(writeRequest).success);
  const { place: _place, ...withoutPlace } = placeWrite;
  assert(fileWriteRequestSchema.safeParse(withoutPlace).success);
  for (
    const invalid of [
      // 기존 파일 위에는 두지 않는다.
      { ...placeWrite, base_hash: otherHash },
      // 사본·지침 파일 목표에는 두지 않는다.
      { ...placeWrite, target: workingCopy },
      { ...placeWrite, target: instructionTarget },
      // 쓸 바이트는 그 판 파일의 원본 참조다.
      { ...placeWrite, content: fileInput.content },
      // 판 확정 요청과 함께 쓰지 않는다.
      {
        ...placeWrite,
        version_request: {
          document: doc,
          base_version: version,
          idempotency_key: key,
        },
      },
      { ...placeWrite, place: { document: doc } },
      { ...placeWrite, place: { document: doc, version, extra: true } },
      { ...placeWrite, place: { document: "x", version } },
    ]
  ) assert(!fileWriteRequestSchema.safeParse(invalid).success);
});

Deno.test("documents/file-tracking#R14: 빼기 의도는 문서만 가리키고 확인 묶음은 그대로다", () => {
  const input = {
    request_key: key,
    target: projectTarget,
    base_hash: hash,
  };
  assert(filesDelete.input.safeParse(input).success);
  assert(
    filesDelete.input.safeParse({ ...input, unlink: { document: doc } })
      .success,
  );
  assert(!filesDelete.input.safeParse({ ...input, unlink: {} }).success);
  assert(
    !filesDelete.input.safeParse({
      ...input,
      unlink: { document: doc, version },
    }).success,
  );
  // 사람이 확인하는 대상은 파일 삭제 하나다. 연결 해제는 확인 묶음에 들어가지 않는다.
  assertEquals(filesDelete.binding, ["request_key", "target", "base_hash"]);
  assertEquals(filesDelete.confirmation, "required");
});

Deno.test("documents/file-tracking#R15: 연결 확정 단계 결과는 파일 결과와 따로 싣고 없어도 된다", () => {
  const done = { state: "done" as const };
  const placement = {
    source: done,
    tracking: {
      state: "skipped" as const,
      reason: "the file is already tracked",
    },
    move: {
      state: "failed" as const,
      error: { code: "conflict" as const, message: "name is reserved" },
    },
  };
  assert(
    fileOperationResultSchema.safeParse({ ...written, placement }).success,
  );
  assert(
    fileOperationResultSchema.safeParse({
      ...written,
      operation: "delete" as const,
      outcome: "deleted" as const,
      unlinking: { source: done, move: { state: "not_attempted" } },
    }).success,
  );
  assert(fileOperationResultSchema.safeParse(written).success);
  for (
    const invalid of [
      { ...written, placement: { ...placement, move: { state: "unknown" } } },
      { ...written, placement: { source: done, tracking: done } },
      {
        ...written,
        placement: {
          ...placement,
          move: { state: "failed", error: { code: "teapot", message: "x" } },
        },
      },
      {
        ...written,
        placement: { ...placement, tracking: { state: "skipped" } },
      },
    ]
  ) assert(!fileOperationResultSchema.safeParse(invalid).success);
  assert(filesWrite.output.safeParse({ ...written, placement }).success);
  assert(filesDelete.output.safeParse({ ...written, placement }).success);
});
