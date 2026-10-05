import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import type { FileTarget } from "../../contracts/documents/mod.ts";
import {
  createStatusRecorder,
  fileStatusRead,
  type StatusObservation,
} from "./status.ts";

function state(
  result: Awaited<ReturnType<ReturnType<typeof fileStatusRead>["handle"]>>,
): string {
  assert(result.ok);
  return result.value.status.state;
}

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const VERSION = "ver_01arz3ndektsv4rrffq69g5fav";

function target(path: string): FileTarget {
  return { kind: "project_file", project: PROJECT, path };
}

const CTX = {
  principal: "user",
  actor: "user",
  scope: { operations: ["files.status"], targets: {} },
  conditions: {},
  credential_ref: "user",
};

Deno.test("documents/file-tracking#R9: 조회 때 상태를 계산하고 관측이 없으면 추적 안 함이다", async () => {
  const memory = new Map<string, StatusObservation>();
  const read = fileStatusRead({
    lookup: (wanted) =>
      ok(wanted.kind === "project_file" ? memory.get(wanted.path) : undefined),
  });
  const missing = await read.handle(CTX, { target: target("/work/none.md") });
  assertEquals(state(missing), "not_tracked");

  memory.set("/work/a.md", {
    tracked: true,
    missing: false,
    unverified: false,
    validationFailed: false,
    observedHash: "ab".repeat(32),
    latestHash: "cd".repeat(32),
    observedAt: "2026-10-05T00:00:00.000Z",
    comparedVersion: VERSION,
    projectRevision: "3",
    details: null,
  });
  const pending = await read.handle(CTX, { target: target("/work/a.md") });
  assertEquals(state(pending), "version_pending");
  assert(pending.ok);
  assertEquals(pending.value.status.compared_version, VERSION);
  assertEquals(pending.value.status.project_revision, "3");
});

Deno.test("documents/file-tracking#R9: 원본 없음과 미확인을 구별한다", async () => {
  const base: StatusObservation = {
    tracked: true,
    missing: true,
    unverified: false,
    validationFailed: false,
    observedHash: null,
    latestHash: "ab".repeat(32),
    observedAt: "2026-10-05T00:00:00.000Z",
    comparedVersion: VERSION,
    projectRevision: "1",
    details: null,
  };
  const read = fileStatusRead({
    lookup: (wanted) =>
      ok(
        wanted.kind === "project_file" && wanted.path.endsWith("gone.md")
          ? base
          : { ...base, unverified: true },
      ),
  });
  const gone = await read.handle(CTX, { target: target("/work/gone.md") });
  const shaky = await read.handle(CTX, { target: target("/work/shaky.md") });
  assertEquals(state(gone), "source_missing");
  assertEquals(state(shaky), "unverified");
});

Deno.test("documents/file-tracking#R9: 메모리를 읽지 못하면 추적 안 함으로 꾸미지 않는다", async () => {
  const read = fileStatusRead({
    lookup: () => err({ code: "unavailable", message: "documents worker" }),
  });
  const result = await read.handle(CTX, { target: target("/work/a.md") });
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
});

Deno.test("documents/file-tracking#R9: recorder는 같은 대상의 새 관측이 옛것을 대체한다", () => {
  const recorder = createStatusRecorder();
  const same = {
    kind: "project_file" as const,
    project: PROJECT,
    path: "/a.md",
  };
  const base: StatusObservation = {
    tracked: true,
    missing: false,
    unverified: false,
    validationFailed: false,
    observedHash: "ab".repeat(32),
    latestHash: null,
    observedAt: "2026-10-05T00:00:00.000Z",
    comparedVersion: null,
    projectRevision: "1",
    details: null,
  };
  recorder.report(same, base);
  recorder.report({ path: "/a.md", project: PROJECT, kind: "project_file" }, {
    ...base,
    missing: true,
  });
  assertEquals(recorder.get(same)?.missing, true);
  assertEquals(recorder.get({ ...same, path: "/b.md" }), undefined);
});
