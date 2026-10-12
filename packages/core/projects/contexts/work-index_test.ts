import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import { openIndexStore, readEntities, readViolations } from "./index/mod.ts";
import {
  BUNDLE_HASH,
  CONTEXT,
  fixtureBundle,
  memoryFiles,
  T0,
} from "./index/testing.ts";
import { watchFolders } from "./watch/mod.ts";
import { runIndexJob } from "./work-index.ts";
import type { IndexJobDeps, IndexJobRequest } from "./work-index.ts";
import { failure, fakeSubmit } from "./work-testing.ts";

function setup(options: Parameters<typeof fakeSubmit>[0] = {}) {
  const files = memoryFiles();
  const seen: unknown[] = [];
  const submit = fakeSubmit(options);
  const deps: IndexJobDeps = {
    store: openIndexStore(":memory:"),
    files(folders) {
      seen.push(folders);
      return files;
    },
    clock: manualClock(T0),
    submit,
  };
  return { files, seen, submit, deps };
}

const request = (recorded_count = 0): IndexJobRequest => ({
  context: CONTEXT,
  bundle: fixtureBundle(),
  bundle_hash: BUNDLE_HASH,
  recorded_count,
});

Deno.test("documents/contexts#R23 [ctx-I33]: context.index scans the contract's folders and submits the raised violation count once", async () => {
  const { deps, seen, submit } = setup();
  const result = await runIndexJob(deps, request(0));
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.extracted, true);
  assertEquals(result.value.violation_count, 7);
  assertEquals(result.value.rose, true);
  assertEquals(result.value.recorded, true);

  assertEquals(seen, [watchFolders(fixtureBundle().contract)]);
  assertEquals(submit.calls, [{
    command: "context.record_violations",
    input: { context: CONTEXT, count: 7, bundle_hash: BUNDLE_HASH },
  }]);
  assertEquals(readViolations(deps.store.sql, CONTEXT).length, 7);
  assert(readEntities(deps.store.sql, CONTEXT).length > 0);
});

Deno.test("documents/contexts#R25 [ctx-I33]: context.index submits when the count differs from the recorded one, a rise or a fall, and not when it is equal", async () => {
  for (
    const [recorded, submitted] of [[0, true], [6, true], [7, false], [
      12,
      true,
    ]] as const
  ) {
    const { deps, submit } = setup();
    const result = await runIndexJob(deps, request(recorded));
    assert(result.ok);
    assertEquals(result.value.violation_count, 7);
    assertEquals(result.value.recorded, submitted, `recorded ${recorded}`);
    assertEquals(
      submit.calls,
      submitted
        ? [{
          command: "context.record_violations",
          input: { context: CONTEXT, count: 7, bundle_hash: BUNDLE_HASH },
        }]
        : [],
      `recorded ${recorded}`,
    );
  }
});

Deno.test("documents/contexts#R25 [ctx-I33]: fixing a file lowers the count and the lower count is submitted", async () => {
  const { deps, submit, files } = setup();
  await runIndexJob(deps, request(0));
  submit.calls.length = 0;
  const path = "eval/experiments/exp-003-paused.md";
  files.write(
    path,
    files.read(path)!.replace("status: paused", "status: done"),
  );
  const result = await runIndexJob(deps, request(7));
  assert(result.ok);
  assertEquals(result.value.rose, false);
  assertEquals(result.value.violation_count, 6);
  assertEquals(result.value.recorded, true);
  assertEquals(submit.calls, [{
    command: "context.record_violations",
    input: { context: CONTEXT, count: 6, bundle_hash: BUNDLE_HASH },
  }]);
});

Deno.test("documents/contexts#R25 [ctx-I33]: a second job with no file change extracts nothing and submits only if the count is still unrecorded", async () => {
  const { deps, submit, files } = setup();
  await runIndexJob(deps, request(0));
  submit.calls.length = 0;
  files.reads.length = 0;

  const settled = await runIndexJob(deps, request(7));
  assert(settled.ok);
  assertEquals(settled.value.extracted, false);
  assertEquals(files.reads, []);
  assertEquals(submit.calls, []);

  // the ledger never recorded 7 (lost reply): the same count is submitted again without re-extracting
  const retried = await runIndexJob(deps, request(0));
  assert(retried.ok);
  assertEquals(retried.value.extracted, false);
  assertEquals(retried.value.recorded, true);
  assertEquals(submit.calls.length, 1);
});

Deno.test("documents/contexts#R25 [ctx-I33]: a raise caused by a new bad file is submitted with the new count", async () => {
  const { deps, submit, files } = setup();
  await runIndexJob(deps, request(0));
  submit.calls.length = 0;

  files.write(
    "eval/experiments/exp-020-new.md",
    "---\nscenarios: [travel]\n---\n# New\n",
  );
  const result = await runIndexJob(deps, request(7));
  assert(result.ok);
  assertEquals(result.value.violation_count, 8);
  assertEquals(submit.calls, [{
    command: "context.record_violations",
    input: { context: CONTEXT, count: 8, bundle_hash: BUNDLE_HASH },
  }]);
});

Deno.test("documents/contexts#R25 [ctx-I33]: a rejected submission is returned as is, the index stays updated and the next job submits again", async () => {
  let reject = true;
  const { deps, submit } = setup({
    recordViolations: () =>
      reject ? failure("conflict") : Promise.resolve({ ok: true, value: {} }),
  });
  const first = await runIndexJob(deps, request(0));
  assert(!first.ok);
  assertEquals(first.error.code, "conflict");
  assertEquals(readViolations(deps.store.sql, CONTEXT).length, 7);

  reject = false;
  const second = await runIndexJob(deps, request(0));
  assert(second.ok);
  assertEquals(second.value.extracted, false);
  assertEquals(second.value.recorded, true);
  assertEquals(submit.calls.length, 2);
});

Deno.test("documents/contexts#R23 [ctx-I33]: a file system failure is unavailable and nothing is submitted", async () => {
  const { deps, submit } = setup();
  deps.files = () => {
    throw new Error("EACCES");
  };
  const result = await runIndexJob(deps, request(0));
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(submit.calls, []);
});
