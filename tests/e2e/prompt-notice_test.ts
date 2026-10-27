// 세 질문
// - contract: boundary `run-loop`(prompt 조립: 지침 층은 `LOPHN.md`뿐이고, 바뀐 판은 다음 turn 시작에 notice로 알린다), `agent-roles`(project 층 지침의 자리).
// - 현실적 회귀: 사람이 고친 지침이 도는 session에 영영 안 닿는 것, notice 없이 system만 바뀌어 model이 무엇이 바뀌었는지 모르는 것, `AGENTS.md`를 fallback으로 읽는 수정이 들어가 사람이 모르는 글이 prompt에 섞이는 것.
// - 왜 지금 test로 못 잡나: `assembleTurnPrompt`에 unit이 없고, harness loop의 `context` port는 notice를 비워 둔다. file 읽기(core)와 판 기억(runtime child 메모리)과 model 요청이 이어지는 길은 process를 건너야 보인다.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";

import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  turnsOf,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { lastUserText, systemText } from "../support/fake-server/probe.ts";

test("고친 지침은 다음 turn의 system과 notice로 닿고 AGENTS.md는 어느 요청에도 없다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    fake.script([
      { reply: { kind: "text", text: "first" } },
      { reply: { kind: "text", text: "second" } },
    ]);
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const one = `RULE-ONE-${core.ids.newId("msg")}`;
    const two = `RULE-TWO-${core.ids.newId("msg")}`;
    const decoy = `DECOY-${core.ids.newId("msg")}`;
    const proj = `${run.work}/proj`;
    await mkdir(proj);
    await writeFile(`${proj}/LOPHN.md`, one);
    await writeFile(`${proj}/AGENTS.md`, decoy);
    const { project } = await openProject(core, proj);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });

    await say(core, session, "one");
    await waitTurnEnd(core, session, 0);
    // 사람이 turn 사이에 disk에서 지침을 고친다.
    await writeFile(`${proj}/LOPHN.md`, two);
    await say(core, session, "two");
    await waitTurnEnd(core, session, 1);

    const [first, second] = fake.journal();
    assert.deepStrictEqual(fake.journal().length, 2);
    // fake(1): 지침 block은 그 turn이 읽은 지금 지침이다. 첫 요청은 옛 글, 둘째 요청은 새 글이다.
    assert.ok(systemText(first).includes(one));
    assert.ok(systemText(second).includes(two));
    assert.ok(!systemText(second).includes(one));
    // fake(2): 둘째 요청 끝에 바뀐 지침의 notice가 붙는다. 문구는 보지 않는다.
    const tail = lastUserText(second);
    assert.ok(tail.includes("lophn-notice"));
    assert.ok(tail.includes("instructions_changed"));
    assert.ok(tail.includes(two));
    // AGENTS.md는 어느 요청에도 들어가지 않는다.
    assert.ok(!JSON.stringify(first.body).includes(decoy));
    assert.ok(!JSON.stringify(second.body).includes(decoy));
    // ledger: 두 turn 모두 정상으로 끝났다.
    const turns = await turnsOf(core, session);
    assert.deepStrictEqual(turns.map((t) => t.outcome?.kind), [
      "completed",
      "completed",
    ]);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
