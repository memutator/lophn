import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { manualClock } from "../../../../base/mod.ts";
import { fixtureExpected } from "../check/testing.ts";
import type { CheckViolation } from "../check/types.ts";
import { loadExpected } from "../extract/testing.ts";
import { scanContext } from "./scan.ts";
import {
  openIndexStore,
  readEntities,
  readEntitiesOfType,
  readEntityWithLinks,
  readIndexedFiles,
  readIndexState,
  readViolations,
} from "./store.ts";
import {
  BUNDLE_HASH,
  CONTEXT,
  fixtureBundle,
  memoryFiles,
  OTHER_BUNDLE_HASH,
  recordStatements,
  scanInput,
  T0,
  writesIndexRows,
} from "./testing.ts";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const FIXTURE_FILES = 16;
const FIXTURE_VIOLATIONS = 7;

// check runner와 같은 순서: path, kind, rule(null은 ""), section(null이 먼저)
function expectedViolations(): CheckViolation[] {
  return (fixtureExpected() as CheckViolation[]).sort((a, b) =>
    compare(a.path, b.path) || compare(a.kind, b.kind) ||
    compare(a.rule ?? "", b.rule ?? "") ||
    compare(a.section ?? "", b.section ?? "")
  );
}

// app-data 개체(Event)는 index에 저장하지 않는다.
function expectedEntities() {
  return loadExpected("eval-project").entities.filter((e) =>
    e.type !== "Event"
  );
}

function dump(store: ReturnType<typeof openIndexStore>) {
  return {
    entities: readEntities(store.sql, CONTEXT),
    violations: readViolations(store.sql, CONTEXT),
    files: readIndexedFiles(store.sql, CONTEXT),
  };
}

function must<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
) {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

Deno.test("documents/contexts#R23 [ctx-I32]: the first scan fills the store with the fixture entities, violations and file stats", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  const result = must(scanContext(store, scanInput(files)));

  assertEquals(result.scanned, FIXTURE_FILES);
  assertEquals(result.changed.length, FIXTURE_FILES);
  assertEquals(result.changed, [...result.changed].sort());
  assertEquals(result.removed, []);
  assertEquals(result.extracted, true);
  assertEquals(result.violation_count, FIXTURE_VIOLATIONS);

  const rows = dump(store);
  assertEquals(
    rows.entities.map(({ source_kind: _, ...entity }) => entity),
    expectedEntities(),
  );
  assertEquals(rows.violations, expectedViolations());
  assertEquals(
    rows.entities.find((e) => e.type === "Experiment")?.source_kind,
    "series",
  );
  assertEquals(
    rows.entities.find((e) => e.type === "Scenario")?.source_kind,
    "docs",
  );
  assertEquals(rows.entities.some((e) => e.type === "Event"), false);

  assertEquals(rows.files.map((f) => f.path), files.paths());
  assert(rows.files.every((f) => f.bundle_hash === BUNDLE_HASH));
  const bad = rows.files.filter((f) => f.status === "failed");
  assertEquals(bad.map((f) => [f.path, f.reason]), [
    ["eval/experiments/exp-005-badyaml.md", "unreadable"],
  ]);
  assertEquals(
    rows.files.find((f) => f.path === "docs/README.md")?.size,
    new TextEncoder().encode(files.read("docs/README.md")!).length,
  );

  assertEquals(readIndexState(store.sql, CONTEXT), {
    bundle_hash: BUNDLE_HASH,
    scanned_at: manualClock(T0).now(),
    result: "complete",
  });
});

Deno.test("documents/contexts#R23 [ctx-I32]: rose compares the new count with the ledger's recorded count, not with the store", () => {
  const first = openIndexStore(":memory:");
  const files = memoryFiles();
  assertEquals(
    must(scanContext(first, scanInput(files, { recorded_count: 0 }))).rose,
    true,
  );

  for (
    const [recorded, rose] of [[6, true], [7, false], [9, false]] as const
  ) {
    const store = openIndexStore(":memory:");
    const result = must(
      scanContext(store, scanInput(files, { recorded_count: recorded })),
    );
    assertEquals(result.violation_count, FIXTURE_VIOLATIONS);
    assertEquals(result.rose, rose, `recorded ${recorded}`);
  }
});

Deno.test("documents/contexts#R23 [ctx-I32]: a second scan with no change reads no file, writes no index row and keeps the same rows", () => {
  const raw = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(raw, scanInput(files)));
  const before = dump(raw);

  const { store, statements } = recordStatements(raw);
  files.reads.length = 0;
  const clock = manualClock(T0 + 60_000);
  const result = must(
    scanContext(store, scanInput(files, { clock, recorded_count: 7 })),
  );

  assertEquals(result.scanned, FIXTURE_FILES);
  assertEquals(result.changed, []);
  assertEquals(result.removed, []);
  assertEquals(result.extracted, false);
  assertEquals(result.violation_count, FIXTURE_VIOLATIONS);
  assertEquals(result.rose, false);
  assertEquals(files.reads, []);
  assertEquals(statements.filter(writesIndexRows), []);
  assertEquals(dump(raw), before);
  // only the freshness mark moves
  assertEquals(readIndexState(raw.sql, CONTEXT)?.scanned_at, clock.now());
});

Deno.test("documents/contexts#R23 [ctx-I32]: with no change the stored count still decides rose, so an unrecorded count is submitted again", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(store, scanInput(files)));
  const again = must(
    scanContext(store, scanInput(files, { recorded_count: 0 })),
  );
  assertEquals(again.extracted, false);
  assertEquals(again.violation_count, FIXTURE_VIOLATIONS);
  assertEquals(again.rose, true);
});

Deno.test("documents/contexts#R23 [ctx-I32]: a new mtime on one file re-extracts and updates only that file's stat when the content is the same", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(store, scanInput(files)));
  const before = dump(store);

  const path = "eval/experiments/exp-001-plan.md";
  files.touch(path);
  const result = must(
    scanContext(store, scanInput(files, { recorded_count: 7 })),
  );
  assertEquals(result.changed, [path]);
  assertEquals(result.extracted, true);
  assertEquals(result.rose, false);

  const after = dump(store);
  assertEquals(after.entities, before.entities);
  assertEquals(after.violations, before.violations);
  const changedRows = after.files.filter((row, i) =>
    row.mtime_ms !== before.files[i]!.mtime_ms
  );
  assertEquals(changedRows.map((f) => f.path), [path]);
});

Deno.test("documents/contexts#R23 [ctx-I32]: a changed size re-extracts the file, and fixing a file lowers the count", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(store, scanInput(files)));

  const path = "eval/experiments/exp-003-paused.md";
  files.write(
    path,
    files.read(path)!.replace("status: paused", "status: done"),
  );
  const result = must(
    scanContext(store, scanInput(files, { recorded_count: 7 })),
  );
  assertEquals(result.changed, [path]);
  assertEquals(result.violation_count, FIXTURE_VIOLATIONS - 1);
  assertEquals(result.rose, false);
  assertEquals(
    readEntities(store.sql, CONTEXT).find((e) => e.path === path)?.fields
      .status,
    "done",
  );
  assert(
    !readViolations(store.sql, CONTEXT).some((v) =>
      v.rule === "Experiment.status-known"
    ),
  );
});

Deno.test("documents/contexts#R23 [ctx-I32]: a new file adds its entity and violations and raises the count past the recorded one", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(store, scanInput(files)));

  const path = "eval/experiments/exp-020-new.md";
  files.write(path, "---\nscenarios: [travel]\n---\n# New arm\n");
  const result = must(
    scanContext(store, scanInput(files, { recorded_count: 7 })),
  );
  assertEquals(result.changed, [path]);
  assertEquals(result.violation_count, FIXTURE_VIOLATIONS + 1);
  assertEquals(result.rose, true);
  assert(
    readViolations(store.sql, CONTEXT).some((v) =>
      v.path === path && v.rule === "Experiment.status-required"
    ),
  );
  assertEquals(
    readEntities(store.sql, CONTEXT).some((e) => e.path === path),
    true,
  );
});

Deno.test("documents/contexts#R23 [ctx-I32]: a deleted file drops its entity, violations and file row", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(store, scanInput(files)));

  const path = "eval/experiments/exp-004-nostatus.md";
  files.remove(path);
  const result = must(
    scanContext(store, scanInput(files, { recorded_count: 7 })),
  );
  assertEquals(result.removed, [path]);
  assertEquals(result.changed, []);
  assertEquals(result.extracted, true);
  assertEquals(result.violation_count, FIXTURE_VIOLATIONS - 1);
  assertEquals(
    readEntities(store.sql, CONTEXT).some((e) => e.path === path),
    false,
  );
  assertEquals(
    readViolations(store.sql, CONTEXT).some((v) => v.path === path),
    false,
  );
  assertEquals(
    readIndexedFiles(store.sql, CONTEXT).some((f) => f.path === path),
    false,
  );
});

Deno.test("documents/contexts#R23 [ctx-I32]: only the contract's folders are scanned, so files outside them are never stat'ed or stored", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  files.write("src/main.ts", "export {};\n");
  files.write("eval/other/x.md", "# outside\n");
  files.write("eval/experiments/sub/deep.md", "# too deep\n");
  const result = must(scanContext(store, scanInput(files)));

  assertEquals(result.scanned, FIXTURE_FILES);
  assert(!files.stats.includes("src/main.ts"));
  assert(!files.stats.includes("eval/other/x.md"));
  assert(!files.stats.includes("eval/experiments/sub/deep.md"));
  assertEquals(
    readIndexedFiles(store.sql, CONTEXT).map((f) => f.path),
    memoryFiles().paths(),
  );

  // touching them later changes nothing
  files.touch("src/main.ts");
  const again = must(
    scanContext(store, scanInput(files, { recorded_count: 7 })),
  );
  assertEquals(again.changed, []);
  assertEquals(again.extracted, false);
});

Deno.test("documents/contexts#R23 [ctx-I32]: deleting the store and scanning again gives the same rows", () => {
  const files = memoryFiles();
  const original = openIndexStore(":memory:");
  must(scanContext(original, scanInput(files)));

  const rebuilt = openIndexStore(":memory:");
  const result = must(scanContext(rebuilt, scanInput(files)));
  assertEquals(result.extracted, true);
  assertEquals(result.changed.length, FIXTURE_FILES);
  assertEquals(dump(rebuilt), dump(original));
  assertEquals(
    readIndexState(rebuilt.sql, CONTEXT),
    readIndexState(original.sql, CONTEXT),
  );
});

Deno.test("documents/contexts#R23 [ctx-I32]: a different bundle re-extracts every file even though no file changed", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(store, scanInput(files)));

  // the new bundle drops the Experiment.status-required rule
  const bundle = structuredClone(fixtureBundle());
  const experiment = bundle.contract.types.find((t) =>
    t.name === "Experiment"
  )!;
  experiment.rules = experiment.rules.filter((r) => r.id !== "status-required");

  files.reads.length = 0;
  const result = must(
    scanContext(
      store,
      scanInput(files, {
        bundle,
        bundle_hash: OTHER_BUNDLE_HASH,
        recorded_count: 7,
      }),
    ),
  );
  assertEquals(result.changed.length, FIXTURE_FILES);
  assertEquals(result.extracted, true);
  assertEquals(result.violation_count, FIXTURE_VIOLATIONS - 1);
  assertEquals(result.rose, false);
  assertNotEquals(files.reads.length, 0);
  assert(
    readIndexedFiles(store.sql, CONTEXT).every((f) =>
      f.bundle_hash === OTHER_BUNDLE_HASH
    ),
  );
  assertEquals(
    readIndexState(store.sql, CONTEXT)?.bundle_hash,
    OTHER_BUNDLE_HASH,
  );

  // the same new bundle again is a no-op
  const same = must(
    scanContext(
      store,
      scanInput(files, { bundle, bundle_hash: OTHER_BUNDLE_HASH }),
    ),
  );
  assertEquals(same.extracted, false);
});

Deno.test("documents/contexts#R23 [ctx-I32]: contexts keep separate rows in one store", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  const other = "ctx_00000000000000000000000002";
  must(scanContext(store, scanInput(files)));
  must(scanContext(store, scanInput(files, { context: other })));
  assertEquals(
    readEntities(store.sql, other),
    readEntities(store.sql, CONTEXT),
  );

  files.remove("loop/findings/F-001.md");
  must(scanContext(store, scanInput(files, { context: other })));
  assertEquals(
    readEntities(store.sql, CONTEXT).some((e) =>
      e.path === "loop/findings/F-001.md"
    ),
    true,
  );
  assertEquals(
    readEntities(store.sql, other).some((e) =>
      e.path === "loop/findings/F-001.md"
    ),
    false,
  );
});

Deno.test("documents/contexts#R23 [ctx-I32]: a file system failure while scanning is unavailable and leaves the previous index untouched", () => {
  const store = openIndexStore(":memory:");
  const files = memoryFiles();
  must(scanContext(store, scanInput(files)));
  const before = dump(store);
  const stateBefore = readIndexState(store.sql, CONTEXT);

  files.write("docs/guide-a.md", "# changed\n");
  const failing = {
    ...files,
    stat(path: string) {
      if (path === "docs/guide-b.md") throw new Error("EIO");
      return files.stat(path);
    },
  };
  const result = scanContext(store, scanInput(failing, { recorded_count: 7 }));
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(dump(store), before);
  assertEquals(readIndexState(store.sql, CONTEXT), stateBefore);
});

Deno.test("documents/contexts#R16 [ctx-I63]: readEntityWithLinks gives the entity first in extraction order and the rows its edges point at, and nothing for an unknown entity", () => {
  const store = openIndexStore(":memory:");
  must(scanContext(store, scanInput(memoryFiles())));
  const all = readEntities(store.sql, CONTEXT);

  const rows = readEntityWithLinks(store.sql, CONTEXT, "Experiment", "002");
  assertEquals(rows[0]?.path, "eval/experiments/exp-002-sight.md");
  const wanted = new Set(["schedule-basic", "travel", "schedule-quality"]);
  const picked = all.filter((row) =>
    wanted.has(row.key) || (row.type === "Experiment" && row.key === "002")
  );
  assertEquals(
    rows.map((row) => [row.type, row.key, row.path]).sort(),
    picked.map((row) => [row.type, row.key, row.path]).sort(),
  );
  // no edge, no other rows
  const alone = readEntityWithLinks(store.sql, CONTEXT, "Experiment", "003");
  assertEquals(alone.map((row) => row.key), ["003"]);
  assertEquals(
    readEntityWithLinks(store.sql, CONTEXT, "Experiment", "999"),
    [],
  );
  assertEquals(
    readEntityWithLinks(
      store.sql,
      "ctx_00000000000000000000000002",
      "Experiment",
      "002",
    ),
    [],
  );
});

Deno.test("documents/series#R5 [ctx-I63]: readEntitiesOfType gives that type's entities in extraction order and only that context's", () => {
  const store = openIndexStore(":memory:");
  must(scanContext(store, scanInput(memoryFiles())));
  const all = readEntities(store.sql, CONTEXT);
  assertEquals(
    readEntitiesOfType(store.sql, CONTEXT, "Experiment"),
    all.filter((row) => row.type === "Experiment"),
  );
  assertEquals(readEntitiesOfType(store.sql, CONTEXT, "Nothing"), []);
  assertEquals(
    readEntitiesOfType(
      store.sql,
      "ctx_00000000000000000000000002",
      "Experiment",
    ),
    [],
  );
});
