// 세 질문
// - contract: boundary `run-loop`(멈춤은 진행 중인 요청과 tool 실행을 끊고 새 진입을 막는다), `agent-sessions`(turn이 사람 멈춤으로
//   닫히고, archive·delete는 한 tx이며 도는 turn은 interrupted로 닫힌다), `approvals`(낡은 허락은 쓰이지 않는다).
// - 현실적 회귀: core가 turn을 닫았는데 child의 model 요청이 계속 열려 token을 쓰는 것, 멈춘 뒤에도 tool이 시작되는 것,
//   멈춤 신호가 child에 안 가 turn이 running으로 남는 것, 멈췄는데 shell 명령이 계속 돌거나 늦게 끝나 반쯤 쓴 file이 남는 것,
//   멈춘 뒤 도착한 `once`가 명령을 돌리는 것, session을 archive하거나 지웠는데 model 요청이 token을 계속 쓰는 것.
// - 왜 지금 test로 못 잡나: harness loop는 `stop()`을 부르는 쪽(in-process)만 본다. core의 `turns/stop` → 감독 pipe →
//   child의 loop → HTTP 연결 끊김과 shell process, 그리고 archive·delete의 연쇄는 process를 건너야 이어진다.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import { turnRequestDecide } from "../../packages/protocol/approvals/mod.ts";
import { sessionSnapshotsList } from "../../packages/protocol/events/mod.ts";
import {
  archiveSession,
  deleteSession,
  LOPHN_AGENT_ID,
  workspaceSessionRead,
  toolCallList,
  turnRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  connectFakeProvider,
  openWorkspaceSession,
  openProject,
  say,
  stopTurn,
  turnsOf,
  until,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { runtimePids } from "../support/core/process.ts";
import { shellAsk } from "../support/core/shell-ask.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

const WAIT_MS = 30_000;

// 멈춤이 안 먹히면 hang 대신 무엇을 기다렸는지 담은 실패로 끝낸다.
async function within<T>(what: string, promise: Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(WAIT_MS);
  let onAbort = () => {};
  const timeout = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(new Error(`${WAIT_MS}ms 안에 ${what}이(가) 되지 않았다`));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else found.push(path);
  }
  return found;
}

test("사람이 멈추면 진행 중인 model 요청이 끊기고 응답의 tool은 실행되지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    // tool call 하나를 말하다가(인자의 앞 절반만 보내고) 멈춘 응답이다. 사람이 멈추지 않으면 끝나지 않는다.
    fake.script([
      {
        reply: {
          kind: "stall",
          partial: {
            tool: {
              id: "t1",
              name: "file_write",
              arguments: JSON.stringify({ path: "stopped.md", content: "x" }),
            },
          },
        },
      },
    ]);
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const proj = `${run.work}/proj`;
    await mkdir(proj);
    const { project } = await openProject(core, proj);
    const session = await openWorkspaceSession(core, LOPHN_AGENT_ID, {
      kind: "project",
      id: project,
    });

    await say(core, session, "write stopped.md");
    await within("model 요청이 도착함", fake.arrived(1));
    const running = (await turnsOf(core, session)).find(
      (turn) => turn.state === "running",
    );
    assert.ok(running, "running turn이 있어야 한다");
    await stopTurn(core, running.id);
    await within("model 요청이 끊김", fake.aborted(1));
    const ended = await waitTurnEnd(core, session);

    // fake가 받은 요청: 멈춘 뒤 새 요청이나 retry가 없다.
    assert.deepStrictEqual(fake.journal().length, 1);
    // ledger: 사람이 멈춘 이유로 닫히고 tool call 기록이 없다.
    const { turn } = await core.call(turnRead, { turn: ended.id });
    assert.deepStrictEqual(turn.state, "finished");
    assert.deepStrictEqual(turn.outcome, {
      kind: "interrupted",
      reason: "user_stopped",
    });
    const { tool_calls } = await core.call(toolCallList, { turn: ended.id });
    assert.deepStrictEqual(tool_calls, []);
    // disk: 쓰기가 일어나지 않았다.
    assert.deepStrictEqual(await filesUnder(proj), []);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});

// 새 행이 같이 쓰는 준비다: core, fake 연결, project 폴더 하나. 행이 fake.script를 부른다.
async function inProject(
  body: (t: {
    core: Core;
    fake: FakeServer;
    proj: string;
    project: string;
  }) => Promise<void>,
): Promise<void> {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const proj = `${run.work}/proj`;
    await mkdir(proj);
    const { project } = await openProject(core, proj);
    await body({ core, fake, proj, project });
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
}

async function runningTurn(core: Core, session: string) {
  const running = (await turnsOf(core, session)).find(
    (turn) => turn.state === "running",
  );
  assert.ok(running, "running turn이 있어야 한다");
  return running;
}

const stallReply = {
  reply: { kind: "stall", partial: { text: "thinking" } },
} as const;
const textReply = { reply: { kind: "text", text: "ok" } } as const;

test("shell이 도는 중 멈추면 shell process group이 죽는다", async () => {
  await inProject(async ({ core, fake, proj, project }) => {
    // /proc에서 찾을 표지다. core.ids의 무작위 값에서 숫자 다섯 자리를 만든다.
    const marker = `2999.${[...core.ids.newId("key").slice(-5)]
      .map((c) => c.charCodeAt(0) % 10)
      .join("")}`;
    const alive = async () => {
      const found: number[] = [];
      for (const entry of await readdir("/proc", { withFileTypes: true })) {
        if (!/^\d+$/.test(entry.name)) continue;
        const argv = await readFile(
          `/proc/${entry.name}/cmdline`,
          "utf8",
        ).catch(() => "");
        if (argv.includes(`sleep ${marker}`)) found.push(Number(entry.name));
      }
      return found;
    };
    fake.script([
      {
        reply: {
          kind: "tool",
          calls: [
            {
              id: "sh1",
              name: "shell_run",
              arguments: JSON.stringify({
                command: `touch started && sleep ${marker}`,
              }),
            },
          ],
        },
      },
    ]);
    const session = await openWorkspaceSession(core, LOPHN_AGENT_ID, {
      kind: "project",
      id: project,
    });
    await say(core, session, "run the long command");
    await until(
      "shell이 started를 씀",
      async () =>
        await stat(`${proj}/started`).then(
          () => true,
          () => undefined,
        ),
    );
    assert.ok(
      (await alive()).length > 0,
      "표지를 가진 process가 떠 있어야 한다",
    );
    await stopTurn(core, (await runningTurn(core, session)).id);
    const ended = await waitTurnEnd(core, session);

    // process: shell group이 통째로 죽었다.
    await until("shell process가 사라짐", async () =>
      (await alive()).length === 0 ? true : undefined,
    );
    // ledger: 사람이 멈춘 이유로 닫히고 shell call은 success가 아니다.
    assert.deepStrictEqual(ended.outcome, {
      kind: "interrupted",
      reason: "user_stopped",
    });
    const { tool_calls } = await core.call(toolCallList, { turn: ended.id });
    assert.ok(
      tool_calls.every((call) => call.outcome?.kind !== "success"),
      "멈춘 shell call이 success로 기록됐다",
    );
    // fake가 받은 요청: 멈춘 뒤 새 요청이 없다.
    assert.deepStrictEqual(fake.journal().length, 1);
  });
});

test("허락을 기다리는 중 멈추면 늦게 온 허락이 명령을 일으키지 못한다", async () => {
  await inProject(async ({ core, fake, proj, project }) => {
    const ask = await shellAsk(proj);
    fake.script([{ reply: ask.reply("w1") }]);
    const session = await openWorkspaceSession(core, LOPHN_AGENT_ID, {
      kind: "project",
      id: project,
    });
    await say(core, session, "write the rules");
    const { request } = await waitPermission(core, session);
    await stopTurn(core, (await runningTurn(core, session)).id);
    const ended = await waitTurnEnd(core, session);
    const late = await core.tryCall(turnRequestDecide, {
      session,
      request,
      choice: { kind: "once" },
    });

    // route: 늦은 허락은 거절되고 대기 중이던 요청은 비었다.
    assert.ok(!late.ok, "멈춘 뒤의 once가 받아들여졌다");
    const { snapshots } = await core.call(sessionSnapshotsList, {
      sessions: [session],
    });
    assert.deepStrictEqual(snapshots[0].turn_requests, []);
    // ledger
    assert.deepStrictEqual(ended.outcome, {
      kind: "interrupted",
      reason: "user_stopped",
    });
    const { tool_calls } = await core.call(toolCallList, { turn: ended.id });
    assert.ok(
      tool_calls.every((call) => call.outcome?.kind !== "success"),
      "허락 없이 멈춘 call이 success로 기록됐다",
    );
    // disk
    assert.deepStrictEqual(await ask.exists(), true);
    // fake가 받은 요청
    assert.deepStrictEqual(fake.journal().length, 1);
  });
});

// archive와 지움은 진행 중인 model 요청을 끊고, runtime child는 그대로 살아 다음 session의 turn을 돌린다.
for (const how of ["archive", "delete"] as const) {
  test(`session을 ${how === "archive" ? "archive하면" : "지우면"} 진행 중인 model 요청이 끊긴다`, async () => {
    await inProject(async ({ core, fake, project }) => {
      fake.script([stallReply, textReply]);
      const workspace = { kind: "project", id: project } as const;
      const session = await openWorkspaceSession(
        core,
        LOPHN_AGENT_ID,
        workspace,
      );
      await say(core, session, "think forever");
      await fake.arrived(1);
      const pids = await runtimePids(core.run.home);
      const { session: current } = await core.call(workspaceSessionRead, {
        session,
      });
      const [turn] = await turnsOf(core, session);
      await core.call(
        how === "archive" ? archiveSession : deleteSession,
        {
          session,
        },
        { state_seq: current.state_seq },
      );
      await within("요청이 끊김", fake.aborted(1));
      const next = await openWorkspaceSession(core, LOPHN_AGENT_ID, workspace);
      await say(core, next, "hello");
      const done = await waitTurnEnd(core, next);

      // fake가 받은 요청: 끊긴 요청 뒤 새 session의 요청이 정상 답을 받았다.
      assert.deepStrictEqual(fake.journal().length, 2);
      assert.deepStrictEqual(done.outcome?.kind, "completed");
      // ledger
      if (how === "archive") {
        const archived = await core.call(workspaceSessionRead, { session });
        assert.deepStrictEqual(archived.session.lifecycle, "archived");
        const closed = await core.call(turnRead, { turn: turn.id });
        assert.deepStrictEqual(closed.turn.state, "finished");
        assert.deepStrictEqual(closed.turn.outcome, {
          kind: "interrupted",
          reason: "session_ended",
        });
      } else {
        const gone = await core.tryCall(workspaceSessionRead, { session });
        assert.ok(!gone.ok && gone.error.code === "not_found");
      }
      // process: runtime child가 그대로다.
      assert.deepStrictEqual(await runtimePids(core.run.home), pids);
    });
  });
}
