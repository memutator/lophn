// 세 질문
// - contract: boundary `run-loop`(멈춤은 진행 중인 요청을 끊고 새 진입을 막는다), `agent-sessions`(turn이 사람 멈춤으로 닫힌다).
// - 현실적 회귀: core가 turn을 닫았는데 child의 model 요청이 계속 열려 token을 쓰는 것, 멈춘 뒤에도 tool이 시작되는 것,
//   멈춤 신호가 child에 안 가 turn이 running으로 남는 것.
// - 왜 지금 test로 못 잡나: harness loop는 `stop()`을 부르는 쪽(in-process)만 본다. core의 `turns/stop` → 감독 pipe →
//   child의 loop → HTTP 연결 끊김까지는 process를 건너야 이어진다.
import { assert, assertEquals } from "@std/assert";
import {
  toolCallList,
  turnRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  stopTurn,
  turnsOf,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

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
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...await filesUnder(path));
    else found.push(path);
  }
  return found;
}

Deno.test("사람이 멈추면 진행 중인 model 요청이 끊기고 응답의 tool은 실행되지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    // tool call 하나를 말하다가(인자의 앞 절반만 보내고) 멈춘 응답이다. 사람이 멈추지 않으면 끝나지 않는다.
    fake.script([{
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
    }]);
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const proj = `${run.work}/proj`;
    await Deno.mkdir(proj);
    const { project } = await openProject(core, proj);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });

    await say(core, session, "write stopped.md");
    await within("model 요청이 도착함", fake.arrived(1));
    const running = (await turnsOf(core, session)).find((turn) =>
      turn.state === "running"
    );
    assert(running, "running turn이 있어야 한다");
    await stopTurn(core, running.id);
    await within("model 요청이 끊김", fake.aborted(1));
    const ended = await waitTurnEnd(core, session);

    // fake가 받은 요청: 멈춘 뒤 새 요청이나 retry가 없다.
    assertEquals(fake.journal().length, 1);
    // ledger: 사람이 멈춘 이유로 닫히고 tool call 기록이 없다.
    const { turn } = await core.call(turnRead, { turn: ended.id });
    assertEquals(turn.state, "finished");
    assertEquals(turn.outcome, { kind: "interrupted", reason: "user_stopped" });
    const { tool_calls } = await core.call(toolCallList, { turn: ended.id });
    assertEquals(tool_calls, []);
    // disk: 쓰기가 일어나지 않았다.
    assertEquals(await filesUnder(proj), []);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
