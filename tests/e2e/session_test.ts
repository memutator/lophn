// 세 질문
// - contract: boundary `agent-sessions`(role·place는 열 때 한 곳에서 검사한다, place를 보관해도 session은 안 끝난다, fork는 이력만 복사한다),
//   `router`(보관된 place는 closed로 보인다).
// - 현실적 회귀: project 보관이 PM session을 끝내거나 보관 중에도 message가 접수되는 것, 꺼낸 뒤 session이 이어지지 않는 것,
//   fork가 rewind로 숨긴 구간을 되살리는 것, call 길로 열 때만 place 검사가 빠지는 것.
// - 왜 지금 test로 못 잡나: places_test와 session unit은 한 module 안의 SQL만 본다. 보관(projects) → accepting(places) →
//   입력함·Router(router) → 새 입력의 turn이 이어지는 것은 module과 process를 건너야 이어진다.
//
// archive-call·delete-call 행(contract: `agent-sessions`의 archive·지움은 한 tx, `router`의 받은 call은 session의 끝으로 닫힌다, `approvals`의
// 끝난 session의 대기 request는 cancelled)
// - 현실적 회귀: turn만 닫히고 받은 call이 accepted로 남아 보낸 lophn이 영영 기다리는 것, 대기 request가 남아 늦은 allow가 쓰기를 일으키는 것,
//   지움은 call을 닫지 않는 것.
// - 왜 지금 test로 못 잡나: lifecycle unit은 한 tx 안의 SQL만 본다. 도는 turn(child)과 허락 대기(core 메모리)와 보낸 session의 새 입력
//   (Router → 입력함 → 다음 turn)이 같이 맞아야 보인다.
// - 이 두 행은 fake 대답이 4개다(README 정한 것 11의 상한 3을 넘는 예외). session 둘이 한 flow에서 각자 turn을 돌려야 call이 열리고
//   닫힌다(보낸 lophn 3, 받는 PM 1). 두 session이 같은 시각에 model을 부르므로 role 전용 tool 이름으로 줄을 가른다.
//
// core는 file 전체에서 하나고, 행마다 새 project 폴더(run.work/<행 이름>)와 새 session을 쓴다.
import { assert, assertEquals } from "@std/assert";
import {
  type AgentRef,
  agentSessionList,
  agentSessionRead,
  archiveSession,
  callRead,
  deleteSession,
  forkSession,
  messageBody,
  openAgentSession,
  receivedMessageList,
  sendMessage,
  sessionRewind,
  sessionRewindPreview,
  toolCallList,
  turnList,
  turnRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { approvalsDecideTurn } from "../../packages/protocol/approvals/mod.ts";
import { projectApi } from "../../packages/protocol/projects/mod.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
import { runtimePids } from "../support/core/process.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  settle,
  until,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import type { FakeServer } from "../support/fake-server/mod.ts";
import { toolNames } from "../support/fake-server/probe.ts";

const LOPHN: AgentRef = { role: "lophn" };

async function newProject(
  core: Core,
  name: string,
): Promise<{ project: string; pm: AgentRef }> {
  const folder = `${core.run.work}/${name}`;
  await Deno.mkdir(folder);
  const { project } = await openProject(core, folder, name);
  return { project, pm: { role: "project_manager", project } };
}

// 보관과 꺼내기는 runtime 폴더 권한의 합을 바꿔 child를 다시 띄운다. 새 child가 ready가 될 때까지 기다린다.
async function setArchived(
  core: Core,
  project: string,
  archived: boolean,
): Promise<void> {
  const before = await runtimePids(core.run.home);
  const { project: current } = await core.call(projectApi.get, { project });
  await core.call(
    archived ? projectApi.archive : projectApi.unarchive,
    { project },
    { base_revision: current.revision },
  );
  await settle(core, before);
}

// say는 던지므로 거절된 code를 볼 때는 이것을 쓴다.
function trySay(core: Core, session: string, text: string) {
  return core.tryCall(sendMessage, {
    id: core.ids.newId("msg"),
    session,
    content: { schema_version: 1, parts: [{ kind: "text", text }] },
    delivery: "next_turn",
    attached: [],
    refs: [],
  });
}

function textReply(text: string) {
  return { reply: { kind: "text", text } } as const;
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

function toolNamesOf(fake: FakeServer): string[] {
  const body = fake.journal()[0]?.body as { tools: { name: string }[] };
  return body.tools.map((tool) => tool.name);
}

async function outcomesOf(core: Core, turn: string) {
  const { tool_calls } = await core.call(toolCallList, { turn });
  return Object.fromEntries(
    tool_calls.map((item) => [item.response_key, item.outcome]),
  );
}

async function exists(path: string): Promise<boolean> {
  return await Deno.lstat(path).then(() => true, () => false);
}

function callTool(to: unknown) {
  return {
    id: "t1",
    name: "call",
    arguments: JSON.stringify({ to, reply: "none", body: "hi", refs: [] }),
  };
}

async function messagesOf(core: Core, session: string) {
  const { messages } = await core.call(receivedMessageList, { session });
  return [...messages].sort((a, b) =>
    BigInt(a.created_seq) < BigInt(b.created_seq) ? -1 : 1
  );
}

async function bodiesOf(core: Core, session: string): Promise<string[]> {
  const out: string[] = [];
  for (const message of await messagesOf(core, session)) {
    const { content } = await core.call(messageBody, {
      message: message.id,
    });
    const part = content.parts[0];
    out.push(part?.kind === "text" ? part.text : "");
  }
  return out;
}

// 받는 PM의 session은 보낸 쪽 call이 열 때까지 없다. list를 신호로 읽는다.
async function waitReceiver(core: Core, pm: AgentRef): Promise<string> {
  return await until("받는 PM session이 열림", async () => {
    const { sessions } = await core.call(agentSessionList, { agent: pm });
    return sessions[0]?.id;
  });
}

// 허락을 기다리는 PM session에 lophn이 보낸 call이 열려 있는 상태를 만든다. 늦은 허락을 보낼 수 있게 request도 돌려준다.
async function openCallWaitingPermission(
  core: Core,
  fake: FakeServer,
  name: string,
) {
  fake.reset();
  const { pm } = await newProject(core, name);
  const callBody = JSON.stringify({
    to: { role: "project_manager", place: { project: name } },
    reply: "result",
    body: "update LOPHN.md",
    refs: [],
  });
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{ id: "t1", name: "call", arguments: callBody }],
      },
    },
    textReply("sent"),
    textReply("failed noted"),
  ], {
    name: "lophn",
    match: (request) => toolNames(request).includes("app_create"),
  });
  fake.script([{
    reply: {
      kind: "tool",
      calls: [{
        id: "w1",
        name: "file_write",
        arguments: JSON.stringify({ path: "LOPHN.md", content: "rules" }),
      }],
    },
  }], {
    name: "pm",
    match: (request) =>
      toolNames(request).includes("operator_create") &&
      !toolNames(request).includes("app_create") &&
      !toolNames(request).includes("ticket_create"),
  });
  const src = await openSession(core, LOPHN);
  await say(core, src, "ask the project manager");
  const dst = await waitReceiver(core, pm);
  const { request } = await waitPermission(core, dst);
  const [received] = await messagesOf(core, dst);
  return { src, dst, request, call: received!.call! };
}

async function ownTurnsOf(core: Core, session: string) {
  return (await core.call(turnList, { session })).turns;
}

async function rewindMessagesOnly(
  core: Core,
  session: string,
  checkpoint: string,
): Promise<void> {
  const preview = await core.call(sessionRewindPreview, {
    session,
    checkpoint,
    choice: "messages_only",
  });
  await core.call(sessionRewind, {
    id: core.ids.newId("rwd"),
    session,
    checkpoint,
    choice: "messages_only",
    accept_remaining: true,
    preview_hash: preview.preview_hash,
    summary_call: null,
    files: [],
    apps: [],
  }, { session_state: "open", active_turn: null, applying_rewind: null });
}

Deno.test("session 열기·보관·fork는 role과 place, 이력의 규칙을 지킨다", async (t) => {
  const run: Run = await createRun();
  let fake: FakeServer | undefined;
  let core: Core | undefined;
  try {
    fake = await startFakeServer();
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const c = core;
    const f = fake;

    // place-archive-holds-input
    await t.step(
      "person-message: 보관 중에는 입력만 막히고 session은 열려 있어 꺼내면 이어서 받는다",
      async () => {
        f.reset();
        f.script([textReply("ok")]);
        const { project, pm } = await newProject(c, "person-message");
        const session = await openSession(c, pm);

        await setArchived(c, project, true);
        const refused = await trySay(c, session, "while archived");
        assert(!refused.ok);
        assertEquals(refused.error.code, "conflict");

        await setArchived(c, project, false);
        const { message } = await say(c, session, "after unarchive");
        await waitTurnEnd(c, session);

        // 거절된 message는 흔적이 없다. agent의 대답은 같은 session의 message로 따로 남는다.
        assertEquals(
          (await messagesOf(c, session)).filter((item) =>
            item.from.kind === "human"
          ).map((item) => item.id),
          [message],
        );
        const { session: read } = await c.call(agentSessionRead, { session });
        assertEquals(read.lifecycle, "open");
        assertEquals(f.journal().length, 1);
      },
    );

    await t.step(
      "agent-call: 보관된 place의 session에 보낸 call은 closed고 session은 안 끝난다",
      async () => {
        f.reset();
        const { project, pm } = await newProject(c, "agent-call");
        const target = await openSession(c, pm);
        const caller = await openSession(c, LOPHN);
        f.script([
          {
            reply: {
              kind: "tool",
              calls: [callTool({ session: target })],
            },
          },
          textReply("done"),
        ]);

        await setArchived(c, project, true);
        await say(c, caller, "call the project manager");
        await waitTurnEnd(c, caller);

        assert(toolResultOf(f, "t1").includes("closed"));
        assertEquals(await messagesOf(c, target), []);
        const { session: read } = await c.call(agentSessionRead, {
          session: target,
        });
        assertEquals(read.lifecycle, "open");
      },
    );

    // fork-copies-history
    await t.step(
      "fork-at-point: 고른 지점까지의 message만 복사하고 turn은 가져가지 않는다",
      async () => {
        f.reset();
        f.script([textReply("a1"), textReply("a2"), textReply("a3")]);
        const { pm } = await newProject(c, "fork-at-point");
        const session = await openSession(c, pm);
        for (const [index, text] of ["one", "two", "three"].entries()) {
          await say(c, session, text);
          await waitTurnEnd(c, session, index);
        }
        // 대화는 [one, a1, two, a2, three, a3]다. 둘째 사람 message까지 고른다.
        const origin = await messagesOf(c, session);
        const point = origin[2]!.created_seq;

        const forked = await c.call(forkSession, {
          id: c.ids.newId("ses"),
          source: session,
          through_seq: point,
        });
        assertEquals(forked.copied_messages, 3);
        assertEquals(forked.forked_from, { session, through_seq: point });

        const copied = await messagesOf(c, forked.id);
        assertEquals(
          copied.map((item) => item.body),
          origin.slice(0, 3).map((item) => item.body),
        );
        assertEquals(copied.map((item) => item.turn), [null, null, null]);
        assertEquals(await ownTurnsOf(c, forked.id), []);
        const { session: original } = await c.call(agentSessionRead, {
          session,
        });
        const { session: copy } = await c.call(agentSessionRead, {
          session: forked.id,
        });
        assertEquals(copy.agent, original.agent);
        assertEquals(copy.lifecycle, "open");
      },
    );

    await t.step(
      "fork-skips-rewound: rewind가 숨긴 구간은 복사하지 않는다",
      async () => {
        f.reset();
        f.script([textReply("a1"), textReply("a2"), textReply("a3")]);
        const { pm } = await newProject(c, "fork-skips-rewound");
        const session = await openSession(c, pm);
        await say(c, session, "one");
        await waitTurnEnd(c, session, 0);
        const second = await say(c, session, "two");
        await waitTurnEnd(c, session, 1);
        await rewindMessagesOnly(c, session, second.message);
        const third = await say(c, session, "three");
        await waitTurnEnd(c, session, 2);
        const sent = (await messagesOf(c, session)).find((item) =>
          item.id === third.message
        )!;

        // 숨긴 구간(two와 그 대답 a2)은 빠지고 [one, a1, three]만 간다.
        const forked = await c.call(forkSession, {
          id: c.ids.newId("ses"),
          source: session,
          through_seq: sent.created_seq,
        });
        assertEquals(forked.copied_messages, 3);
        assertEquals(await bodiesOf(c, forked.id), ["one", "a1", "three"]);
        assertEquals(await ownTurnsOf(c, forked.id), []);
      },
    );

    // role-place-mismatch
    await t.step(
      "archived-project: 보관된 project에는 session을 열 수 없고 꺼내면 열린다",
      async () => {
        const { project, pm } = await newProject(c, "archived-project");
        await setArchived(c, project, true);
        const refused = await c.tryCall(openAgentSession, {
          id: c.ids.newId("ses"),
          agent: pm,
          opening_context: null,
        });
        assert(!refused.ok);
        assertEquals(refused.error.code, "conflict");
        const none = await c.call(agentSessionList, {
          agent: pm,
          archived: "include",
        });
        assertEquals(none.sessions, []);

        await setArchived(c, project, false);
        const session = await openSession(c, pm);
        const { session: read } = await c.call(agentSessionRead, { session });
        assertEquals(read.lifecycle, "open");
      },
    );

    await t.step(
      "unknown-operator: 없는 Operator에는 session을 열 수 없다",
      async () => {
        const agent: AgentRef = { role: "operator", agent: c.ids.newId("agt") };
        const refused = await c.tryCall(openAgentSession, {
          id: c.ids.newId("ses"),
          agent,
          opening_context: null,
        });
        assert(!refused.ok);
        assertEquals(refused.error.code, "not_found");
        assertEquals((await c.call(agentSessionList, { agent })).sessions, []);
      },
    );

    await t.step(
      "lophn-reads-not-writes: lophn은 project 폴더를 읽고 쓰기 tool은 목록에 없다",
      async () => {
        f.reset();
        await newProject(c, "lophn-scope");
        const folder = `${c.run.work}/lophn-scope`;
        await Deno.writeTextFile(`${folder}/notes.md`, "alpha");
        const session = await openSession(c, LOPHN);
        f.script([
          {
            reply: {
              kind: "tool",
              calls: [
                {
                  id: "t-read",
                  name: "file_read",
                  arguments: JSON.stringify({ path: `${folder}/notes.md` }),
                },
                {
                  id: "t-write",
                  name: "file_write",
                  arguments: JSON.stringify({
                    path: `${folder}/new.md`,
                    content: "x",
                  }),
                },
              ],
            },
          },
          textReply("done"),
        ]);
        await say(c, session, "read and write");
        const turn = await waitTurnEnd(c, session);

        // fake
        const names = toolNamesOf(f);
        assert(names.includes("file_read"));
        for (const gone of ["file_write", "file_edit", "shell_run"]) {
          assert(!names.includes(gone), `lophn에 ${gone}이 보인다`);
        }
        assert(toolResultOf(f, "t-read").includes("alpha"));
        // 없는 tool의 call은 tool_result로만 not_found를 돌려받고 ledger에는 행이 없다(tool 정의가 없어 진입하지 않는다).
        assert(toolResultOf(f, "t-write").includes("not_found"));
        // ledger
        assertEquals(await outcomesOf(c, turn.id), {
          "t-read": { kind: "success", code: "ok" },
        });
        // disk
        assert(!await exists(`${folder}/new.md`));
      },
    );

    for (const how of ["archive", "delete"] as const) {
      await t.step(
        `${how}-call: session을 ${
          how === "archive" ? "archive하면" : "지우면"
        } 도는 turn, 대기 허락, 받은 call이 한 번에 닫힌다`,
        async () => {
          const name = `${how}-call`;
          const { src, dst, request, call } = await openCallWaitingPermission(
            c,
            f,
            name,
          );
          const [turn] = await ownTurnsOf(c, dst);
          const { session: current } = await c.call(agentSessionRead, {
            session: dst,
          });
          await c.call(how === "archive" ? archiveSession : deleteSession, {
            session: dst,
          }, { state_seq: current.state_seq });
          // 보낸 쪽이 늦은 실패를 새 입력으로 받아 둘째 turn을 돈다.
          await waitTurnEnd(c, src, 1);

          // ledger
          if (how === "archive") {
            const closed = await c.call(turnRead, { turn: turn!.id });
            assertEquals(closed.turn.state, "finished");
            assertEquals(closed.turn.outcome, {
              kind: "interrupted",
              reason: "session_ended",
            });
            const { session } = await c.call(agentSessionRead, {
              session: dst,
            });
            assertEquals(session.lifecycle, "archived");
          } else {
            const gone = await c.tryCall(agentSessionRead, { session: dst });
            assert(!gone.ok && gone.error.code === "not_found");
          }
          // route
          const { call: closedCall } = await c.call(callRead, { call });
          assertEquals(closedCall.state, "failed");
          assertEquals(closedCall.fail_reason, "receiver_ended");
          const late = await c.tryCall(approvalsDecideTurn, {
            session: dst,
            request,
            choice: { kind: "allow" },
          });
          assert(!late.ok, "끝난 session의 늦은 allow가 받아들여졌다");
          // disk
          assert(!await exists(`${c.run.work}/${name}/LOPHN.md`));
        },
      );
    }
  } finally {
    await core?.kill().catch(() => {});
    await fake?.close();
    await run.remove();
  }
});
