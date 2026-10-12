import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  AppRevertBinding,
  PreparedFile,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type AppStepCall,
  type AppStepPorts,
  runAppSteps,
  type StoredStep,
} from "./app-steps.ts";
import { APP, INV, REL, RVT, TCL } from "./testing/mod.ts";

// 앱 단계 실행 순서(agent-RW3c). 앱과 ledger는 가짜 port라 네트워크가 없고 호출 기록이 곧 단언이다.

const REVERT = RVT(1);

function binding(n: number): AppRevertBinding {
  return {
    app: APP(1),
    release: REL(1),
    command: "ticket.update",
    tool_call: TCL(n),
    invocation: INV(n),
    receipt: `receipt-${n}`,
    expected_revision: String(n),
    revert_command: "ticket.revert",
    step_key: `${REVERT}:${INV(n)}`,
    revert_invocation: null,
  };
}

const key = (n: number) => binding(n).step_key;

const file: PreparedFile = {
  path: "a.md",
  observed_sha256: null,
  link: false,
  staged: true,
  redo_ref: null,
};

type Log = {
  calls: string[];
  checkpoints: {
    step_key: string;
    invocation: string | null;
    result: AppStepCall;
  }[];
  prepared: number;
  finished: { step_keys: string[]; files: PreparedFile[] }[];
};

function ports(
  steps: StoredStep[],
  answers: Record<number, AppStepCall>,
  over: Partial<{ outcome: string; checkpointFails: boolean }> = {},
): { ports: AppStepPorts; log: Log } {
  const log: Log = { calls: [], checkpoints: [], prepared: 0, finished: [] };
  return {
    log,
    ports: {
      stored: () =>
        Promise.resolve(ok({ outcome: over.outcome ?? "applying", steps })),
      call: (bound) => {
        log.calls.push(bound.step_key);
        // binding(n)의 expected_revision이 n이다.
        const n = Number(bound.expected_revision);
        const result = answers[n] ?? "restored";
        return Promise.resolve({
          result,
          invocation: result === "uncertain" ? null : `inv_revert_${n}`,
        });
      },
      checkpoint: (input) => {
        if (over.checkpointFails === true) {
          return Promise.resolve(
            err({ code: "unavailable" as const, message: "ledger down" }),
          );
        }
        log.checkpoints.push({
          step_key: input.step_key,
          invocation: input.invocation,
          result: input.result,
        });
        return Promise.resolve(ok(undefined));
      },
      prepareFiles: () => {
        log.prepared += 1;
        return Promise.resolve(ok([file]));
      },
      finish: (input) => {
        log.finished.push({ step_keys: input.step_keys, files: input.files });
        return Promise.resolve(ok(undefined));
      },
    },
  };
}

const fresh = (...ns: number[]): StoredStep[] =>
  ns.map((n) => ({ binding: binding(n), result: "unchanged" as const }));

function must<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

Deno.test("lophn-agent/revert#R10 [agent-RW3c]: each app step is called once in reverse order, checkpointed, then the revert is finished with the prepared files", async () => {
  const { ports: p, log } = ports(fresh(1, 2, 3), {});
  const run = must(await runAppSteps(p, REVERT));
  assertEquals(log.calls, [key(3), key(2), key(1)]);
  assertEquals(run, { called: [key(3), key(2), key(1)], stopped_at: null });
  assertEquals(log.checkpoints.map((entry) => [entry.step_key, entry.result]), [
    [key(3), "restored"],
    [key(2), "restored"],
    [key(1), "restored"],
  ]);
  assertEquals(log.prepared, 1);
  assertEquals(log.finished, [{
    step_keys: [key(1), key(2), key(3)],
    files: [file],
  }]);
});

Deno.test("lophn-agent/revert#R11 [agent-RW3c]: after a failed step no earlier step is called and the document files are left out of the finish", async () => {
  const { ports: p, log } = ports(fresh(1, 2, 3), { 2: "failure" });
  const run = must(await runAppSteps(p, REVERT));
  assertEquals(log.calls, [key(3), key(2)]);
  assertEquals(run.stopped_at, key(2));
  assertEquals(log.checkpoints.map((entry) => entry.result), [
    "restored",
    "failure",
  ]);
  assertEquals(log.prepared, 0);
  assertEquals(log.finished, [{
    step_keys: [key(1), key(2), key(3)],
    files: [],
  }]);
});

Deno.test("lophn-agent/revert#R11 [agent-RW3c]: a lost response is uncertain with no invocation, and nothing is sent again", async () => {
  const { ports: p, log } = ports(fresh(1, 2), { 2: "uncertain" });
  const run = must(await runAppSteps(p, REVERT));
  assertEquals(log.calls, [key(2)]);
  assertEquals(run.stopped_at, key(2));
  assertEquals(log.checkpoints, [{
    step_key: key(2),
    invocation: null,
    result: "uncertain",
  }]);
  assertEquals(log.finished[0]!.files, []);
});

Deno.test("lophn-agent/revert#R8 [agent-RW3c]: a step already recorded is not called again, so a restart continues where it stopped", async () => {
  const steps: StoredStep[] = [
    { binding: binding(1), result: "unchanged" },
    { binding: binding(2), result: "unchanged" },
    { binding: binding(3), result: "restored" },
  ];
  const { ports: p, log } = ports(steps, {});
  const run = must(await runAppSteps(p, REVERT));
  assertEquals(log.calls, [key(2), key(1)]);
  assertEquals(run.called, [key(2), key(1)]);
  assertEquals(log.finished[0]!.files, [file]);
});

Deno.test("lophn-agent/revert#R11 [agent-RW3c]: a step recorded as failed stops the run before any call", async () => {
  const steps: StoredStep[] = [
    { binding: binding(1), result: "unchanged" },
    { binding: binding(2), result: "failure" },
    { binding: binding(3), result: "restored" },
  ];
  const { ports: p, log } = ports(steps, {});
  const run = must(await runAppSteps(p, REVERT));
  assertEquals(log.calls, []);
  assertEquals(run.stopped_at, key(2));
  assertEquals(log.finished[0]!.files, []);
});

Deno.test("lophn-agent/revert#R8 [agent-RW3c]: a revert that is not applying, or steps of another revert, call nothing", async () => {
  const done = ports(fresh(1), {}, { outcome: "applied" });
  const refused = await runAppSteps(done.ports, REVERT);
  assert(!refused.ok);
  assertEquals(refused.error.code, "conflict");
  assertEquals(done.log.calls, []);

  const foreign = ports(
    [{
      binding: { ...binding(1), step_key: `rvt_other:${INV(1)}` },
      result: "unchanged",
    }],
    {},
  );
  const invalid = await runAppSteps(foreign.ports, REVERT);
  assert(!invalid.ok);
  assertEquals(invalid.error.code, "invalid_input");
  assertEquals(foreign.log.calls, []);
});

Deno.test("lophn-agent/revert#R11 [agent-RW3c]: a checkpoint that cannot be recorded stops the run without finishing it", async () => {
  const { ports: p, log } = ports(fresh(1, 2), {}, { checkpointFails: true });
  const result = await runAppSteps(p, REVERT);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(log.calls, [key(2)]);
  assertEquals(log.finished, []);
});
