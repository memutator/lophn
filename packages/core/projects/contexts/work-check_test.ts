import { assert, assertEquals } from "@std/assert";
import type { LophnError } from "../../../base/mod.ts";
import { snapshotHash } from "./check/mod.ts";
import { fixtureRaw } from "./check/testing.ts";
import { loadFixture } from "./extract/testing.ts";
import { inlineFiles } from "./extract/testing.ts";
import { sampleEnv } from "./validate/sample.ts";
import { runCheckJob } from "./work-check.ts";
import type { CheckJobRequest } from "./work-check.ts";
import { CHECK, failure, fakeSnapshots, fakeSubmit } from "./work-testing.ts";

const SHA256 = /^[0-9a-f]{64}$/;
const BUNDLE_HASH = "c".repeat(64);

function project() {
  const fixture = loadFixture("eval-project");
  const all: Record<string, string> = {};
  for (const path of fixture.paths()) all[path] = fixture.read(path) ?? "";
  // outside the contract's folders: must never reach the snapshot
  all["secret/token.md"] = "do not copy";
  all["src/main.ts"] = "export {};";
  return inlineFiles(all);
}

// deno-lint-ignore no-explicit-any
function request(edit: (raw: any) => void = () => {}): CheckJobRequest {
  const raw = fixtureRaw();
  edit(raw);
  return {
    context: "ctx_00000000000000000000000001",
    check: CHECK,
    bundle: raw,
    bundle_hash: BUNDLE_HASH,
    user_saved_views: [],
    env: sampleEnv(),
  };
}

function setup(options: { failWith?: LophnError } = {}) {
  const log: string[] = [];
  const snapshots = fakeSnapshots(project(), { log, ...options });
  const submit = fakeSubmit({ log });
  return { log, snapshots, submit, deps: { snapshots, submit } };
}

Deno.test("documents/contexts#R20 [ctx-I33]: context.check snapshots only the contract's folders, checks the snapshot and submits a passed result", async () => {
  const { deps, snapshots, submit, log } = setup();
  const result = await runCheckJob(deps, request());
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.status, "passed");

  // only the four contract folders, so the outside files are not in the snapshot
  assertEquals(snapshots.created.length, 1);
  assertEquals(snapshots.created[0]!.check, CHECK);
  assertEquals(
    snapshots.created[0]!.paths,
    loadFixture("eval-project").paths(),
  );

  assertEquals(submit.calls.length, 1);
  const call = submit.calls[0]!;
  assertEquals(call.command, "bundle.finish_check");
  assertEquals(call.input, {
    check: CHECK,
    result: "passed",
    bundle_hash: BUNDLE_HASH,
    snapshot_hash: snapshotHash(loadFixture("eval-project")),
    findings: [],
    violation_count: 7,
  });
  assert(SHA256.test((call.input as { snapshot_hash: string }).snapshot_hash));

  // create -> submit -> remove
  assertEquals(log, [
    "snapshot:create",
    "submit:finish_check",
    "snapshot:remove",
  ]);
  assertEquals(snapshots.removed, [CHECK]);
});

Deno.test("documents/contexts#R20 [ctx-I33]: a bundle whose example no longer holds is submitted as failed with its findings", async () => {
  const { deps, submit, snapshots } = setup();
  const result = await runCheckJob(
    deps,
    request((raw) => raw.examples[1].expect.fields.status = "done"),
  );
  assert(result.ok);
  assertEquals(result.value.status, "failed");
  const input = submit.calls[0]!.input as {
    result: string;
    findings: { kind: string; target: string | null }[];
    violation_count: number;
  };
  assertEquals(input.result, "failed");
  assertEquals(input.findings.map((f) => [f.kind, f.target]), [
    ["example_mismatch", "examples.1"],
  ]);
  assertEquals(input.violation_count, 7);
  assertEquals(snapshots.removed, [CHECK]);
});

Deno.test("documents/contexts#R20 [ctx-I33]: a malformed bundle is still submitted as failed, over an empty snapshot", async () => {
  const { deps, submit, snapshots } = setup();
  const result = await runCheckJob(deps, request((raw) => raw.schema = 2));
  assert(result.ok);
  assertEquals(snapshots.created[0]!.folders, []);
  assertEquals(snapshots.created[0]!.paths, []);
  const input = submit.calls[0]!.input as {
    result: string;
    findings: { kind: string }[];
    violation_count: number;
  };
  assertEquals(input.result, "failed");
  assertEquals(input.findings[0]!.kind, "contract_invalid");
  assertEquals(input.violation_count, 0);
  assertEquals(snapshots.removed, [CHECK]);
});

Deno.test("documents/contexts#R20 [ctx-I33]: when the snapshot cannot be made nothing is submitted and the failure is unavailable", async () => {
  const { deps, submit } = setup({
    failWith: { code: "unavailable", message: "disk full" },
  });
  const result = await runCheckJob(deps, request());
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(submit.calls, []);
});

Deno.test("documents/contexts#R20 [ctx-I33]: a rejected submission is returned as is and the snapshot is still deleted", async () => {
  const log: string[] = [];
  const snapshots = fakeSnapshots(project(), { log });
  const submit = fakeSubmit({ log, finishCheck: () => failure("conflict") });
  const result = await runCheckJob({ snapshots, submit }, request());
  assert(!result.ok);
  assertEquals(result.error.code, "conflict");
  assertEquals(snapshots.removed, [CHECK]);
  assertEquals(log, [
    "snapshot:create",
    "submit:finish_check",
    "snapshot:remove",
  ]);
});
