// 세 질문
// - contract: boundary `approvals`(묻는 쓰기는 사람의 결정 전에 실행되지 않고, 허락은 그 intent에 한 번, 거절 이유는 agent에게 간다), `agent-tools`.
// - 현실적 회귀: Gate를 건너뛰고 쓰기가 실행되는 수정(허락 전에 file이 생김), 거절했는데 쓰기가 되는 수정, turn이 기다리다가 결정 뒤 이어 가지 못하는 수정.
// - 왜 지금 test로 못 잡나: approvals_test·gate_test는 판정과 request 표만 본다. child process에서 세워진 turn이 core의 결정으로 이어지는 왕복은 process를 건너야만 보인다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { toolCallList } from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

// 둘째 model 요청의 마지막 user message에서 call id의 tool_result 내용을 글로 돌려준다.
function toolResultOf(fake: FakeServer, id: string): string {
  const body = fake.journal()[1]?.body as {
    messages: { role: string; content: unknown }[];
  };
  const last = body.messages.at(-1)!;
  assertEquals(last.role, "user");
  const block = (last.content as { type: string; tool_use_id?: string }[])
    .find((item) => item.type === "tool_result" && item.tool_use_id === id);
  assert(block, `둘째 요청에 ${id}의 tool_result가 없다`);
  return JSON.stringify((block as { content?: unknown }).content ?? null);
}

// LOPHN.md 쓰기를 한 번 시키고 Gate 앞에서 세워진 것을 확인한 뒤 결정을 내린다.
async function writeAndDecide(
  core: Core,
  fake: FakeServer,
  project: string,
  folder: string,
  sub: string,
  choice: "allow" | "reject",
) {
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{
          id: "t1",
          name: "file_write",
          arguments: JSON.stringify({
            path: `${sub}/LOPHN.md`,
            content: "rules",
          }),
        }],
      },
    },
    { reply: { kind: "text", text: "done" } },
  ]);
  const file = `${folder}/${sub}/LOPHN.md`;
  const session = await openSession(core, { role: "project_manager", project });
  await say(core, session, "write the rules");
  const { request } = await waitPermission(core, session);
  const before = await exists(file);
  await decide(core, session, request, choice);
  await waitTurnEnd(core, session);
  const { tool_calls } = await core.call(toolCallList, { session });
  return { file, before, calls: tool_calls, result: toolResultOf(fake, "t1") };
}

Deno.test("묻는 쓰기는 허락 전에 실행되지 않고, 거절하면 쓰이지 않으며 거절이 agent에게 간다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    // 두 행이 같은 project 폴더(proj)를 쓰되 file은 서로 다른 하위 폴더에 둔다(project를 둘 만들면 runtime 재기동이 한 번 더 든다).
    const folder = `${run.work}/proj`;
    await Deno.mkdir(`${folder}/a`, { recursive: true });
    await Deno.mkdir(`${folder}/b`);
    const { project } = await openProject(core, folder);

    const allowed = await writeAndDecide(
      core,
      fake,
      project,
      folder,
      "a",
      "allow",
    );
    assertEquals(allowed.before, false);
    assertEquals(await Deno.readTextFile(allowed.file), "rules");
    assertEquals(allowed.calls.map((c) => c.outcome?.kind), ["success"]);

    const rejected = await writeAndDecide(
      core,
      fake,
      project,
      folder,
      "b",
      "reject",
    );
    assertEquals(rejected.before, false);
    assertEquals(await exists(rejected.file), false);
    assertEquals(rejected.calls.length, 1);
    assertNotEquals(rejected.calls[0].outcome?.kind, "success");
    assertNotEquals(rejected.result, allowed.result);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
