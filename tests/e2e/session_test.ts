// 세 질문
// - contract: boundary `agent-sessions`(agent·place는 열 때 한 곳에서 검사한다, place를 보관해도 session은 안 끝난다, fork는 이력만 복사한다),
//   `router`(보관된 place는 closed로 보인다).
// - 현실적 회귀: project 보관이 project place session을 끝내거나 보관 중에도 message가 접수되는 것, 꺼낸 뒤 session이 이어지지 않는 것,
//   fork가 rewind로 숨긴 구간을 되살리는 것, call 길로 열 때만 place 검사가 빠지는 것.
// - 왜 지금 test로 못 잡나: places_test와 session unit은 한 module 안의 SQL만 본다. 보관(projects) → accepting(places) →
//   입력함·Router(router) → 새 입력의 turn이 이어지는 것은 module과 process를 건너야 이어진다.
//
// archive-call·delete-call 행(contract: `agent-sessions`의 archive·지움은 한 tx, `router`의 받은 call은 session의 끝으로 닫힌다, `approvals`의
// 끝난 session의 대기 request는 cancelled)
// - 현실적 회귀: turn만 닫히고 받은 call이 accepted로 남아 보낸 lophn이 영영 기다리는 것, 대기 request가 남아 늦은 once가 명령을 돌리는 것,
//   지움은 call을 닫지 않는 것.
// - 왜 지금 test로 못 잡나: lifecycle unit은 한 tx 안의 SQL만 본다. 도는 turn(child)과 허락 대기(core 메모리)와 보낸 session의 새 입력
//   (Router → 입력함 → 다음 turn)이 같이 맞아야 보인다.
// - 이 두 행은 fake 대답이 4개다(README 정한 것 11의 상한 3을 넘는 예외). session 둘이 한 flow에서 각자 turn을 돌려야 call이 열리고
//   닫힌다(보낸 home lophn 3, 받는 project place lophn 1). 두 session이 같은 시각에 model을 부르므로 place 종류 전용 tool
//   이름으로 줄을 가른다.
//
// project-tools-run 행
// - contract: boundary `agent-tools`·`run-loop`(runtime child에서 tool이 돌고 place 종류의 operation 상한이 그 목록의 tool을
//   막지 않는다), `agent-tool-spi`(상한은 tool 이름이 아니라 route 이름 기준이다), `agents`(agent를 만드는 tool은 할당을 주지 못한다).
// - 현실적 회귀: tool이 route 상한에 막혀 turn이 실패하는 것(두 번 난 일), 이름이 route와 다른 command tool
//   (`agent.create` → `CreateAgent`)이 막히는 것, web_fetch가 loopback으로 나가는 것, 만드는 tool 입력에
//   할당·`mcp_servers`·`skip` 칸이 생기는 것.
// - 왜 지금 test로 못 잡나: agent-tools_test는 목록·정의 일치만 보고 harness는 in-process라 tool이 child에서 도는 길을
//   지나지 않는다.
//
// core는 file 전체에서 하나고, 행마다 새 project 폴더(run.work/<행 이름>)와 새 session을 쓴다.
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { assignmentGet } from "../../packages/protocol/approvals/mod.ts";
import { turnRequestDecide } from "../../packages/protocol/approvals/turn-request.ts";
import {
  type AgentId,
  agentCallRead,
  agentList,
  archiveSession,
  deleteSession,
  forkSession,
  LOPHN_AGENT_ID,
  messageBody,
  type Place,
  placeSessionList,
  placeSessionOpen,
  placeSessionRead,
  receivedMessageList,
  sendMessage,
  sessionRewind,
  sessionRewindPreview,
  toolCallList,
  turnList,
  turnRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { projectApi } from "../../packages/protocol/projects/mod.ts";
import {
  connectFakeProvider,
  openPlaceSession,
  openProject,
  say,
  until,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
import { shellAsk } from "../support/core/shell-ask.ts";
import type { FakeServer } from "../support/fake-server/mod.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { toolNames } from "../support/fake-server/probe.ts";

async function newProject(
  core: Core,
  name: string,
): Promise<{ project: string; place: Place }> {
  const folder = `${core.run.work}/${name}`;
  await mkdir(folder);
  const { project } = await openProject(core, folder, name);
  return { project, place: { kind: "project", id: project } };
}

// project place의 lophn session을 연다.
const openAt = (core: Core, place: Place) =>
  openPlaceSession(core, LOPHN_AGENT_ID, place);

// 출력이 2 MiB가 넘어 12 KiB씩 상한이 걸린다. 표 안에 `|`를 쓰지 않으려고 pipe가 없다.
const SHELL = "echo hi > made.txt; seq 1 400000";
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

async function setArchived(
  core: Core,
  project: string,
  archived: boolean,
): Promise<void> {
  const { project: current } = await core.call(projectApi.get, { project });
  await core.call(
    archived ? projectApi.archive : projectApi.unarchive,
    { project },
    { base_revision: current.revision },
  );
}

// say는 던지므로 거절된 code를 볼 때는 이것을 쓴다.
function trySay(core: Core, session: string, text: string) {
  return core.tryCall(sendMessage, {
    id: core.ids.newId("msg"),
    session,
    content: { schema_version: 1, parts: [{ kind: "text", text }] },
    delivery: "next_turn",
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
  assert.deepStrictEqual(last.role, "user");
  const block = (last.content as { type: string; tool_use_id?: string }[]).find(
    (item) => item.type === "tool_result" && item.tool_use_id === id,
  );
  assert.ok(block, `둘째 요청에 ${id}의 tool_result가 없다`);
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
  return await lstat(path).then(
    () => true,
    () => false,
  );
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
    BigInt(a.created_seq) < BigInt(b.created_seq) ? -1 : 1,
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

// 받는 project place session은 보낸 쪽 call이 열 때까지 없다. list를 신호로 읽는다.
async function waitReceiver(core: Core, place: Place): Promise<string> {
  return await until("받는 project place session이 열림", async () => {
    const { sessions } = await core.call(placeSessionList, {
      agent: LOPHN_AGENT_ID,
      place,
    });
    return sessions[0]?.id;
  });
}

// 허락을 기다리는 project place session에 home의 lophn이 보낸 call이 열려 있는 상태를 만든다. 늦은 허락을 보낼 수 있게 request도 돌려준다.
async function openCallWaitingPermission(
  core: Core,
  fake: FakeServer,
  name: string,
) {
  fake.reset();
  const { place } = await newProject(core, name);
  const ask = await shellAsk(`${core.run.work}/${name}`);
  const callBody = JSON.stringify({
    to: { agent: "lophn", place: { project: name } },
    reply: "result",
    body: "clean up",
    refs: [],
  });
  fake.script(
    [
      {
        reply: {
          kind: "tool",
          calls: [{ id: "t1", name: "call", arguments: callBody }],
        },
      },
      textReply("sent"),
      textReply("failed noted"),
    ],
    {
      name: "home",
      match: (request) => toolNames(request).includes("app_create"),
    },
  );
  fake.script([{ reply: ask.reply("w1") }], {
    name: "project",
    match: (request) =>
      toolNames(request).includes("workflow_check") &&
      !toolNames(request).includes("app_create") &&
      !toolNames(request).includes("release_prepare"),
  });
  const src = await openPlaceSession(core, LOPHN_AGENT_ID);
  await say(core, src, "ask the project");
  const dst = await waitReceiver(core, place);
  const { request } = await waitPermission(core, dst);
  const [received] = await messagesOf(core, dst);
  return { src, dst, request, call: received!.call!, ask };
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
  await core.call(
    sessionRewind,
    {
      id: core.ids.newId("rwd"),
      session,
      checkpoint,
      choice: "messages_only",
      accept_remaining: true,
      preview_hash: preview.preview_hash,
      summary_call: null,
      files: [],
      apps: [],
    },
    { session_state: "open", active_turn: null, applying_rewind: null },
  );
}

test("session 열기·보관·fork는 agent와 place, 이력의 규칙을 지킨다", async (t) => {
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
    await t.test(
      "person-message: 보관 중에는 입력만 막히고 session은 열려 있어 꺼내면 이어서 받는다",
      async () => {
        f.reset();
        f.script([textReply("ok")]);
        const { project, place } = await newProject(c, "person-message");
        const session = await openAt(c, place);

        await setArchived(c, project, true);
        const refused = await trySay(c, session, "while archived");
        assert.ok(!refused.ok);
        assert.deepStrictEqual(refused.error.code, "conflict");

        await setArchived(c, project, false);
        const { message } = await say(c, session, "after unarchive");
        await waitTurnEnd(c, session);

        // 거절된 message는 흔적이 없다. agent의 대답은 같은 session의 message로 따로 남는다.
        assert.deepStrictEqual(
          (await messagesOf(c, session))
            .filter((item) => item.from.kind === "human")
            .map((item) => item.id),
          [message],
        );
        const { session: read } = await c.call(placeSessionRead, { session });
        assert.deepStrictEqual(read.lifecycle, "open");
        assert.deepStrictEqual(f.journal().length, 1);
      },
    );

    await t.test(
      "agent-call: 보관된 place의 session에 보낸 call은 closed고 session은 안 끝난다",
      async () => {
        f.reset();
        const { project, place } = await newProject(c, "agent-call");
        const target = await openAt(c, place);
        const caller = await openPlaceSession(c, LOPHN_AGENT_ID);
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
        await say(c, caller, "call the project session");
        await waitTurnEnd(c, caller);

        assert.ok(toolResultOf(f, "t1").includes("closed"));
        assert.deepStrictEqual(await messagesOf(c, target), []);
        const { session: read } = await c.call(placeSessionRead, {
          session: target,
        });
        assert.deepStrictEqual(read.lifecycle, "open");
      },
    );

    // fork-copies-history
    await t.test(
      "fork-at-point: 고른 지점까지의 message만 복사하고 turn은 가져가지 않는다",
      async () => {
        f.reset();
        f.script([textReply("a1"), textReply("a2"), textReply("a3")]);
        const { place } = await newProject(c, "fork-at-point");
        const session = await openAt(c, place);
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
        assert.deepStrictEqual(forked.copied_messages, 3);
        assert.deepStrictEqual(forked.forked_from, {
          session,
          through_seq: point,
        });

        const copied = await messagesOf(c, forked.id);
        assert.deepStrictEqual(
          copied.map((item) => item.body),
          origin.slice(0, 3).map((item) => item.body),
        );
        assert.deepStrictEqual(
          copied.map((item) => item.turn),
          [null, null, null],
        );
        assert.deepStrictEqual(await ownTurnsOf(c, forked.id), []);
        const { session: original } = await c.call(placeSessionRead, {
          session,
        });
        const { session: copy } = await c.call(placeSessionRead, {
          session: forked.id,
        });
        // fork는 같은 agent, 같은 place다.
        assert.deepStrictEqual(copy.agent, original.agent);
        assert.deepStrictEqual(copy.place, original.place);
        assert.deepStrictEqual(copy.lifecycle, "open");
      },
    );

    await t.test(
      "fork-skips-rewound: rewind가 숨긴 구간은 복사하지 않는다",
      async () => {
        f.reset();
        f.script([textReply("a1"), textReply("a2"), textReply("a3")]);
        const { place } = await newProject(c, "fork-skips-rewound");
        const session = await openAt(c, place);
        await say(c, session, "one");
        await waitTurnEnd(c, session, 0);
        const second = await say(c, session, "two");
        await waitTurnEnd(c, session, 1);
        await rewindMessagesOnly(c, session, second.message);
        const third = await say(c, session, "three");
        await waitTurnEnd(c, session, 2);
        const sent = (await messagesOf(c, session)).find(
          (item) => item.id === third.message,
        )!;

        // 숨긴 구간(two와 그 대답 a2)은 빠지고 [one, a1, three]만 간다.
        const forked = await c.call(forkSession, {
          id: c.ids.newId("ses"),
          source: session,
          through_seq: sent.created_seq,
        });
        assert.deepStrictEqual(forked.copied_messages, 3);
        assert.deepStrictEqual(await bodiesOf(c, forked.id), [
          "one",
          "a1",
          "three",
        ]);
        assert.deepStrictEqual(await ownTurnsOf(c, forked.id), []);
      },
    );

    await t.test(
      "archived-project: 보관된 project에는 session을 열 수 없고 꺼내면 열린다",
      async () => {
        const { project, place } = await newProject(c, "archived-project");
        await setArchived(c, project, true);
        const refused = await c.tryCall(placeSessionOpen, {
          id: c.ids.newId("ses"),
          agent: LOPHN_AGENT_ID,
          place,
        });
        assert.ok(!refused.ok);
        assert.deepStrictEqual(refused.error.code, "conflict");
        const none = await c.call(placeSessionList, {
          agent: LOPHN_AGENT_ID,
          place,
          archived: "include",
        });
        assert.deepStrictEqual(none.sessions, []);

        await setArchived(c, project, false);
        const session = await openAt(c, place);
        const { session: read } = await c.call(placeSessionRead, { session });
        assert.deepStrictEqual(read.lifecycle, "open");
      },
    );

    await t.test(
      "unknown-agent: 없는 agent에는 session을 열 수 없다",
      async () => {
        const agent: AgentId = c.ids.newId("agt");
        const refused = await c.tryCall(placeSessionOpen, {
          id: c.ids.newId("ses"),
          agent,
          place: null,
        });
        assert.ok(!refused.ok);
        assert.deepStrictEqual(refused.error.code, "not_found");
        assert.deepStrictEqual(
          (await c.call(placeSessionList, { agent, place: null })).sessions,
          [],
        );
      },
    );

    await t.test(
      "lophn-reads-not-writes: lophn은 project 폴더를 읽고 쓰기 tool은 목록에 없다",
      async () => {
        f.reset();
        await newProject(c, "lophn-scope");
        const folder = `${c.run.work}/lophn-scope`;
        await writeFile(`${folder}/notes.md`, "alpha");
        const session = await openPlaceSession(c, LOPHN_AGENT_ID);
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
        assert.ok(names.includes("file_read"));
        for (const gone of ["file_write", "file_edit", "shell_run"]) {
          assert.ok(!names.includes(gone), `lophn에 ${gone}이 보인다`);
        }
        assert.ok(toolResultOf(f, "t-read").includes("alpha"));
        // 없는 tool의 call은 tool_result로만 not_found를 돌려받고 ledger에는 행이 없다(tool 정의가 없어 진입하지 않는다).
        assert.ok(toolResultOf(f, "t-write").includes("not_found"));
        // ledger
        assert.deepStrictEqual(await outcomesOf(c, turn.id), {
          "t-read": { kind: "success", code: "ok" },
        });
        // disk
        assert.ok(!(await exists(`${folder}/new.md`)));
      },
    );

    await t.test(
      "project-tools-run: project place의 tool이 runtime child에서 돌고 web_fetch는 loopback으로 나가지 못하며 agent를 만드는 tool은 할당을 주지 않는다",
      async () => {
        f.reset();
        const { place } = await newProject(c, "project-tools");
        const folder = `${c.run.work}/project-tools`;
        await writeFile(`${folder}/pic.png`, PIXEL);
        await writeFile(`${folder}/notes.md`, "notes for the project\n");
        const session = await openAt(c, place);
        const call = (id: string, name: string, args: unknown) => ({
          id,
          name,
          arguments: JSON.stringify(args),
        });
        f.script([
          {
            reply: {
              kind: "tool",
              calls: [
                call("shell", "shell_run", { command: SHELL }),
                call("skill", "skill_read", { name: "write-kinds" }),
                call("image", "image_read", { path: "pic.png" }),
                call("grep", "file_grep", { pattern: "notes" }),
                call("web", "web_fetch", { url: `${f.url}/probe` }),
                call("agent", "agent_create", {
                  name: "helper",
                  body: "Help.",
                }),
              ],
            },
          },
          textReply("done"),
        ]);
        await say(c, session, "use the tools");
        // 물었다면 turn이 기다려 끝나지 않는다.
        const turn = await waitTurnEnd(c, session);

        // disk
        assert.deepStrictEqual(
          await readFile(`${folder}/made.txt`, "utf8"),
          "hi\n",
        );
        // ledger
        const outcomes = await outcomesOf(c, turn.id);
        for (const key of ["shell", "skill", "image", "grep", "agent"]) {
          assert.deepStrictEqual(outcomes[key]?.kind, "success", key);
        }
        // web/target.ts의 거절 code
        assert.deepStrictEqual(outcomes["web"], {
          kind: "failure",
          code: "invalid_input",
        });
        const { agents } = await c.call(agentList, {});
        const helper = agents.find((row) => row.name === "helper");
        assert.ok(helper !== undefined, "helper agent가 없다");
        const made = await c.call(assignmentGet, { agent: helper.agent });
        assert.deepStrictEqual(made.assignment.entries, []);
        assert.deepStrictEqual(made.revision, 0);
        // fake: agent_create 입력에 할당·mcp_servers·skip 칸이 없다.
        const createTool = (
          f.journal()[0]!.body as {
            tools: { name: string; input_schema: { properties: object } }[];
          }
        ).tools.find((tool) => tool.name === "agent_create");
        assert.ok(createTool !== undefined);
        const keys = Object.keys(createTool.input_schema.properties);
        assert.ok(!keys.includes("mcp_servers") && !keys.includes("skip"));
        assert.deepStrictEqual(
          keys.filter((key) => key.includes("assign") || key.includes("grant")),
          [],
        );
        // shell 출력 상한
        assert.ok(
          toolResultOf(f, "shell").length <= 30 * 1024,
          "shell 출력이 상한을 넘음",
        );
      },
    );

    for (const how of ["archive", "delete"] as const) {
      await t.test(
        `${how}-call: session을 ${
          how === "archive" ? "archive하면" : "지우면"
        } 도는 turn, 대기 허락, 받은 call이 한 번에 닫힌다`,
        async () => {
          const name = `${how}-call`;
          const { src, dst, request, call, ask } =
            await openCallWaitingPermission(c, f, name);
          const [turn] = await ownTurnsOf(c, dst);
          const { session: current } = await c.call(placeSessionRead, {
            session: dst,
          });
          await c.call(
            how === "archive" ? archiveSession : deleteSession,
            {
              session: dst,
            },
            { state_seq: current.state_seq },
          );
          // 보낸 쪽이 늦은 실패를 새 입력으로 받아 둘째 turn을 돈다.
          await waitTurnEnd(c, src, 1);

          // ledger
          if (how === "archive") {
            const closed = await c.call(turnRead, { turn: turn!.id });
            assert.deepStrictEqual(closed.turn.state, "finished");
            assert.deepStrictEqual(closed.turn.outcome, {
              kind: "interrupted",
              reason: "session_ended",
            });
            const { session } = await c.call(placeSessionRead, {
              session: dst,
            });
            assert.deepStrictEqual(session.lifecycle, "archived");
          } else {
            const gone = await c.tryCall(placeSessionRead, { session: dst });
            assert.ok(!gone.ok && gone.error.code === "not_found");
          }
          // route
          const { call: closedCall } = await c.call(agentCallRead, { call });
          assert.deepStrictEqual(closedCall.state, "failed");
          assert.deepStrictEqual(closedCall.fail_reason, "receiver_ended");
          const late = await c.tryCall(turnRequestDecide, {
            session: dst,
            request,
            choice: { kind: "once" },
          });
          assert.ok(!late.ok, "끝난 session의 늦은 once가 받아들여졌다");
          // disk
          assert.ok(await ask.exists(), "늦은 once가 명령을 돌렸다");
        },
      );
    }
  } finally {
    await core?.kill().catch(() => {});
    await fake?.close();
    await run.remove();
  }
});
