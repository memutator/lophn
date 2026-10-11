import { assert, assertEquals } from "@std/assert";
import { manualClock, ok } from "../../base/mod.ts";
import { fixtureRaw } from "./check/testing.ts";
import { inlineFiles, loadFixture } from "./extract/testing.ts";
import { openIndexStore } from "./index/mod.ts";
import {
  BUNDLE_HASH,
  CONTEXT,
  fixtureBundle,
  memoryFiles,
  OTHER_BUNDLE_HASH,
  T0,
} from "./index/testing.ts";
import { sampleEnv } from "./validate/sample.ts";
import { createContextJobs } from "./work-jobs.ts";
import { CHECK, fakeSnapshots, fakeSubmit } from "./work-testing.ts";

const OTHER = "ctx_00000000000000000000000002";

// lets queued microtasks and timers run
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// a submission the test releases by hand
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => release = resolve);
  return { opened, release };
}

function setup(hold?: Promise<void>) {
  const log: string[] = [];
  const files = memoryFiles();
  let scans = 0;
  const submit = fakeSubmit({
    log,
    recordViolations: async (input) => {
      if (input.context === CONTEXT) await hold;
      return ok({});
    },
  });
  const jobs = createContextJobs({
    store: openIndexStore(":memory:"),
    files() {
      scans++;
      log.push("scan");
      return files;
    },
    clock: manualClock(T0),
    submit,
    snapshots: fakeSnapshots(loadFixture("eval-project"), { log }),
  });
  return { jobs, log, submit, scans: () => scans };
}

const indexRequest = (context = CONTEXT, bundle_hash = BUNDLE_HASH) => ({
  context,
  bundle: fixtureBundle(),
  bundle_hash,
  recorded_count: 0,
});

Deno.test("documents/contexts#R23 [ctx-I33]: identical index requests for one context in flight share one job and one result", async () => {
  const hold = gate();
  const { jobs, submit, scans } = setup(hold.opened);
  const first = jobs.index(indexRequest());
  const second = jobs.index(indexRequest());
  hold.release();
  const [a, b] = await Promise.all([first, second]);
  assert(a.ok && b.ok);
  assertEquals(a, b);
  assertEquals(scans(), 1);
  assertEquals(submit.calls.length, 1);

  // a request after the job ended is a new job
  const third = await jobs.index(indexRequest());
  assert(third.ok);
  assertEquals(scans(), 2);
  assertEquals(third.value.extracted, false);
});

Deno.test("documents/contexts#R23 [ctx-I33]: an index request for a different bundle waits its turn instead of joining", async () => {
  const hold = gate();
  const { jobs, log } = setup(hold.opened);
  const first = jobs.index(indexRequest());
  const second = jobs.index(indexRequest(CONTEXT, OTHER_BUNDLE_HASH));
  await settle();
  assertEquals(log.filter((l) => l === "scan").length, 1);
  hold.release();
  const [a, b] = await Promise.all([first, second]);
  assert(a.ok && b.ok);
  assertEquals(log.filter((l) => l === "scan").length, 2);
  // the second one saw a new bundle and re-extracted every file
  assertEquals(b.value.extracted, true);
  assertEquals(b.value.changed.length, 16);
});

Deno.test("documents/contexts#R23 [ctx-I33]: another context's job does not wait for a held one", async () => {
  const hold = gate();
  const { jobs, submit } = setup(hold.opened);
  const held = jobs.index(indexRequest(CONTEXT));
  const other = await jobs.index(indexRequest(OTHER));
  assert(other.ok);
  assertEquals(other.value.recorded, true);
  assertEquals(
    submit.calls.map((c) => (c.input as { context: string }).context),
    [
      CONTEXT,
      OTHER,
    ],
  );
  hold.release();
  assert((await held).ok);
});

Deno.test("documents/contexts#R20 [ctx-I33]: a check on a context waits for the index job running on it", async () => {
  const hold = gate();
  const { jobs, log } = setup(hold.opened);
  const index = jobs.index(indexRequest());
  const raw = fixtureRaw();
  const check = jobs.check({
    context: CONTEXT,
    check: CHECK,
    bundle: raw,
    bundle_hash: "c".repeat(64),
    user_saved_views: [],
    env: sampleEnv(),
  });
  await settle();
  assertEquals(log.includes("snapshot:create"), false);
  hold.release();
  const [a, b] = await Promise.all([index, check]);
  assert(a.ok && b.ok);
  assertEquals(log.includes("snapshot:create"), true);
});

Deno.test("documents/contexts#R20 [ctx-I33]: a failed job does not block the next one on the same context", async () => {
  const log: string[] = [];
  let calls = 0;
  const jobs = createContextJobs({
    store: openIndexStore(":memory:"),
    files() {
      if (calls++ === 0) throw new Error("EIO");
      return memoryFiles();
    },
    clock: manualClock(T0),
    submit: fakeSubmit({ log }),
    snapshots: fakeSnapshots(inlineFiles({}), { log }),
  });
  const first = await jobs.index(indexRequest());
  assert(!first.ok);
  const second = await jobs.index(indexRequest());
  assert(second.ok);
});
