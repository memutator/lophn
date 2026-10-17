// 세 질문
// - contract: boundary `run-loop`(재시작 때 돌던 turn은 interrupted/restarted로 닫힌다), `approvals`(turn 안 permission
//   request는 메모리라 재시작에 사라진다), `agent-sessions`(session은 남고 새 message가 새 turn을 연다).
// - 현실적 회귀: 재시작 뒤 turn이 running으로 남아 session이 영원히 바쁜 것, 사라졌어야 할 permission request가 남아
//   낡은 허락이 쓰이는 것, 재시작 뒤 새 message를 받지 못하는 것.
// - 왜 지금 test로 못 잡나: interruptRunningTurns는 함수 단위 test도 없고, ledger 파일이 남고 새 process가 읽는
//   core의 꺼졌다 켜짐은 process를 건너야 보인다.
import { assert, assertEquals } from "@std/assert";
import { agentSessionRead } from "../../packages/protocol/lophn-agent/mod.ts";
import { sessionSnapshotsList } from "../../packages/protocol/events/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  settle,
  turnsOf,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

Deno.test("E2E core가 허락을 기다리다 꺼졌다 켜지면 turn은 interrupted로 닫히고 session은 새 message를 받는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    const folder = `${run.work}/proj`;
    await Deno.mkdir(folder);
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
      { reply: { kind: "text", text: "back" } },
    ]);
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const { project } = await openProject(core, folder);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });

    await say(core, session, "write rules");
    await waitPermission(core, session);
    await core.kill();
    core = await bootCore(run);
    await settle(core);

    // 메모리라 재시작에 사라진 permission request
    const { snapshots } = await core.call(sessionSnapshotsList, {
      sessions: [session],
    });
    assertEquals(snapshots[0]?.permission_requests, []);

    await say(core, session, "again");
    await waitTurnEnd(core, session, 1);

    const turns = await turnsOf(core, session);
    assertEquals(turns.map((turn) => [turn.state, turn.outcome?.kind]), [
      ["finished", "interrupted"],
      ["finished", "completed"],
    ]);
    const first = turns[0].outcome;
    assert(first?.kind === "interrupted");
    assertEquals(first.reason, "restarted");
    const read = await core.call(agentSessionRead, { session });
    assertEquals(read.session.lifecycle, "open");

    const written = await Deno.stat(`${folder}/LOPHN.md`).then(
      () => true,
      () => false,
    );
    assertEquals(written, false);
    assertEquals(fake.journal().length, 2);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
