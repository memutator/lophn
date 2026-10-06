// lophn-agent/harness/waiting-and-recovery R8–R10: 실제 core(임시 LOPHN_HOME, 실제 ledger)에서 agent
// runtime을 중단 지점에 죽이고 같은 core·provider 위에 새 runtime을 세워, run이 저장된 경계에서 같은
// run으로 이어지는지 본다. 완전 응답·확정 결과는 다시 부르지 않고 결과 없는 쓰기는 다시 보내지 않는다.
// provider는 fake provider이고 실제 provider와 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../packages/base/mod.ts";
import type { Script } from "../../tools/fake-provider/mod.ts";
import type { ToolLookup } from "../../packages/lophn-agent/harness/waiting-and-recovery/mod.ts";
import { decide as humanDecide } from "./testing/approvals-fixture.ts";
import {
  count,
  inspect,
  openRecoveryWorld,
  type RecoveryWorld,
  USER_TOKEN,
} from "./testing/run-recovery-world.ts";

const PLAN = {
  id: "plan",
  protocol: "messages" as const,
  reply: {
    text: "I will list projects and write two notes.",
    toolCalls: [
      { id: "toolu_1", name: "project.list", arguments: "{}" },
      {
        id: "toolu_2",
        name: "document.create",
        arguments: JSON.stringify({ note: "one" }),
      },
      {
        id: "toolu_3",
        name: "document.create",
        arguments: JSON.stringify({ note: "two" }),
      },
    ],
    usage: { input: 20, output: 8 },
    stop: "tool_calls" as const,
  },
};
const DONE = {
  id: "done",
  protocol: "messages" as const,
  reply: {
    text: "All three are done.",
    usage: { input: 40, output: 9 },
    stop: "end" as const,
  },
};
const SCRIPT: Script = { steps: [PLAN, DONE] };

function rows(world: RecoveryWorld, sql: string) {
  return inspect(world.server, sql, [world.run]);
}

function toolRows(world: RecoveryWorld) {
  return rows(
    world,
    `select response_key as key, state, json_extract(outcome, '$.kind') as kind,
       json_extract(outcome, '$.code') as code
     from tool_calls where run = ? order by response_order, attempt`,
  );
}

function runRow(world: RecoveryWorld) {
  return rows(
    world,
    "select state, outcome_kind, outcome_reason from runs where id = ?",
  )[0]!;
}

function recovered(world: RecoveryWorld): number {
  return count(
    world.server,
    "select count(*) as n from events where type = 'RunRecovered' and subject = '" +
      world.run + "'",
  );
}

// 시작한 run을 죽을 때까지 돌린다. 죽은 loop는 끝까지 실패하며 ledger에는 죽기 전 기록만 남는다.
async function runUntilDead(
  world: RecoveryWorld,
  options: Parameters<RecoveryWorld["runtime"]>[0],
) {
  const first = world.runtime(options);
  const started = await first.driver.startNext();
  assert(started.kind === "started", JSON.stringify(started));
  assertEquals(started.run, world.run);
  await started.done;
  assert(first.dead());
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: runtime을 둘째 tool 결과 저장 직후 죽이고 다시 세우면 완전 응답과 앞 두 call을 반복하지 않고 셋째부터 같은 run으로 이어 간다", async () => {
  const world = await openRecoveryWorld(SCRIPT);
  try {
    await runUntilDead(world, {
      die: { when: "after", path: "/v1/tool-calls/finish", nth: 2 },
    });
    // 죽은 시점: 첫 응답은 완전하게 저장됐고 읽기와 첫째 쓰기가 확정됐다. run은 진행 중이다.
    assertEquals(runRow(world)["state"], "running");
    assertEquals(world.effects.writes, ["one"]);
    assertEquals(toolRows(world).map((row) => row["kind"]), [
      "success",
      "success",
    ]);
    assertEquals(world.provider.requests().length, 1);

    world.clock.advance(60_000);
    const second = world.runtime();
    const report = await second.driver.recover();
    assert(report.ok);
    assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
    const end = await report.value[0]!.done!;
    assertEquals(end, {
      kind: "finished",
      outcome: { kind: "completed", reason: "answer_completed" },
    });

    // 반복 없음: 완전 응답은 한 번(model call 둘: 계획과 마무리), 읽기 한 번, 쓰기는 둘째·셋째 한 번씩.
    assertEquals(world.provider.requests().length, 2);
    assertEquals(world.effects.reads, 1);
    assertEquals(world.effects.writes, ["one", "two"]);
    assertEquals(
      count(
        world.server,
        "select count(*) as n from model_calls where state = 'finished' and run = '" +
          world.run + "'",
      ),
      2,
    );
    // 같은 run: 중복 run은 없고 tool call은 key마다 하나다.
    assertEquals(
      count(world.server, "select count(*) as n from runs"),
      1,
    );
    assertEquals(toolRows(world).map((row) => [row["key"], row["kind"]]), [
      ["toolu_1", "success"],
      ["toolu_2", "success"],
      ["toolu_3", "success"],
    ]);
    assertEquals(runRow(world)["outcome_kind"], "completed");
    assertEquals(recovered(world), 1);
    // 마무리 판단은 앞 응답과 세 결과를 이력으로 받았다.
    const final = JSON.stringify(world.provider.requests()[1]!.body);
    for (const key of ["toolu_1", "toolu_2", "toolu_3"]) {
      assert(final.includes(key), key);
    }
    assert(final.includes("Wrote one."));
    assert(final.includes("Wrote two."));
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: 쓰기 결과를 저장하지 못하면 완료로 가정하지 않고 불명확으로 남기며 남은 call을 시작하지 않는다", async () => {
  const world = await openRecoveryWorld(SCRIPT);
  try {
    // 첫째 쓰기의 결과 기록(두 번째 finish)이 유실된다. 효과는 일어났다.
    const runtime = world.runtime({
      failOnce: { path: "/v1/tool-calls/finish", nth: 2 },
    });
    const started = await runtime.driver.startNext();
    assert(started.kind === "started");
    await started.done;
    // 저장하지 못한 결과는 ledger에서 끝나지 않았고 남은 쓰기는 시작하지 않았다.
    assertEquals(world.effects.writes, ["one"]);
    assertEquals(toolRows(world).map((row) => [row["state"], row["kind"]]), [
      ["finished", "success"],
      ["started", null],
      ["finished", "not_executed"],
    ]);
    // 다음 판단에 전한 결과도 성공이 아니라 불명확이다.
    const next = JSON.stringify(world.provider.requests()[1]!.body);
    assert(next.includes("uncertain"));
    assert(!next.includes("Wrote one."));
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R10: 결과 없이 시작만 있는 쓰기는 결과 조회가 없으면 다시 보내지 않고 effect_unknown으로 끝내며 남은 call과 뒤 판단을 시작하지 않는다", async () => {
  const world = await openRecoveryWorld(SCRIPT);
  try {
    // 첫째 쓰기의 효과는 일어났고 결과 기록이 유실된 채 죽는다.
    await runUntilDead(world, {
      die: { when: "before", path: "/v1/tool-calls/finish", nth: 2 },
    });
    assertEquals(world.effects.writes, ["one"]);
    assertEquals(toolRows(world)[1]!["state"], "started");

    world.clock.advance(1000);
    const report = await world.runtime().driver.recover();
    assert(report.ok);
    assertEquals(report.value.map((entry) => entry.result), ["finished"]);

    // 다시 보내지 않았다: 효과는 한 번이고 셋째 call도 시작하지 않았다. 뒤 판단 model도 없다.
    assertEquals(world.effects.writes, ["one"]);
    assertEquals(world.provider.requests().length, 1);
    const run = runRow(world);
    assertEquals([run["state"], run["outcome_kind"], run["outcome_reason"]], [
      "finished",
      "failed",
      "effect_unknown",
    ]);
    // 불명확 효과와 남은 일이 따로 남는다. 성공이나 미실행으로 추측하지 않는다.
    assertEquals(toolRows(world).map((row) => row["kind"]), [
      "success",
      "uncertain",
      "not_executed",
    ]);
    const facts = JSON.parse(
      String(
        rows(world, "select result_facts as f from runs where id = ?")[0]!["f"],
      ),
    );
    assertEquals(facts.confirmed.unknown_effects.length, 1);
    assertEquals(facts.confirmed.unexecuted.length, 1);
    assertEquals(recovered(world), 1);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R10: 응답이 유실된 쓰기는 소유 계약의 결과 조회로 확정한 결과를 쓰고 다시 보내지 않는다", async () => {
  const world = await openRecoveryWorld(SCRIPT);
  try {
    await runUntilDead(world, {
      die: { when: "before", path: "/v1/tool-calls/finish", nth: 2 },
    });
    const asked: string[] = [];
    const lookup: ToolLookup = (call) => {
      asked.push(call.tool_call);
      return Promise.resolve({
        outcome: { kind: "success" as const, code: "ok" },
        result: {
          status: "success" as const,
          summary: "Wrote one.",
          content: { note: "one" },
          complete: true,
          source: null,
          continuation: null,
          pending: [],
        },
      });
    };
    const runtime = world.runtime({
      lookups: new Map([["document.create", lookup]]),
    });
    const report = await runtime.driver.recover();
    assert(report.ok);
    assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
    await report.value[0]!.done!;
    // 조회한 call은 하나이고 그 쓰기는 다시 실행하지 않았다. 셋째 쓰기만 새로 한 번 실행했다.
    assertEquals(asked.length, 1);
    assertEquals(world.effects.writes, ["one", "two"]);
    assertEquals(toolRows(world).map((row) => row["kind"]), [
      "success",
      "success",
      "success",
    ]);
    assertEquals(runRow(world)["outcome_kind"], "completed");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R9: 멈춘 assignment의 run은 복구가 풀지 않고 입력과 확정 결과를 남긴 채 멈춤으로 끝난다", async () => {
  const world = await openRecoveryWorld(SCRIPT);
  try {
    await runUntilDead(world, {
      die: { when: "after", path: "/v1/tool-calls/finish", nth: 2 },
    });
    const paused = await world.post("assignments/pause", USER_TOKEN, {
      assignment: world.assignment.id,
      reason: {
        kind: "user",
        detail: "paused while the runtime was down",
        runs: [],
        target: null,
      },
    }, { revision: world.assignment.revision, state: "enabled" });
    assertEquals(paused.status, 200, JSON.stringify(paused.body));

    const report = await world.runtime().driver.recover();
    assert(report.ok);
    assertEquals(report.value.map((entry) => entry.result), ["stopped"]);
    const run = runRow(world);
    assertEquals([run["state"], run["outcome_kind"], run["outcome_reason"]], [
      "finished",
      "stopped",
      "assignment_paused",
    ]);
    // 새 model call도 새 효과도 없다. 확정한 결과와 사람의 입력은 그대로다.
    assertEquals(world.provider.requests().length, 1);
    assertEquals(world.effects.writes, ["one"]);
    assertEquals(toolRows(world).length, 2);
    assertEquals(
      count(world.server, "select count(*) as n from messages"),
      1,
    );
    // 멈춘 run은 다음 기동에도 다시 복구하지 않는다.
    const again = await world.runtime().driver.recover();
    assert(again.ok);
    assertEquals(again.value, []);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R9: 재시작이 누적 한도를 초기화하지 않는다. 중단 시간을 센 한도를 넘으면 새 진입 없이 확정 결과를 남기고 끝낸다", async () => {
  const world = await openRecoveryWorld(SCRIPT);
  try {
    await runUntilDead(world, {
      die: { when: "after", path: "/v1/tool-calls/finish", nth: 2 },
    });
    // 기본 stall 한도는 5분(active는 30분)이다. 꺼져 있던 6분을 보수적으로 센다.
    world.clock.advance(6 * 60_000);
    const report = await world.runtime().driver.recover();
    assert(report.ok);
    assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
    const end = await report.value[0]!.done!;
    assertEquals(end, {
      kind: "finished",
      outcome: { kind: "failed", reason: "stall_limit" },
    });
    // 셋째 쓰기도 뒤 판단도 없다. 앞 두 확정 결과는 그대로다.
    assertEquals(world.provider.requests().length, 1);
    assertEquals(world.effects.writes, ["one"]);
    assertEquals(toolRows(world).map((row) => row["kind"]), [
      "success",
      "success",
      "not_executed",
    ]);
    assertEquals(runRow(world)["outcome_reason"], "stall_limit");
  } finally {
    await world.dispose();
  }
});

const ASK = {
  id: "ask",
  protocol: "messages" as const,
  reply: {
    text: "I need a person to confirm this write.",
    toolCalls: [{
      id: "toolu_1",
      name: "document.save_version",
      arguments: JSON.stringify({ note: "approve me" }),
    }],
    usage: { input: 20, output: 8 },
    stop: "tool_calls" as const,
  },
};

async function waitForApproval(world: RecoveryWorld) {
  const runtime = world.runtime();
  const started = await runtime.driver.startNext();
  assert(started.kind === "started", JSON.stringify(started));
  const end = await started.done;
  assertEquals(end.kind, "waiting");
  assertEquals(runRow(world)["state"], "waiting_user");
  const approval = inspect(
    world.server,
    "select id from approval_requests where run = ?",
    [world.run],
  )[0]!["id"] as string;
  return { runtime, approval };
}

async function grant(world: RecoveryWorld, approval: string) {
  const read = await world.read("approvals/get", USER_TOKEN, { approval });
  const reply = await humanDecide(
    world.server,
    USER_TOKEN,
    (read.body as { request: never })["request"],
    "grant",
    null,
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R11: approval 대기 중 재시작해도 허락 한 번으로 그 call 하나만 한 번 실행하고 같은 run을 이어 간다", async () => {
  const world = await openRecoveryWorld({ steps: [ASK, DONE] });
  try {
    const { approval } = await waitForApproval(world);
    await grant(world, approval);
    // runtime이 죽었다가 다시 선다. 대기 요청은 실제 현재 결정과 미시작 증거로 이어진다.
    const second = world.runtime();
    const report = await second.driver.recover();
    assert(report.ok);
    assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
    const end = await report.value[0]!.done!;
    assertEquals(end.kind, "finished");
    assertEquals(world.effects.writes, ["approve me"]);
    assertEquals(world.provider.requests().length, 2);
    assertEquals(runRow(world)["outcome_kind"], "completed");
    // 같은 허락으로 그 call의 진입은 한 번만 기록됐다.
    assertEquals(
      count(
        world.server,
        "select count(*) as n from events where type = 'ToolCallStarted'",
      ),
      1,
    );
    // 다시 기동해도 끝난 run은 건드리지 않는다.
    const third = await world.runtime().driver.recover();
    assert(third.ok);
    assertEquals(third.value, []);
    assertEquals(world.effects.writes, ["approve me"]);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R2: 사람의 결정으로 재개된 run은 같은 process에서 이력을 ledger로 다시 만들어 이어 가고 결정을 사용한 call만 한 번 실행한다", async () => {
  const world = await openRecoveryWorld({ steps: [ASK, DONE] });
  try {
    const { runtime, approval } = await waitForApproval(world);
    // 아직 결정이 없으면 계속 기다린다.
    const waiting = await runtime.driver.resume(world.run);
    assertEquals(waiting.result, "waiting");
    assertEquals(world.effects.writes, []);
    await grant(world, approval);
    const resumed = await runtime.driver.resume(world.run);
    assertEquals(resumed.result, "resumed");
    assertEquals((await resumed.done!).kind, "finished");
    assertEquals(world.effects.writes, ["approve me"]);
    assertEquals(runRow(world)["outcome_kind"], "completed");
    // 마무리 판단은 허락을 받은 call의 결과를 이력으로 받았다.
    const final = JSON.stringify(world.provider.requests()[1]!.body);
    assert(final.includes("Wrote approve me."));
    assert(ok(undefined).ok);
  } finally {
    await world.dispose();
  }
});
