// 세 질문
// - contract: boundary `agent-tools`(file tool의 scope는 place 폴더 안), `run-loop`(agent runtime child의 Deno 쓰기 권한).
//   architecture `place-session.md`의 "place 폴더가 범위".
// - 현실적 회귀: runtime child의 --allow-write에서 place 폴더가 빠져 NotCapable로 쓰기가 실패하는 것(이미 한 번 난 일),
//   scope 검사에서 절대 경로나 `..`가 새는 것.
// - 왜 지금 test로 못 잡나: scope_test는 scope 함수만 보고, child process의 Deno 권한은 process를 건너야만 보인다.
//   harness는 in-process라 권한 문제가 없다.
import { assert, assertEquals } from "@std/assert";
import { toolCallList } from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

Deno.test("E2E PM은 project 폴더에는 쓰고 그 밖에는 쓰지 못한다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const proj = `${run.work}/proj`;
    const outside = `${run.work}/outside`;
    await Deno.mkdir(proj);
    await Deno.mkdir(outside);
    const { project } = await openProject(core, proj);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });
    fake.script([
      {
        reply: {
          kind: "tool",
          calls: [
            {
              id: "t1",
              name: "file_write",
              arguments: JSON.stringify({ path: "note.md", content: "hello" }),
            },
            {
              id: "t2",
              name: "file_write",
              arguments: JSON.stringify({
                path: `${outside}/leak.md`,
                content: "leak",
              }),
            },
          ],
        },
      },
      { reply: { kind: "text", text: "done" } },
    ]);
    await say(core, session, "write the note");
    const turn = await waitTurnEnd(core, session);

    // disk
    assertEquals(await Deno.readTextFile(`${proj}/note.md`), "hello");
    assertEquals([...Deno.readDirSync(outside)], []);

    // ledger
    const { tool_calls: calls } = await core.call(toolCallList, {
      turn: turn.id,
    });
    // response_order가 모델이 낸 call 순서(t1, t2)다.
    const [first, second] = [...calls].sort((a, b) =>
      a.response_order - b.response_order
    );
    assertEquals([first.response_key, second.response_key], ["t1", "t2"]);
    assertEquals(first.outcome?.kind, "success");
    assertEquals(second.outcome, { kind: "failure", code: "forbidden" });

    // fake가 받은 요청
    const journal = fake.journal();
    assertEquals(journal.length, 2);
    const body = journal[1].body as {
      messages: { role: string; content: unknown }[];
    };
    const last = body.messages[body.messages.length - 1];
    assertEquals(last.role, "user");
    assert(Array.isArray(last.content));
    assertEquals(
      last.content.filter((block) => block.type === "tool_result").map((
        block,
      ) => block.tool_use_id),
      ["t1", "t2"],
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
