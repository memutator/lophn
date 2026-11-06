// 세 질문
// - contract: boundary `run-loop`(재시작 때 돌던 turn은 interrupted/restarted로 닫힌다), `approvals`(turn 안 turn
//   request는 메모리라 재시작에 사라진다), `agent-sessions`(session은 남고 새 message가 새 turn을 연다).
// - 현실적 회귀: 재시작 뒤 turn이 running으로 남아 session이 영원히 바쁜 것, 사라졌어야 할 turn request가 남아
//   낡은 허락이 쓰이는 것, 재시작 뒤 새 message를 받지 못하는 것.
// - 왜 지금 test로 못 잡나: interruptRunningTurns는 함수 단위 test도 없고, ledger 파일이 남고 새 process가 읽는
//   core의 꺼졌다 켜짐은 process를 건너야 보인다.
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import { test } from "node:test";
import { sessionSnapshotsList } from "../../packages/protocol/events/mod.ts";
import {
  LOPHN_AGENT_ID,
  modelCallList,
  receivedMessageList,
  toolCallList,
  turnList,
  workspaceSessionRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { SECRET_FILE_NAME } from "../../packages/protocol/secrets/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openWorkspaceSession,
  say,
  settle,
  turnsOf,
  until,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { shellAsk } from "../support/core/shell-ask.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

// 아래 두 행의 세 질문
// - contract: boundary `storage`·`secrets`(완료한 기록과 provider 연결은 재시작에 남는다), `router`·`agent-sessions`(queue는
//   메모리라 사라지지만 접수한 사람 message는 사라진 것으로 두지 않는다).
// - 현실적 회귀: 재시작 뒤 기록이 비거나 key를 다시 넣어야 하는 것, 사람이 보낸 message가 접수 기록만 남고 영영 turn이 안 열리는 것.
// - 왜 지금 test로 못 잡나: 위 행은 interrupted turn과 사라진 허락 요청만 본다. 완료한 기록의 보존과 queue에 쌓인 사람 message의
//   운명은 ledger 파일이 남고 새 process가 읽는 재시작을 건너야 보인다.

test("E2E core가 허락을 기다리다 꺼졌다 켜지면 turn은 interrupted로 닫히고 session은 새 message를 받는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    const folder = `${run.work}/proj`;
    await mkdir(folder);
    const ask = await shellAsk(folder);
    fake.script([
      { reply: ask.reply("t1") },
      { reply: { kind: "text", text: "back" } },
    ]);
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const { project } = await openProject(core, folder);
    const session = await openWorkspaceSession(core, LOPHN_AGENT_ID, {
      kind: "project",
      id: project,
    });

    await say(core, session, "write rules");
    await waitPermission(core, session);
    await core.kill();
    core = await bootCore(run);
    await settle(core);

    // 메모리라 재시작에 사라진 turn request
    const { snapshots } = await core.call(sessionSnapshotsList, {
      sessions: [session],
    });
    assert.deepStrictEqual(snapshots[0]?.turn_requests, []);

    await say(core, session, "again");
    await waitTurnEnd(core, session, 1);

    const turns = await turnsOf(core, session);
    assert.deepStrictEqual(
      turns.map((turn) => [turn.state, turn.outcome?.kind]),
      [
        ["finished", "interrupted"],
        ["finished", "completed"],
      ],
    );
    const first = turns[0].outcome;
    assert.ok(first?.kind === "interrupted");
    assert.deepStrictEqual(first.reason, "restarted");
    const read = await core.call(workspaceSessionRead, { session });
    assert.deepStrictEqual(read.session.lifecycle, "open");

    assert.deepStrictEqual(await ask.exists(), true);
    assert.deepStrictEqual(fake.journal().length, 2);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});

test("E2E core가 재시작돼도 완료한 turn의 기록과 provider 연결은 그대로이고 같은 session이 이어진다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    const key = `sk-e2e-${core.ids.newId("key").split("_").pop()}`;
    await connectFakeProvider(core, fake, { key });
    const session = await openWorkspaceSession(core, LOPHN_AGENT_ID);
    fake.script([
      { reply: { kind: "text", text: "one" } },
      { reply: { kind: "text", text: "two" } },
    ]);
    await say(core, session, "first words");
    const turn = await waitTurnEnd(core, session);

    // 읽은 시점(as_of_seq)은 재시작이 ledger를 늘리므로 빼고 기록만 비교한다.
    const records = async (live: Core) =>
      JSON.stringify([
        (await live.call(turnList, { session })).turns,
        (await live.call(receivedMessageList, { session })).messages,
        (await live.call(toolCallList, { turn: turn.id })).tool_calls,
        (await live.call(modelCallList, { session })).calls,
      ]);
    const before = await records(core);
    await core.kill();
    core = await bootCore(run);
    await settle(core);

    // ledger: 재시작 전후 기록이 같다.
    assert.deepStrictEqual(await records(core), before);

    await say(core, session, "second words");
    await waitTurnEnd(core, session, 1);

    // fake: provider 연결을 다시 하지 않았는데 key가 실리고 history가 이어진다.
    const request = fake.journal()[1];
    assert.deepStrictEqual(request.headers["x-api-key"], key);
    assert.ok(JSON.stringify(request.body).includes("first words"));
    // disk: key는 0600 secrets.json에 남아 있다.
    const secrets = await stat(`${run.home}/${SECRET_FILE_NAME}`);
    // Windows는 mode가 없어 0600을 보지 않는다(platform.md).
    if (process.platform !== "win32") {
      assert.deepStrictEqual(secrets.mode & 0o777, 0o600);
    }
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});

test("E2E core 재시작 직전에 받아 turn을 열지 못한 사람 message는 재시작 뒤 turn을 연다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    const folder = `${run.work}/proj`;
    await mkdir(folder);
    fake.script([
      { reply: { kind: "stall", partial: { text: "thinking" } } },
      { reply: { kind: "text", text: "back" } },
    ]);
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const { project } = await openProject(core, folder);
    const session = await openWorkspaceSession(core, LOPHN_AGENT_ID, {
      kind: "project",
      id: project,
    });

    await say(core, session, "first request");
    await until("첫 model 요청이 도착함", () =>
      Promise.resolve(fake.journal().length >= 1 ? true : undefined),
    );
    // turn이 도는 중이라 queue에만 쌓인다.
    const queued = (await say(core, session, "queued request")).message;
    await core.kill();
    core = await bootCore(run);
    await settle(core);
    await waitTurnEnd(core, session, 1);

    // ledger: 첫 turn은 재시작으로 닫히고 쌓였던 message가 둘째 turn을 연다.
    const turns = await turnsOf(core, session);
    assert.deepStrictEqual(turns.length, 2);
    assert.deepStrictEqual(turns[0].outcome, {
      kind: "interrupted",
      reason: "restarted",
    });
    assert.deepStrictEqual(turns[1].outcome?.kind, "completed");
    const { messages } = await core.call(receivedMessageList, { session });
    assert.deepStrictEqual(
      messages.find((item) => item.id === queued)?.turn,
      turns[1].id,
    );
    // fake: 둘째 요청에 그 message의 글이 있다.
    assert.deepStrictEqual(fake.journal().length, 2);
    assert.ok(
      JSON.stringify(fake.journal()[1].body).includes("queued request"),
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
