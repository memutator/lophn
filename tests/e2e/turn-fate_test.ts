// 세 질문
// - contract: boundary `run-loop`(돌던 turn은 child가 사라지면 interrupted(restarted)로 닫히고, child를 바꿀 일이 생겨도 도는 turn은
//   끝까지 간다), `supervision`(child 재기동의 한도와 포기), `agent-sessions`(session은 남고 새 입력이 새 turn을 연다).
// - 현실적 회귀: child가 죽거나 교체돼 turn 행이 running으로 남고 그 session이 사람이 멈출 때까지 새 입력을 못 받는 것
//   (`turns_running_session` unique index가 conflict를 낸다), 연속으로 죽는 child가 한도 안에서도 다시 뜨지 않는 것.
// - 왜 지금 test로 못 잡나: restart_test는 core가 꺼지는 길(RecoverCalls)만 본다. child 단독 종료는 어떤 test도 안 보고,
//   supervision은 process를 건너야 보인다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { projectApi } from "../../packages/protocol/projects/mod.ts";
import { platformHealth } from "../../packages/protocol/server/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  settle,
  turnsOf,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import { runtimePids } from "../support/core/process.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

// agent runtime child 하나를 SIGKILL로 죽이고 옛 pid를 돌려준다.
async function crash(core: Core): Promise<number> {
  const pids = await runtimePids(core.run.home);
  assertEquals(pids.length, 1);
  Deno.kill(pids[0], "SIGKILL");
  return pids[0];
}

// a: turn 도중 child가 crash하면 그 turn은 restarted로 닫히고 session은 새 입력을 받는다.
async function crashMidTurn(
  core: Core,
  fake: FakeServer,
  folder: string,
): Promise<string> {
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
  const session = await openSession(core, { role: "project_manager", project });
  await say(core, session, "write x.md");
  await fake.arrived(1);
  const old = await crash(core);
  await settle(core, [old]);
  await waitTurnEnd(core, session, 0);
  await say(core, session, "again");
  await waitTurnEnd(core, session, 1);

  // ledger
  const turns = await turnsOf(core, session);
  assertEquals(turns.map((turn) => [turn.state, turn.outcome?.kind]), [
    ["finished", "interrupted"],
    ["finished", "completed"],
  ]);
  assertEquals(turns[0].outcome, { kind: "interrupted", reason: "restarted" });
  // fake가 받은 요청: 끊긴 요청이 풀렸고 둘째 turn의 요청 하나만 더 왔다.
  await fake.aborted(1);
  assertEquals(fake.journal().length, 2);
  // process
  const pids = await runtimePids(core.run.home);
  assertEquals(pids.length, 1);
  assertNotEquals(pids[0], old);
  return project;
}

// b: turn이 도는 중 project 폴더가 더해져도 그 turn은 끝까지 가고, 끝난 뒤에 child가 새 폴더로 다시 뜬다.
async function folderAddedMidTurn(
  core: Core,
  fake: FakeServer,
  project: string,
  folder: string,
  second: string,
) {
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{
          id: "t1",
          name: "file_write",
          arguments: JSON.stringify({ path: "LOPHN.md", content: "rules" }),
        }],
      },
    },
    { reply: { kind: "text", text: "done" } },
    { reply: { kind: "text", text: "again" } },
  ]);
  const session = await openSession(core, { role: "project_manager", project });
  await say(core, session, "write the rules");
  const { request } = await waitPermission(core, session);
  const old = await runtimePids(core.run.home);
  const added = core.ids.newId("prj");
  await core.call(projectApi.register, {
    id: added,
    name: "second",
    title: "second",
    purpose: "",
    folders: [{ path: second, description: "", subfolders: [] }],
  });
  await decide(core, session, request, "allow");
  await waitTurnEnd(core, session, 0);
  await settle(core, old);
  await say(core, session, "again");
  await waitTurnEnd(core, session, 1);

  // ledger
  const turns = await turnsOf(core, session);
  assertEquals(turns.map((turn) => turn.outcome?.kind), [
    "completed",
    "completed",
  ]);
  // disk
  assertEquals(await Deno.readTextFile(`${folder}/LOPHN.md`), "rules");
  // process
  const pids = await runtimePids(core.run.home);
  assertEquals(pids.length, 1);
  assert(!old.includes(pids[0]));
}

// c: 연속으로 죽는 child는 세 번까지 다시 뜨고 session은 계속 일한다.
// 네 번째에 포기하는 것과 60초를 버틴 child가 횟수를 0으로 되돌리는 것은 run_test(unit)가 본다. 관찰에는 감독의 까닭이
// 안 나오고 60초를 기다릴 수도 없다. 앞 행(b)이 child를 새 slot으로 띄운 뒤라 횟수는 0에서 센다.
async function consecutiveCrashes(core: Core, fake: FakeServer) {
  fake.reset();
  fake.script([{ reply: { kind: "text", text: "ok" } }]);
  const session = await openSession(core, { role: "lophn" });
  for (let n = 0; n < 3; n++) await settle(core, [await crash(core)]);
  await say(core, session, "hello");
  await waitTurnEnd(core, session);

  // process: 세 번 죽은 뒤에도 runtime이 하나 있고 감독이 available로 본다.
  const health = await core.call(platformHealth, {});
  assertEquals(
    health.observations.find((item) => item.component === "agent-runtime")
      ?.available,
    true,
  );
  assertEquals((await runtimePids(core.run.home)).length, 1);
  // ledger와 fake: turn이 열려 끝났다.
  assertEquals((await turnsOf(core, session))[0].outcome?.kind, "completed");
  assertEquals(fake.journal().length, 1);
}

Deno.test("E2E agent runtime child가 사라져도 돌던 turn은 닫히고 session은 새 입력을 받는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    const second = `${run.work}/second`;
    await Deno.mkdir(folder);
    await Deno.mkdir(second);
    const project = await crashMidTurn(core, fake, folder);
    await folderAddedMidTurn(core, fake, project, folder, second);
    await consecutiveCrashes(core, fake);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
