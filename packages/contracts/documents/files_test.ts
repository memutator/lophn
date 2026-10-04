import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import {
  doc,
  fileInput,
  hash,
  key,
  otherHash,
  project,
  saved,
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
