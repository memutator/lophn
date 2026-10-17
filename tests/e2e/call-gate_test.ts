// 세 질문
// - contract: boundary `approvals`(agent call은 turn 안에서 사람에게 묻고 거절하면 가지 않는다), `router`(tx 안에서 grant를 한 번 더 판정), `agent-tools`.
// - 현실적 회귀: call tool이 Gate를 건너뛰어 사람 허락 없이 다른 agent를 여는 수정, 거절했는데 상대 session이 열리는 수정, 허락했는데 Router가 "묻는 grant"라고 거절해 call이 가지 못하는 수정.
// - 왜 지금 test로 못 잡나: gate_test는 판정 table만, router-registration_test는 callGate 함수만 본다. call tool(child) → Gate(core 메모리) → 사람 결정 → Router → 새 session의 왕복은 process를 건너야만 보인다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { agentGrantsSet } from "../../packages/protocol/approvals/mod.ts";
import {
  agentSessionList,
  receivedMessageList,
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
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

const CALL_ID = "call1";

async function pmSessions(core: Core, project: string) {
  const { sessions } = await core.call(agentSessionList, {
    agent: { role: "project_manager", project },
  });
  return sessions;
}

// lophn이 PM을 부르는 call을 시키고 Gate 앞에서 세워진 것을 확인한 뒤 결정을 내려, 그 session과 ledger의 call을 돌려준다.
async function callAndDecide(
  core: Core,
  fake: FakeServer,
  place: string,
  choice: "allow" | "reject",
  replies: number,
) {
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{
          id: CALL_ID,
          name: "call",
          arguments: JSON.stringify({
            to: { role: "project_manager", place: { project: place } },
            reply: "none",
            body: "hi",
            refs: [],
          }),
        }],
      },
    },
    // 허락하면 PM의 새 turn도 같은 text를 받는다. 둘은 순서와 무관하다.
    ...Array.from({ length: replies - 1 }, () => ({
      reply: { kind: "text" as const, text: "done" },
    })),
  ]);
  const lophn = await openSession(core, { role: "lophn" });
  await say(core, lophn, "ask the project manager");
  const { request } = await waitPermission(core, lophn);
  await decide(core, lophn, request, choice);
  await waitTurnEnd(core, lophn);
  const { tool_calls } = await core.call(toolCallList, { session: lophn });
  const sent = tool_calls.filter((c) => c.tool === "call");
  assertEquals(sent.length, 1);
  return { lophn, outcome: sent[0].outcome?.kind };
}

Deno.test("묻는 grant의 상대는 사람이 허락해야만 열리고, 거절하면 열리지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await Deno.mkdir(folder);
    const { project } = await openProject(core, folder);
    await core.call(agentGrantsSet, {
      agent: { role: "lophn" },
      entries: [{
        kind: "agent",
        agent: { role: "project_manager", project },
        setting: "ask",
      }],
    });

    // reject: 상대 session이 열리지 않고, 거절이 call tool 결과로 lophn에게 간다.
    const rejected = await callAndDecide(core, fake, "proj", "reject", 2);
    assertEquals(await pmSessions(core, project), []);
    assertNotEquals(rejected.outcome, "success");
    assertEquals(fake.journal().length, 2);
    const second = fake.journal()[1].body as {
      messages: { content: unknown }[];
    };
    assert(
      JSON.stringify(second.messages.at(-1)).includes(CALL_ID),
      "둘째 요청에 call id의 tool_result가 없다",
    );

    // allow: Router가 gate_allowed를 받아 call을 보내고 PM session이 열린다.
    const allowed = await callAndDecide(core, fake, "proj", "allow", 3);
    assertEquals(allowed.outcome, "success");
    let opened = await pmSessions(core, project);
    for (let i = 0; opened.length === 0 && i < 600; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      opened = await pmSessions(core, project);
    }
    assertEquals(opened.length, 1);
    const pm = opened[0].id;
    await waitTurnEnd(core, pm);
    const { messages } = await core.call(receivedMessageList, { session: pm });
    // PM 자신의 답도 이 목록에 들어오므로 call이 실어 온 것만 본다.
    const calls = messages.filter((message) => message.call !== null);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].from, { kind: "agent", session: allowed.lophn });
    assertEquals(fake.journal().length, 3);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
