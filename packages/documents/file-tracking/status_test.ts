import { assert, assertEquals } from "@std/assert";
import type { FileTarget } from "../../contracts/documents/mod.ts";
import { fileStatusRead, type StatusObservation } from "./status.ts";

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
      wanted.kind === "project_file" ? memory.get(wanted.path) : undefined,
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
      wanted.kind === "project_file" && wanted.path.endsWith("gone.md")
        ? base
        : { ...base, unverified: true },
  });
  const gone = await read.handle(CTX, { target: target("/work/gone.md") });
  const shaky = await read.handle(CTX, { target: target("/work/shaky.md") });
  assertEquals(state(gone), "source_missing");
  assertEquals(state(shaky), "unverified");
});
