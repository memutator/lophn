import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../../base/mod.ts";
import type {
  ActivationDataResult,
  ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";
import { runActivation } from "./orchestrator.ts";
import type { ActivationPorts } from "./steps.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const NEW = "rel_01arz3ndektsv4rrffq69g5fb2";
const OLD = "rel_01arz3ndektsv4rrffq69g5fb1";
const ATTEMPT = "act_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);

const release = {
  id: NEW,
  app: APP,
  number: 2,
  bundle_hash: HASH,
  data_schema: 2,
  data_changes: [{ from: 1, to: 2, script_hash: HASH, description: "add" }],
  status: "activating",
  activation: {
    attempt: ATTEMPT,
    previous_release: OLD,
    backup_hash: null,
    data_change_invocation: null,
    started_at: "2026-10-16T00:00:00.000Z",
  },
} as unknown as ReleaseRecord;

function result(schema: number): ActivationDataResult {
  return {
    release: NEW,
    attempt: ATTEMPT,
    invocation: null,
    data_schema: schema,
    integrity_ok: true,
  } as ActivationDataResult;
}

// 실제 DB는 schema 1이고 migration이 실패한다. restore가 돌려주는 schema만 경우마다 다르다.
function fake(restoredSchema: number) {
  const calls: string[] = [];
  const failures: unknown[] = [];
  const unavailable: string[] = [];
  const ports: ActivationPorts = {
    intake: {
      close: () => calls.push("close"),
      whenIdle: () => Promise.resolve({ idle: true }),
      abandon: () => Promise.resolve(),
      open: () => calls.push("open"),
    },
    supervisor: {
      stopCurrent: () => Promise.resolve(true),
      stopCandidate: () => Promise.resolve(true),
      startCandidate: () => {
        calls.push("startCandidate");
        return Promise.resolve(err({ code: "unavailable", message: "x" }));
      },
      openCandidate: () => Promise.resolve(ok(undefined)),
      run: (_app, id) => {
        calls.push(`run:${id}`);
        return Promise.resolve(ok(undefined));
      },
    },
    data: {
      inspect: () =>
        Promise.resolve(ok({ data_schema: 1, integrity_ok: true })),
      backup: () =>
        Promise.resolve(ok({ result: result(1), backup_hash: HASH })),
      migrate: () => {
        calls.push("migrate");
        return Promise.resolve(
          err({
            code: "unavailable",
            message: "step 1-2 was rolled back: NOT NULL constraint failed",
          }),
        );
      },
      restore: () => {
        calls.push("restore");
        return Promise.resolve(ok(result(restoredSchema)));
      },
    },
    core: {
      release: () => Promise.resolve(ok(release)),
      recordBackup: () => Promise.resolve(ok(undefined)),
      recordDataChange: () => Promise.resolve(ok(undefined)),
      recordDataRestore: (restored) => {
        calls.push("recordRestore");
        return Promise.resolve(
          restored.data_schema === 1
            ? ok(undefined)
            : err({ code: "conflict", message: "schema" }),
        );
      },
      completeActivation: () => {
        calls.push("complete");
        return Promise.resolve(ok(undefined));
      },
      failActivation: (input) => {
        failures.push(input.failure);
        return Promise.resolve(ok(undefined));
      },
      markUnavailable: (_app, _release, reason) => {
        unavailable.push(reason.code);
        return Promise.resolve();
      },
    },
    after: {
      pruneChangesets: () => Promise.resolve(),
      viewChanged: () => {},
    },
    progress: () => {},
    newInvocation: () => "inv_01arz3ndektsv4rrffq69g5fav",
  };
  return { ports, calls, failures, unavailable };
}

Deno.test("activation이 실패하면 복구본으로 되돌리고 이전 release가 남는다", async () => {
  const restored = fake(1);
  const outcome = await runActivation(restored.ports, release);
  assertEquals(outcome, {
    status: "failed",
    code: "migration_failed",
    previous: "started",
  });
  assertEquals(restored.failures, [{
    code: "migration_failed",
    summary:
      "the data change failed: step 1-2 was rolled back: NOT NULL constraint failed",
    restored: true,
  }]);
  assert(restored.calls.includes("restore"));
  assert(restored.calls.includes(`run:${OLD}`));
  assert(!restored.calls.includes("complete"));
  assertEquals(restored.calls.at(-1), "open");

  // 복원된 schema가 확인되지 않으면 이전 코드를 시작하지 않고 앱을 사용할 수 없는 상태로 둔다.
  const unconfirmed = fake(0);
  const stuck = await runActivation(unconfirmed.ports, release);
  assertEquals(stuck, { status: "unavailable", code: "restore_failed" });
  assertEquals(unconfirmed.unavailable, ["restore_failed"]);
  assertEquals(unconfirmed.failures, []);
  assert(!unconfirmed.calls.includes(`run:${OLD}`));
});
