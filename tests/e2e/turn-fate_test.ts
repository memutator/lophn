// 세 질문
// - contract: boundary `run-loop`(돌던 turn은 child가 사라지면 interrupted(restarted)로 닫힌다),
//   `supervision`(child 재기동의 한도와 포기), `agent-sessions`(session은 남고 새 입력이 새 turn을 연다).
// - 현실적 회귀: child가 죽어 turn 행이 running으로 남고 그 session이 사람이 멈출 때까지 새 입력을 못 받는 것
//   (`turns_running_session` unique index가 conflict를 낸다), 연속으로 죽는 child가 한도 안에서도 다시 뜨지 않는 것.
// - 왜 지금 test로 못 잡나: restart_test는 core가 꺼지는 길(RecoverCalls)만 본다. child 단독 종료는 어떤 test도 안 보고,
//   supervision은 process를 건너야 보인다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import process from "node:process";
import { test } from "node:test";
import { LOPHN_AGENT_ID } from "../../packages/protocol/lophn-agent/mod.ts";
import { platformHealth } from "../../packages/protocol/server/mod.ts";
import {
  connectFakeProvider,
  openWorkspaceSession,
  openProject,
  say,
  turnsOf,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { runtimePids } from "../support/core/process.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

// agent runtime child 하나를 SIGKILL로 죽이고, 감독이 새 child를 ready로 띄울 때까지 기다린 뒤 옛 pid를 돌려준다.
async function crash(core: Core): Promise<number> {
  const pids = await runtimePids(core.run.home);
  assert.deepStrictEqual(pids.length, 1);
  const old = pids[0];
  process.kill(old, "SIGKILL");
  await until("agent runtime이 다시 뜸", async () => {
    const current = await runtimePids(core.run.home);
    if (current.length === 0 || current.includes(old)) return;
    const health = await core.call(platformHealth, {});
    return health.observations.find(
      (item) => item.component === "agent-runtime",
    )?.available
      ? true
      : undefined;
  });
  return old;
}

// a: turn 도중 child가 crash하면 그 turn은 restarted로 닫히고 session은 새 입력을 받는다.
async function crashMidTurn(core: Core, fake: FakeServer, folder: string) {
  fake.script([
    {
      reply: {
        kind: "stall",
        partial: {
          tool: {
            id: "t1",
            name: "file_write",
            arguments: JSON.stringify({ path: "x.md", content: "x" }),
          },
        },
      },
    },
    { reply: { kind: "text", text: "back" } },
  ]);
  const { project } = await openProject(core, folder);
  const session = await openWorkspaceSession(core, LOPHN_AGENT_ID, {
    kind: "project",
    id: project,
  });
  await say(core, session, "write x.md");
  await fake.arrived(1);
  const old = await crash(core);
  await waitTurnEnd(core, session, 0);
  await say(core, session, "again");
  await waitTurnEnd(core, session, 1);

  // ledger
  const turns = await turnsOf(core, session);
  assert.deepStrictEqual(
    turns.map((turn) => [turn.state, turn.outcome?.kind]),
    [
      ["finished", "interrupted"],
      ["finished", "completed"],
    ],
  );
  assert.deepStrictEqual(turns[0].outcome, {
    kind: "interrupted",
    reason: "restarted",
  });
  // fake가 받은 요청: 끊긴 요청이 풀렸고 둘째 turn의 요청 하나만 더 왔다.
  await fake.aborted(1);
  assert.deepStrictEqual(fake.journal().length, 2);
  // process
  const pids = await runtimePids(core.run.home);
  assert.deepStrictEqual(pids.length, 1);
  assert.notStrictEqual(pids[0], old);
}

// c: 연속으로 죽는 child는 세 번까지 다시 뜨고 session은 계속 일한다.
// 네 번째에 포기하는 것과 60초를 버틴 child가 횟수를 0으로 되돌리는 것은 run_test(unit)가 본다. 관찰에는 감독의 까닭이
// 안 나오고 60초를 기다릴 수도 없다. a의 crash가 횟수에 남지 않게 core를 다시 띄운 뒤 센다.
async function consecutiveCrashes(core: Core, fake: FakeServer) {
  fake.reset();
  fake.script([{ reply: { kind: "text", text: "ok" } }]);
  const session = await openWorkspaceSession(core, LOPHN_AGENT_ID);
  for (let n = 0; n < 3; n++) await crash(core);
  await say(core, session, "hello");
  await waitTurnEnd(core, session);

  // process: 세 번 죽은 뒤에도 runtime이 하나 있고 감독이 available로 본다.
  const health = await core.call(platformHealth, {});
  assert.deepStrictEqual(
    health.observations.find((item) => item.component === "agent-runtime")
      ?.available,
    true,
  );
  assert.deepStrictEqual((await runtimePids(core.run.home)).length, 1);
  // ledger와 fake: turn이 열려 끝났다.
  assert.deepStrictEqual(
    (await turnsOf(core, session))[0].outcome?.kind,
    "completed",
  );
  assert.deepStrictEqual(fake.journal().length, 1);
}

test("E2E agent runtime child가 사라져도 돌던 turn은 닫히고 session은 새 입력을 받는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await mkdir(folder);
    await crashMidTurn(core, fake, folder);
    await core.kill();
    core = await bootCore(run);
    await consecutiveCrashes(core, fake);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
