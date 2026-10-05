import { assert, assertEquals } from "@std/assert";
import { createIdSource, cryptoRandom, manualClock } from "../../base/mod.ts";
import type { ObservedExceptionInput } from "../../contracts/problems/mod.ts";
import { exceptionObservationInputSchema } from "../../contracts/problems/mod.ts";
import {
  CRASH_EVIDENCE,
  type CrashEvent,
  createCrashObserver,
} from "./observations/crash.ts";

function observer(fail = false) {
  const clock = manualClock(Date.UTC(2026, 9, 5));
  const sent: ObservedExceptionInput[] = [];
  return {
    sent,
    crash: createCrashObserver({
      ids: createIdSource({ clock, random: cryptoRandom }),
      now: () => clock.nowMs(),
      report: (input) => {
        if (fail) return Promise.reject(new Error("problems unreachable"));
        sent.push(input);
        return Promise.resolve();
      },
    }),
  };
}

// 실제 자식을 끝까지 돌려 종료 code와 stderr 끝부분을 받는다.
async function runChild(
  code: string,
  denoArgs: string[] = [],
): Promise<{ exitCode: number | null; stderrTail: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["eval", ...denoArgs, code],
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  }).output();
  return {
    exitCode: output.signal ? null : output.code,
    stderrTail: new TextDecoder().decode(output.stderr).slice(-2000),
  };
}

Deno.test("apps/runtime#R28: 실제 V8 OOM 종료와 보통의 예상 밖 종료는 서로 다른 근거로 problems에 간다", async () => {
  const env = observer();
  const oom = await runChild(
    `const keep = []; while (true) keep.push(new Array(100_000).fill(1));`,
    ["--v8-flags=--max-old-space-size=24"],
  );
  assert(oom.exitCode !== 0);
  const crashed = await runChild(`Deno.exit(7)`);
  assertEquals(crashed.exitCode, 7);

  const first = await env.crash.observe({
    kind: "exit",
    intended: false,
    ...oom,
  });
  const second = await env.crash.observe({
    kind: "exit",
    intended: false,
    ...crashed,
  });
  assertEquals(first?.evidence, "v8_oom");
  assertEquals(second?.evidence, "unexpected_exit");
  assertEquals(env.sent.length, 2);
  assertEquals(env.sent[0].error?.name, "v8_oom");
  assertEquals(
    env.sent[1].error?.message,
    "the app process exited with code 7",
  );
  // 보낸 값은 problems contract를 그대로 통과하고 process_exit 관측이다.
  for (const input of env.sent) {
    assertEquals(input.observation, "process_exit");
    exceptionObservationInputSchema.parse(input);
  }
  assert(env.sent[0].report_id !== env.sent[1].report_id);
});

Deno.test("apps/runtime#R28: ready timeout, 기동 실패, crash loop, 신호 종료가 각각 다른 근거 이름으로 남는다", async () => {
  const env = observer();
  const events: CrashEvent[] = [
    {
      kind: "start_failed",
      reason: { code: "start_failed", summary: "ready timeout" },
    },
    {
      kind: "start_failed",
      reason: { code: "start_failed", summary: "handler or schema mismatch" },
    },
    { kind: "crash_loop", exits: 6 },
    { kind: "exit", intended: false, exitCode: null, stderrTail: "" },
  ];
  const names: string[] = [];
  for (const event of events) {
    const outcome = await env.crash.observe(event);
    assert(outcome);
    names.push(outcome.evidence);
  }
  assertEquals(names, [
    "ready_timeout",
    "start_failed",
    "crash_loop",
    "unexpected_exit",
  ]);
  assertEquals(new Set(names).size, 4);
  assert(
    names.every((name) => (CRASH_EVIDENCE as readonly string[]).includes(name)),
  );
  assertEquals(
    env.sent[3].error?.message,
    "the app process was terminated by a signal",
  );
  assertEquals(
    env.sent[2].error?.message,
    "automatic restart stopped after 6 unexpected exits",
  );
});

Deno.test("apps/runtime#R28: 의도된 정지는 crash로 세지 않고 보내지 않는다", async () => {
  const env = observer();
  // 실제로 신호로 끝낸 자식도 의도 표시가 먼저면 보내지 않는다(R18).
  const child = new Deno.Command(Deno.execPath(), {
    args: ["eval", "setInterval(() => {}, 1000)"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.kill("SIGKILL");
  const status = await child.status;
  assertEquals(status.signal, "SIGKILL");
  const outcome = await env.crash.observe({
    kind: "exit",
    intended: true,
    exitCode: null,
    stderrTail: "",
  });
  assertEquals(outcome, undefined);
  assertEquals(env.sent.length, 0);
});

Deno.test("apps/runtime#R28: 보고 전송이 실패해도 관측은 남고 성공으로 말하지 않는다", async () => {
  const env = observer(true);
  const outcome = await env.crash.observe({
    kind: "exit",
    intended: false,
    exitCode: 1,
    stderrTail: "",
  });
  assert(outcome);
  assertEquals(outcome.reported, false);
  assertEquals(outcome.evidence, "unexpected_exit");
});
