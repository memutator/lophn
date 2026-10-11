// context.preview 일과 page 자르기의 시험. 파일은 fake snapshot이고 순수 함수의 결과는 run_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { fixtureRaw } from "../check/testing.ts";
import { inlineFiles, loadFixture } from "../extract/testing.ts";
import { sampleEnv } from "../validate/sample.ts";
import { fakeSnapshots } from "../work-testing.ts";
import { runPreviewJob } from "./job.ts";
import { pagePreview } from "./page.ts";

const SNAPSHOT = "prv_00000000000000000000000001";

function project() {
  const fixture = loadFixture("eval-project");
  const all: Record<string, string> = {};
  for (const path of fixture.paths()) all[path] = fixture.read(path) ?? "";
  all["secret/token.md"] = "do not copy";
  return inlineFiles(all);
}

Deno.test("documents/contexts#R19 [ctx-I64p]: the preview job snapshots only the contract's folders, previews the snapshot and removes it", () => {
  const snapshots = fakeSnapshots(project());
  const done = runPreviewJob({ snapshots }, {
    snapshot: SNAPSHOT,
    draft: fixtureRaw(),
    env: sampleEnv(),
  });
  assert(done.ok, JSON.stringify(done));
  assertEquals(done.value.violation_count, 7);
  assertEquals(snapshots.created.length, 1);
  assertEquals(snapshots.created[0]!.check, SNAPSHOT);
  assertEquals(
    snapshots.created[0]!.paths,
    loadFixture("eval-project").paths(),
  );
  assertEquals(snapshots.removed, [SNAPSHOT]);
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a draft that fails the shape copies no folder, and a snapshot that cannot be made is unavailable", () => {
  const snapshots = fakeSnapshots(project());
  const broken = runPreviewJob({ snapshots }, {
    snapshot: SNAPSHOT,
    draft: { ...fixtureRaw(), schema: 2 },
    env: sampleEnv(),
  });
  assert(broken.ok);
  assertEquals(broken.value.types, []);
  assertEquals(snapshots.created[0]!.paths, []);
  assertEquals(snapshots.removed, [SNAPSHOT]);

  const failing = fakeSnapshots(project(), {
    failWith: { code: "unavailable", message: "over budget" },
  });
  const failed = runPreviewJob({ snapshots: failing }, {
    snapshot: SNAPSHOT,
    draft: fixtureRaw(),
    env: sampleEnv(),
  });
  assert(!failed.ok);
  assertEquals(failed.error.code, "unavailable");
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a page is 30 violations with a message, and a cursor from another bundle is invalid_input", () => {
  const violations = Array.from({ length: 31 }, (_, index) => ({
    kind: "unreadable" as const,
    rule: null,
    type: "Experiment",
    path: `a/${String(index).padStart(2, "0")}.md`,
    section: null,
    target: null,
  }));
  const outcome = {
    types: [{ type: "Experiment", count: 31 }],
    findings: [],
    violation_count: 31,
    violations,
  };
  const base = {
    context: "ctx_00000000000000000000000001",
    as_of_seq: "4",
    outcome,
  };
  const first = pagePreview({
    ...base,
    bundle: "cbn_00000000000000000000000001",
  });
  assert(first.ok);
  assertEquals(first.value.violations.length, 30);
  assertEquals(first.value.complete, false);
  assertEquals(first.value.violations[0]!.message, "a/00.md cannot be read");
  const second = pagePreview({
    ...base,
    bundle: "cbn_00000000000000000000000001",
    cursor: first.value.next_cursor!,
  });
  assert(second.ok);
  assertEquals(second.value.violations.map((v) => v.path), ["a/30.md"]);
  assertEquals(second.value.next_cursor, null);
  const other = pagePreview({
    ...base,
    bundle: "cbn_00000000000000000000000002",
    cursor: first.value.next_cursor!,
  });
  assert(!other.ok);
  assertEquals(other.error.code, "invalid_input");
  const garbage = pagePreview({
    ...base,
    bundle: "cbn_00000000000000000000000001",
    cursor: "not-a-cursor",
  });
  assert(!garbage.ok);
  assertEquals(garbage.error.code, "invalid_input");
});
