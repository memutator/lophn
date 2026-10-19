// 세 질문
// - contract: boundary `agent-tools`·`run-loop`(runtime child의 Deno flag와 tool 목록이 맞아야 tool이 돈다),
//   `agent-tool-spi`(role의 operation 상한은 tool 이름이 아니라 route 이름 기준이다).
// - 현실적 회귀: runtime 권한 flag에서 place 폴더·net·run이 빠져 NotCapable로 깨지는 것(이미 두 번 난 일),
//   이름이 route와 다른 command tool(`operator.create` → `CreateOperator`)이 credential 상한에 막혀 forbidden이 되는 것,
//   web_fetch의 주소 판정이 풀려 loopback으로 나가는 것.
// - 왜 지금 test로 못 잡나: 두 번 모두 child를 실제로 띄워 확인하지 않았다. agent-tools_test는 목록·정의 일치만 보고
//   harness는 in-process라 권한 문제가 없다.
import { assert, assertEquals } from "@std/assert";
import {
  agentDefinitionList,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
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
import { startFakeServer } from "../support/fake-server/mod.ts";

// 출력이 2 MiB가 넘어 12 KiB씩 상한이 걸린다. 표 안에 `|`를 쓰지 않으려고 pipe가 없다.
const SHELL = "echo hi > made.txt; seq 1 400000";
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

Deno.test("E2E PM의 shell·skill·image·grep·operator.create는 runtime 권한에 막히지 않고 web_fetch는 loopback으로 나가지 못한다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const proj = `${run.work}/proj`;
    await Deno.mkdir(proj);
    await Deno.writeFile(`${proj}/pic.png`, PIXEL);
    await Deno.writeTextFile(`${proj}/notes.md`, "notes for the project\n");
    const { project } = await openProject(core, proj);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });
    const call = (id: string, name: string, args: unknown) => ({
      id,
      name,
      arguments: JSON.stringify(args),
    });
    fake.script([
      {
        reply: {
          kind: "tool",
          calls: [
            call("shell", "shell_run", { command: SHELL }),
            call("skill", "skill_read", { name: "kinds-yaml" }),
            call("image", "image_read", { path: "pic.png" }),
            call("grep", "file_grep", { pattern: "notes" }),
            call("web", "web_fetch", { url: `${fake.url}/probe` }),
            call("operator", "operator_create", {
              name: "helper",
              place: { project: "proj" },
              body: "Help.",
            }),
          ],
        },
      },
      { reply: { kind: "text", text: "done" } },
    ]);
    await say(core, session, "use the tools");
    const { request } = await waitPermission(core, session);
    await decide(core, session, request, "allow");
    const turn = await waitTurnEnd(core, session);

    // disk
    assertEquals(await Deno.readTextFile(`${proj}/made.txt`), "hi\n");

    // ledger
    const { tool_calls: calls } = await core.call(toolCallList, {
      turn: turn.id,
    });
    const outcome = (key: string) =>
      calls.find((c) => c.response_key === key)?.outcome;
    for (const key of ["shell", "skill", "image", "grep", "operator"]) {
      assertEquals(outcome(key)?.kind, "success", key);
    }
    // web/target.ts의 거절 code
    assertEquals(outcome("web"), { kind: "failure", code: "invalid_input" });
    const { agents } = await core.call(agentDefinitionList, {
      place: { kind: "project", id: project },
    });
    assert(
      agents.some((a) => a.kind === "operator" && a.name === "helper"),
      "helper Operator가 없다",
    );

    // fake가 받은 요청
    const journal = fake.journal();
    assertEquals([...new Set(journal.map((entry) => entry.path))], [
      "/messages",
    ]);
    const body = journal[1].body as {
      messages: { role: string; content: unknown }[];
    };
    const last = body.messages[body.messages.length - 1];
    const results = last.content as { type: string; tool_use_id?: string }[];
    const shell = results.find((b) =>
      b.type === "tool_result" && b.tool_use_id === "shell"
    );
    assert(shell, "둘째 요청에 shell tool_result가 없다");
    assert(
      JSON.stringify(shell).length <= 30 * 1024,
      "shell 출력이 상한을 넘음",
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
