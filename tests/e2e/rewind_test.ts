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
  openProject,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import type { FakeServer } from "../support/fake-server/mod.ts";

// 같은 파일을 두 번 쓰는 turn 하나를 돌리고 끝나기를 기다린다. 되돌릴 checkpoint(사람 메시지)를 돌려준다.
async function writeTwice(
  core: Core,
  fake: FakeServer,
  project: string,
  name: string,
): Promise<{ session: string; checkpoint: string }> {
  const write = (id: string, content: string) => ({
    id,
    name: "file_write",
    arguments: JSON.stringify({ path: name, content }),
  });
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [write("t1", "v1"), write("t2", "v2")],
      },
    },
    { reply: { kind: "text", text: "done" } },
  ]);
  const session = await openSession(core, { role: "project_manager", project });
  const { message } = await say(core, session, `change ${name}`);
  await waitTurnEnd(core, session);
  return { session, checkpoint: message };
}

async function rewindToBefore(
  core: Core,
  session: string,
  checkpoint: string,
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
    accept_remaining: true,
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
