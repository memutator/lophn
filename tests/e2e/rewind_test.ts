// 세 질문
// - contract: boundary `agent-sessions`(session rewind가 file을 되돌린다)와 `agent-tools`(쓰기 전 pre-image 기록).
//   사용자 data를 잃거나 망가뜨리는 규칙이다.
// - 현실적 회귀: pre-image가 안 남아 복원이 비는 것, 되돌릴 때 사람이 그 사이 고친 file을 덮어쓰는 것,
//   두 번 고친 file이 첫 상태가 아니라 중간 상태로 돌아가는 것.
// - 왜 지금 test로 못 잡나: 앱 data rewind test와 달리 session rewind는 file tool(child process의 쓰기 기록)과
//   core의 복원 처리기가 이어져야 보인다.
import { assertEquals } from "@std/assert";
import {
  rewindList,
  sessionRewind,
  sessionRewindPreview,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
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
import { startFakeServer } from "../support/fake-server/mod.ts";
import type { FakeServer } from "../support/fake-server/mod.ts";

// 파일을 차례로 쓰는 turn 하나를 돌리고 끝나기를 기다린다. 되돌릴 checkpoint(사람 메시지)를 돌려준다.
async function writeFiles(
  core: Core,
  fake: FakeServer,
  project: string,
  writes: [name: string, content: string][],
): Promise<{ session: string; checkpoint: string }> {
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: writes.map(([name, content], index) => ({
          id: `t${index}`,
          name: "file_write",
          arguments: JSON.stringify({ path: name, content }),
        })),
      },
    },
    { reply: { kind: "text", text: "done" } },
  ]);
  const session = await openSession(core, { role: "project_manager", project });
  const { message } = await say(core, session, "change files");
  await waitTurnEnd(core, session);
  return { session, checkpoint: message };
}

const writeTwice = (
  core: Core,
  fake: FakeServer,
  project: string,
  name: string,
) => writeFiles(core, fake, project, [[name, "v1"], [name, "v2"]]);

async function rewindToBefore(
  core: Core,
  session: string,
  checkpoint: string,
  accept = true,
) {
  const preview = await core.call(sessionRewindPreview, {
    session,
    checkpoint,
    choice: "restore_all",
  });
  // files를 비워 보내면 core의 처리기가 관측하고 준비한다.
  const header = await core.call(sessionRewind, {
    id: core.ids.newId("rwd"),
    session,
    checkpoint,
    choice: "restore_all",
    accept_remaining: accept,
    preview_hash: preview.preview_hash,
    summary_call: null,
    files: [],
    apps: [],
  }, { session_state: "open", active_turn: null, applying_rewind: null });
  const { reverts } = await core.call(rewindList, { session });
  const revert = reverts.find((item) => item.id === header.id);
  return { preview, header, revert };
}

Deno.test("session rewind는 agent가 고친 file을 첫 상태로 되돌리고, 사람이 그 사이 고친 file은 덮어쓰지 않는다", async () => {
  const run: Run = await createRun();
  let fake: FakeServer | undefined;
  let core: Core | undefined;
  try {
    fake = await startFakeServer();
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await Deno.mkdir(folder);
    await Deno.writeTextFile(`${folder}/a.md`, "v0");
    await Deno.writeTextFile(`${folder}/b.md`, "v0");
    const { project } = await openProject(core, folder);

    // 행 1: 두 번 고친 a.md가 중간 상태(v1)가 아니라 첫 상태로 돌아간다.
    const first = await writeTwice(core, fake, project, "a.md");
    assertEquals(await Deno.readTextFile(`${folder}/a.md`), "v2");
    const restored = await rewindToBefore(
      core,
      first.session,
      first.checkpoint,
    );
    assertEquals(await Deno.readTextFile(`${folder}/a.md`), "v0");
    assertEquals(restored.revert?.outcome, "applied");
    assertEquals(
      restored.revert?.items.map((item) => [item.target, item.result]),
      [["a.md", "restored"]],
    );
    assertEquals(restored.preview.restore.map((item) => item.target), ["a.md"]);
    assertEquals([restored.preview.skip, restored.preview.remain], [[], []]);

    // 행 2: 사람이 그 사이 고친 b.md는 건너뛴다.
    const second = await writeTwice(core, fake, project, "b.md");
    assertEquals(await Deno.readTextFile(`${folder}/b.md`), "v2");
    await Deno.writeTextFile(`${folder}/b.md`, "human edit");
    const kept = await rewindToBefore(core, second.session, second.checkpoint);
    assertEquals(await Deno.readTextFile(`${folder}/b.md`), "human edit");
    assertEquals(
      kept.revert?.items.map((item) => [item.target, item.result, item.reason]),
      [["b.md", "skipped", "edited_outside"]],
    );
    assertEquals(
      kept.preview.skip.map((item) => [item.target, item.reason]),
      [["b.md", "edited_outside"]],
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake?.close();
    await run.remove();
  }
});

// 세 질문
// - contract: boundary `agent-sessions`(rewind는 사람이 그 사이 고친 file을 덮지 않고, 확인 없는 영향이 있으면 거절하고,
//   도는 turn이 있으면 시작하지 않는다), `agent-tools`(쓰기 전 pre-image를 기록한다).
// - 현실적 회귀: pre-image가 core 메모리에만 있어 재시작 뒤 복원이 비는 것, 새로 만든 file의 되돌림이 사람 편집을
//   지우는 것, accept_remaining이 false인데 일부만 복원되는 것, 도는 turn 위에서 rewind가 시작되는 것.
// - 왜 지금 test로 못 잡나: 위 test는 재시작 없이 기존 file의 중간 상태와 edited_outside만 본다.
Deno.test("session rewind는 재시작 뒤에도 되돌리고, 새 file의 사람 편집과 거절 조건의 file을 건드리지 않고, 도는 turn 위에서는 시작하지 않는다", async () => {
  const run: Run = await createRun();
  let fake: FakeServer | undefined;
  let core: Core | undefined;
  try {
    fake = await startFakeServer();
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await Deno.mkdir(folder);
    for (const name of ["a.md", "c.md", "d.md"]) {
      await Deno.writeTextFile(`${folder}/${name}`, "v0");
    }
    const { project } = await openProject(core, folder);
    const read = (name: string) => Deno.readTextFile(`${folder}/${name}`);
    const exists = (name: string) =>
      Deno.stat(`${folder}/${name}`).then(() => true, () => false);

    // after-restart: pre-image 기록이 재시작을 넘는다.
    const old = await writeTwice(core, fake, project, "a.md");
    await core.kill();
    core = await bootCore(run);
    await settle(core);
    const restarted = await rewindToBefore(core, old.session, old.checkpoint);
    assertEquals(await read("a.md"), "v0");
    assertEquals(restarted.revert?.outcome, "applied");
    assertEquals(
      restarted.revert?.items.map((item) => [item.target, item.result]),
      [["a.md", "restored"]],
    );
    assertEquals(restarted.preview.restore.map((item) => item.target), [
      "a.md",
    ]);
    assertEquals([restarted.preview.skip, restarted.preview.remain], [[], []]);

    // created-file: agent가 만든 file은 지우되, 그 사이 사람이 고친 것은 남긴다.
    const made = await writeFiles(core, fake, project, [
      ["new.md", "agent 1"],
      ["new2.md", "agent 2"],
    ]);
    await Deno.writeTextFile(`${folder}/new2.md`, "human edit");
    const created = await rewindToBefore(core, made.session, made.checkpoint);
    assertEquals([await exists("new.md"), await read("new2.md")], [
      false,
      "human edit",
    ]);
    assertEquals(
      created.revert?.items.map((item) => [
        item.target,
        item.result,
        item.reason,
      ]).sort(),
      [["new.md", "restored", null], ["new2.md", "skipped", "created_edited"]],
    );
    assertEquals(
      created.preview.skip.map((item) => [item.target, item.reason]),
      [["new2.md", "created_edited"]],
    );

    // accept-remaining-false: 건너뛸 file이 있는데 확인하지 않으면 아무것도 되돌리지 않는다.
    const refused = await writeFiles(core, fake, project, [
      ["c.md", "v1"],
      ["c.md", "v2"],
      ["d.md", "v1"],
      ["d.md", "v2"],
    ]);
    await Deno.writeTextFile(`${folder}/d.md`, "human edit");
    const blocked = await rewindToBefore(
      core,
      refused.session,
      refused.checkpoint,
      false,
    );
    assertEquals(
      [blocked.revert?.outcome, blocked.revert?.items],
      ["blocked", []],
    );
    assertEquals([await read("c.md"), await read("d.md")], [
      "v2",
      "human edit",
    ]);
    assertEquals(
      blocked.preview.skip.map((item) => [item.target, item.reason]),
      [["d.md", "edited_outside"]],
    );

    // rewind-needs-idle: 허락을 기다리며 도는 turn 위에서는 rewind를 시작하지 않는다.
    fake.reset();
    const ask = await shellAsk(folder);
    fake.script([
      { reply: ask.reply("t1") },
      { reply: { kind: "text", text: "done" } },
    ]);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });
    const { message } = await say(core, session, "write rules");
    const { request } = await waitPermission(core, session);
    const busy = await core.tryCall(sessionRewind, {
      id: core.ids.newId("rwd"),
      session,
      checkpoint: message,
      choice: "messages_only",
      accept_remaining: true,
      preview_hash: "0".repeat(64),
      summary_call: null,
      files: [],
      apps: [],
    }, { session_state: "open", active_turn: null, applying_rewind: null });
    assertEquals(busy.ok ? "ok" : busy.error.code, "conflict");
    await decide(core, session, request, "once");
    const turn = await waitTurnEnd(core, session);
    assertEquals(turn.outcome?.kind, "completed");
    assertEquals((await core.call(rewindList, { session })).reverts, []);
    assertEquals(fake.journal().length, 2);
  } finally {
    await core?.kill().catch(() => {});
    await fake?.close();
    await run.remove();
  }
});
