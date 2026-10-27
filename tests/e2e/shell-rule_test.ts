// 세 질문
// - contract: boundary `approvals`(`always`는 `always_patterns`를 turn place의 층에 allow로 더해 Settings `approvals.shell_rules`에 남기고, 다음 판정과 재시작 뒤 판정이 그 규칙을 읽는다. floor deny는 어느 층도, `always`도, skip도 덮지 못한다), `config`(Settings file이 재시작에 남는다).
// - 현실적 회귀: `always`가 request만 닫고 규칙을 안 쓰거나 다른 층에 써서 같은 명령을 또 묻는 수정, 규칙이 메모리에만 있어 재시작 뒤 다시 묻는 수정, skip turn에서 floor deny가 run이 되어 `rm -rf ~`가 도는 수정.
// - 왜 지금 test로 못 잡나: `judge_test`는 순수 함수이고 `approvals_test`는 자격만 본다. 사람의 결정 → `settingsUpdate` → `settings.json` → 다음 turn의 child `tool_gate/check`와 core 재기동이 이어져야 보인다.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  agentSessionRead,
  changeSessionSkip,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { SHELL_RULES_SETTING_KEY } from "../../packages/protocol/approvals/mod.ts";
import { settingsList } from "../../packages/protocol/config/file.ts";
import { sessionSnapshotsList } from "../../packages/protocol/events/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  settle,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import { shellAsk } from "../support/core/shell-ask.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

const DONE = { reply: { kind: "text", text: "done" } } as const;

// 같은 명령을 한 번 더 시키고 그 turn(index)의 call outcome을 돌려준다. 물었다면 turn이 안 끝나 waitTurnEnd가 실패한다.
async function runAgain(
  core: Core,
  fake: FakeServer,
  session: string,
  folder: string,
  id: string,
  index: number,
) {
  const ask = await shellAsk(folder);
  fake.reset();
  fake.script([{ reply: ask.reply(id) }, DONE]);
  await say(core, session, "remove it again");
  const turn = await waitTurnEnd(core, session, index);
  const { tool_calls } = await core.call(toolCallList, { turn: turn.id });
  return {
    exists: await ask.exists(),
    outcomes: tool_calls.map((c) => c.outcome),
  };
}

test("shell 물음에 always로 답하면 규칙이 project 층에 남아 재시작 뒤에도 다시 묻지 않고, skip에서도 floor deny는 실행되지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await mkdir(folder);
    const { project } = await openProject(core, folder);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });

    // always: 물음이 규칙 pattern을 싣고, 답하면 명령이 돌고 규칙이 project 층에 남는다.
    const ask = await shellAsk(folder);
    fake.script([{ reply: ask.reply("s1") }, DONE]);
    await say(core, session, "remove it");
    const { request } = await waitPermission(core, session);
    const { snapshots } = await core.call(sessionSnapshotsList, {
      sessions: [session],
    });
    assert.deepStrictEqual(snapshots[0].turn_requests[0].always_patterns, [
      "rm -r *",
    ]);
    await decide(core, session, request, "always");
    await waitTurnEnd(core, session, 0);
    assert.deepStrictEqual(await ask.exists(), false);
    const { settings } = await core.call(settingsList, {
      keys: [SHELL_RULES_SETTING_KEY],
    });
    const chosen = settings[0].chosen as { projects: Record<string, unknown> };
    assert.deepStrictEqual(chosen.projects[project], [
      { pattern: "rm -r *", action: "allow" },
    ]);

    // 다시 묻지 않음: core가 판정마다 Settings를 다시 읽는다.
    const second = await runAgain(core, fake, session, folder, "s2", 1);
    assert.deepStrictEqual(second.exists, false);
    assert.deepStrictEqual(second.outcomes.map((o) => o?.kind), ["success"]);

    // 재시작 뒤: 규칙이 settings.json에서 읽힌다.
    await core.kill();
    core = await bootCore(run);
    await settle(core);
    const third = await runAgain(core, fake, session, folder, "s3", 2);
    assert.deepStrictEqual(third.exists, false);
    assert.deepStrictEqual(third.outcomes.map((o) => o?.kind), ["success"]);

    // skip이어도 floor deny. `~`는 core의 HOME(<run>/user-home)이라 판정이 틀려도 run 폴더 안이다.
    const { session: read } = await core.call(agentSessionRead, { session });
    await core.call(
      changeSessionSkip,
      { session, skip: true },
      { state_seq: read.state_seq },
    );
    const keep = `${run.dir}/user-home/keep`;
    await writeFile(keep, "keep");
    fake.reset();
    fake.script([{
      reply: {
        kind: "tool",
        calls: [{
          id: "s4",
          name: "shell_run",
          arguments: JSON.stringify({ command: "rm -rf ~" }),
        }],
      },
    }, DONE]);
    await say(core, session, "remove home");
    const turn = await waitTurnEnd(core, session, 3);
    assert.deepStrictEqual(turn.mode, "skip");
    const { tool_calls } = await core.call(toolCallList, { turn: turn.id });
    assert.deepStrictEqual(tool_calls.map((c) => c.outcome), [
      { kind: "not_executed", code: "denied" },
    ]);
    assert.deepStrictEqual(await readFile(keep, "utf8"), "keep");
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
