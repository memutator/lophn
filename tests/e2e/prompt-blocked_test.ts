// 세 질문
// - contract: boundary `run-loop`(사람이 쓴 지침을 못 읽으면 turn을 시작하지 않고 이유를 남긴다), `agent-sessions`(시작하지 못한 turn도 닫힌 행으로 남는다).
// - 현실적 회귀: 읽기 실패를 "지침 없음"으로 보고 지침 없이 일을 시작하는 수정(사람의 규칙이 조용히 빠진다), 시작하지 못한 turn이 running으로 남아 다음 `turns/start`가 `conflict`가 되는 것.
// - 왜 지금 test로 못 잡나: `read_test`는 읽기 권한만 보고 `readTurnInstructions`와 `closeUnstarted`를 잇는 test가 없다. reader Worker(core)의 `unavailable`이 runtime child를 거쳐 ledger의 turn 행이 되는 길은 process를 건너야 보인다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";

import {
  turnBodyView,
  turnRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  connectFakeProvider,
  openLophnSession,
  openProject,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

test("읽지 못한 지침은 조용히 빠지지 않는다: turn이 시작되지 않고 이유가 남으며 model 요청이 나가지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const proj = `${run.work}/proj`;
    await mkdir(proj);
    // 폴더는 openFile이 항상 읽지 못하는 것(unavailable)으로 본다. 권한 000은 root에서 읽혀 버린다.
    await mkdir(`${proj}/LOPHN.md`);
    const { project } = await openProject(core, proj);
    const session = await openLophnSession(core, {
      kind: "project",
      id: project,
    });

    await say(core, session, "hello");
    const ended = await waitTurnEnd(core, session);

    // ledger: turn이 시작되지 못한 이유로 닫힌다.
    const { turn } = await core.call(turnRead, { turn: ended.id });
    assert.deepStrictEqual(turn.state, "finished");
    assert.deepStrictEqual(turn.outcome, {
      kind: "failed",
      reason: "configuration_unavailable",
    });
    // route: 사람이 읽는 turn 기준에 이유가 남는다. configuration_unavailable은 model이 없을 때도 쓰므로 why로 가린다.
    const basis = await core.call(turnBodyView, {
      kind: "turn_basis",
      id: ended.id,
    });
    assert.deepStrictEqual(
      (basis.value as { why?: string }).why,
      "instructions_blocked",
    );
    // fake: model 요청이 하나도 나가지 않았다.
    assert.deepStrictEqual(fake.journal().length, 0);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
