// 세 질문
// - contract: boundary `router`(call 왕복, 실패는 보낸 쪽에 한 번만 돌아간다, 재시작에 사라지지 않는다), `agent-sessions`(받는
//   session의 끝이 call을 닫는다), `agent-tools`(`call`·`reply`·`cancel`).
// - 현실적 회귀: reply가 보낸 session의 새 입력이 되지 못하는 것, 받은 session이 archive됐는데 call이 `accepted`로 영영 남는 것,
//   같은 실패가 tool 결과와 입력 둘로 가서 agent가 두 번 반응하는 것(전례: archived/agent-call.md), 재시작에 입력함의 call이
//   말없이 사라지는 것, 취소한 call에 늦은 reply가 오류로 돌아가거나 닫힌 session이 다시 열리는 것.
// - 왜 지금 test로 못 잡나: router_test는 Router와 가짜 저장소만 본다. 두 session의 model turn이 서로 얽히는 왕복과 재시작
//   복구는 process를 건너야 하고, fake는 줄(lane) 없이는 session 둘이 동시에 부를 때 순서가 갈린다.
//
// 행의 fake 대답이 3개를 넘는다(README 정한 것 11의 예외): 보내는 session A와 받는 session B가 각자 turn을 돌고 서로의 입력을
// 기다려야 하는 flow라 한 행이 4~9개가 된다. 대신 단계와 단정 상한은 지킨다. 줄은 요청의 tool 목록으로 가른다
// (lophn은 app_create, PM은 operator_create(app_create·release_prepare 없이), App Engineer는 release_prepare, 그 외 call을 가진 것은 Operator).
//
// call-dedup 행은 두지 않는다. 같은 reply에 같은 tool call id를 두 번 넣어도 core는 tool call마다 새 tcl id를 만들고
// Router의 dedup 키는 그 tcl id라서 session 둘이 열린다(retry 흉내가 안 된다). dedup 규칙은 router_test.ts가 지킨다.
//
// core는 file 전체에서 하나, 행마다 새 A/B session을 연다. 재시작 행은 core를 바꾸므로 마지막이다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { appCreate } from "../../packages/protocol/apps/mod.ts";
import {
  type AgentRef,
  agentSessionList,
  agentSessionRead,
  archiveSession,
  callRead,
  operatorCreate,
  receivedMessageList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { shellAsk } from "../support/core/shell-ask.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  settle,
  turnsOf,
  until,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  type JournalEntry,
  type Lane,
  type Reply,
  startFakeServer,
  type Step,
} from "../support/fake-server/mod.ts";
import {
  idIn,
  lastToolResult,
  toolNames,
} from "../support/fake-server/probe.ts";

const names = (request: JournalEntry) => toolNames(request);
const LOPHN: Lane = {
  name: "lophn",
  match: (r) => names(r).includes("app_create"),
};
const PM: Lane = {
  name: "pm",
  match: (r) =>
    names(r).includes("operator_create") &&
    !names(r).includes("app_create") &&
    !names(r).includes("release_prepare"),
};
const AE: Lane = {
  name: "ae",
  match: (r) => names(r).includes("release_prepare"),
};
const OPERATOR: Lane = {
  name: "operator",
  match: (r) =>
    names(r).includes("call") &&
    !["app_create", "operator_create", "release_prepare"].some((n) =>
      names(r).includes(n),
    ),
};

const text = (value: string): Step => ({
  reply: { kind: "text", text: value },
});

function tool(
  id: string,
  name: string,
  args: unknown,
): { id: string; name: string; arguments: string } {
  return { id, name, arguments: JSON.stringify(args) };
}

const callStep = (to: unknown, reply: string, body: string): Step => ({
  reply: {
    kind: "tool",
    calls: [tool("c1", "call", { to, reply, body, refs: [] })],
  },
});

// 요청 어디엔가 있는 call id(`cal_...`)로 tool을 부른다. 다음 turn의 history에는 앞 turn의 tool 결과가 없으므로 그때는
// known이 test가 ledger에서 읽은 id를 준다. 어느 쪽도 없으면 설명이 있는 차이 오류로 끝난다.
function withCallId(
  name: string,
  args: (call: string) => unknown,
  known?: () => string,
): Step {
  return {
    reply: (request): Reply => {
      const call = known?.() ?? idIn(JSON.stringify(request.body), "cal");
      if (call === undefined) throw new Error("요청에 call id가 없다");
      return {
        kind: "tool",
        calls: [tool(`t_${name}`, name, args(call))],
      };
    },
  };
}

// tool_result 글은 JSON이고 내용이 content에 있다.
function resultOf(request: JournalEntry, id: string) {
  const raw = lastToolResult(request, id);
  assert.ok(raw !== undefined, `요청에 ${id}의 tool_result가 없다`);
  return (JSON.parse(raw).content ?? {}) as Record<string, unknown>;
}

const lane = (fake: FakeServer, name: string) =>
  fake.journal().filter((entry) => entry.lane === name);

function assertNoMismatch(fake: FakeServer) {
  assert.deepStrictEqual(
    fake
      .journal()
      .filter((entry) => entry.mismatch !== null)
      .map((entry) => `#${entry.n} ${entry.lane}: ${entry.mismatch}`),
    [],
  );
}

async function sessionIds(core: Core, agent: AgentRef): Promise<string[]> {
  const { sessions } = await core.call(agentSessionList, { agent });
  return sessions.map((session) => session.id);
}

// known에 없던 session이 열릴 때까지 기다려 그 id를 돌려준다.
async function opened(
  core: Core,
  agent: AgentRef,
  known: string[],
): Promise<string> {
  return await until("새 session이 열림", async () =>
    (await sessionIds(core, agent)).find((id) => !known.includes(id)),
  );
}

async function messagesOf(core: Core, session: string) {
  return (await core.call(receivedMessageList, { session })).messages;
}

// 받은 session이 이 call로 받은 message에서 call id를 읽는다.
async function callOf(core: Core, receiver: string): Promise<string> {
  return await until(
    "받은 call이 기록됨",
    async () =>
      (await messagesOf(core, receiver)).find(
        (m) => m.call !== null && m.from.kind === "agent",
      )?.call ?? undefined,
  );
}

async function callRecord(core: Core, call: string) {
  return (await core.call(callRead, { call })).call;
}

async function archive(core: Core, session: string): Promise<void> {
  const { session: current } = await core.call(agentSessionRead, { session });
  await core.call(
    archiveSession,
    { session },
    {
      state_seq: current.state_seq,
    },
  );
}

test("E2E agent 사이 call은 답이 돌아오고, 끝나거나 재시작해도 보낸 쪽이 실패를 한 번 받는다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await mkdir(folder);
    const { project } = await openProject(core, folder);
    const pm: AgentRef = { role: "project_manager", project };
    const toPm = { role: "project_manager", place: { project: "proj" } };
    const c = core;
    // 실패하면 어느 요청이 어느 줄로 갔고 무엇이 어긋났는지 같이 보인다.
    const step = (name: string, body: () => Promise<void>) =>
      t.test(name, async () => {
        try {
          await body();
        } catch (error) {
          const journal = fake
            .journal()
            .map((e) => `#${e.n} ${e.lane} ${e.mismatch ?? ""}`)
            .join("; ");
          throw new Error(
            `${
              error instanceof Error ? error.message : error
            }\nfake: ${journal}`,
            { cause: error },
          );
        }
      });

    await step(
      "roundtrip: A가 B를 부르면 B의 답이 A의 새 입력으로 돌아온다",
      async () => {
        fake.reset();
        fake.script(
          [
            callStep(toPm, "result", "ping"),
            text("sent"),
            text("got the answer"),
          ],
          LOPHN,
        );
        fake.script(
          [
            withCallId("reply", (call) => ({ call, body: "pong", refs: [] })),
            text("replied"),
          ],
          PM,
        );
        const known = await sessionIds(c, pm);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "ask the project manager. LOPHN-ONLY-MARK");
        const b = await opened(c, pm, known);
        await waitTurnEnd(c, b);
        await waitTurnEnd(c, a, 1);
        assertNoMismatch(fake);

        // ledger: call은 B의 reply로 done이 됐고 B의 session은 하나만 열렸다.
        const call = await callOf(c, b);
        assert.deepStrictEqual((await callRecord(c, call)).state, "done");
        assert.deepStrictEqual(
          (await sessionIds(c, pm)).length,
          known.length + 1,
        );
        // fake: 원문 대화가 아니라 body만 넘어가고 B의 답이 A의 셋째 요청에 있다.
        const toA = lane(fake, "lophn");
        const toB = lane(fake, "pm");
        assert.ok(JSON.stringify(toA[2].body).includes("pong"));
        const first = JSON.stringify(toB[0].body);
        assert.ok(first.includes("ping"));
        assert.ok(!first.includes("LOPHN-ONLY-MARK"));
        // ledger: A의 첫 turn은 B를 기다리지 않고 끝났고 B의 답은 그 뒤 새 turn을 열었다.
        const turns = await turnsOf(c, a);
        assert.deepStrictEqual(turns[0].outcome?.kind, "completed");
        assert.deepStrictEqual(resultOf(toA[1], "c1").state, "accepted");
        assert.ok(turns[1].started_at >= turns[0].finished_at!);
      },
    );

    await step(
      "receiver-ended: B가 답 없이 archive되면 A가 실패를 입력 하나로 받는다",
      async () => {
        fake.reset();
        fake.script(
          [
            callStep(toPm, "result", "ping"),
            text("sent"),
            text("noted the failure"),
          ],
          LOPHN,
        );
        fake.script([text("done without a reply")], PM);
        const known = await sessionIds(c, pm);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "ask the project manager");
        const b = await opened(c, pm, known);
        await waitTurnEnd(c, b);
        await archive(c, b);
        await waitTurnEnd(c, a, 1);
        assertNoMismatch(fake);

        // ledger: call은 failed(receiver_ended)로 닫혔다.
        const call = await callOf(c, b);
        const record = await callRecord(c, call);
        assert.deepStrictEqual(
          [record.state, record.fail_reason],
          ["failed", "receiver_ended"],
        );
        // ledger: A는 같은 실패를 tool 결과가 아니라 입력 하나로만 받았다.
        const notices = (await messagesOf(c, a)).filter(
          (m) => m.reply_to === call,
        );
        assert.deepStrictEqual(notices.length, 1);
        assert.deepStrictEqual(notices[0].from.kind, "program");
        // fake: A의 요청은 call, tool 결과 뒤, 실패 알림 turn 셋뿐이다.
        assert.deepStrictEqual(lane(fake, "lophn").length, 3);
      },
    );

    await step(
      "call-not-found: 없는 이름의 call은 tool 결과로만 실패하고 session도 call 행도 없다",
      async () => {
        fake.reset();
        fake.script(
          [
            callStep(
              {
                role: "project_manager",
                place: { project: "no-such-project" },
              },
              "none",
              "hi",
            ),
            text("it failed"),
          ],
          LOPHN,
        );
        const before = await sessionIds(c, pm);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "ask a project that does not exist");
        await waitTurnEnd(c, a);
        assertNoMismatch(fake);

        // fake: call의 tool_result가 failed와 not_found를 담는다.
        const result = resultOf(lane(fake, "lophn")[1], "c1");
        assert.deepStrictEqual(
          [result.state, result.fail_reason],
          ["failed", "not_found"],
        );
        // route: 새 session이 열리지 않았다.
        assert.deepStrictEqual(await sessionIds(c, pm), before);
        // ledger: 이름을 못 푼 call은 받는 곳을 적을 수 없어 행이 없다.
        const read = await c.tryCall(callRead, { call: String(result.call) });
        assert.ok(!read.ok);
        assert.deepStrictEqual(read.error.code, "not_found");
      },
    );

    await step(
      "call-closed-session: 닫힌 session으로의 call은 다시 열지 않고 실패한다",
      async () => {
        fake.reset();
        const b = await openSession(c, pm);
        await archive(c, b);
        fake.script(
          [callStep({ session: b }, "none", "hi"), text("it failed")],
          LOPHN,
        );
        const known = await sessionIds(c, pm);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "ask the closed session");
        await waitTurnEnd(c, a);
        assertNoMismatch(fake);

        // fake: tool_result가 failed·closed이고 새로 열라는 hint를 담는다.
        const result = resultOf(lane(fake, "lophn")[1], "c1");
        assert.deepStrictEqual(
          [result.state, result.fail_reason],
          ["failed", "closed"],
        );
        assert.ok(String(result.hint).includes("call its role and place"));
        // route: session이 새로 열리지 않았다.
        assert.deepStrictEqual(await sessionIds(c, pm), known);
        // ledger: B가 받은 message가 없다.
        assert.deepStrictEqual(await messagesOf(c, b), []);
      },
    );

    await step(
      "call-none-no-reply: 답 없는 call은 보낸 쪽을 다시 깨우지 않는다",
      async () => {
        fake.reset();
        fake.script([callStep(toPm, "none", "fyi"), text("sent")], LOPHN);
        fake.script([text("noted")], PM);
        const known = await sessionIds(c, pm);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "tell the project manager");
        const b = await opened(c, pm, known);
        await waitTurnEnd(c, b);
        await waitTurnEnd(c, a);
        assertNoMismatch(fake);

        // route: B는 이 call의 message를 받았다.
        assert.deepStrictEqual(
          (await messagesOf(c, b)).filter((m) => m.call !== null).length,
          1,
        );
        // ledger: A가 받은 것은 사람 message 하나뿐이고 turn도 하나다.
        assert.deepStrictEqual(
          (await messagesOf(c, a)).filter(
            (m) => m.call !== null || m.reply_to !== null,
          ),
          [],
        );
        assert.deepStrictEqual((await turnsOf(c, a)).length, 1);
        // fake: A의 요청은 둘뿐이다.
        assert.deepStrictEqual(lane(fake, "lophn").length, 2);
      },
    );

    await step(
      "operator-to-app-ae: Operator가 App Engineer를 부르면 같은 왕복이 돈다",
      async () => {
        fake.reset();
        const app = await c.call(
          appCreate,
          {
            slug: "ledger-app",
            name: "Ledger App",
            description: "Keep a ledger.",
          },
          {},
        );
        const ae: AgentRef = { role: "app_engineer", app: app.id };
        const agent = c.ids.newId("agt");
        await c.call(operatorCreate, {
          id: agent,
          place: { kind: "project", id: project },
          definition: { name: "reviewer", body: "review" },
        });
        const operator: AgentRef = { role: "operator", agent };
        fake.script(
          [
            callStep(
              { role: "app_engineer", place: { app: "Ledger App" } },
              "result",
              "need fix",
            ),
            text("sent"),
            text("got the fix"),
          ],
          OPERATOR,
        );
        fake.script(
          [
            withCallId("reply", (call) => ({ call, body: "fixed", refs: [] })),
            text("replied"),
          ],
          AE,
        );
        const o = await openSession(c, operator);
        await say(c, o, "ask the app engineer");
        const b = await opened(c, ae, []);
        await waitTurnEnd(c, b);
        await waitTurnEnd(c, o, 1);
        assertNoMismatch(fake);

        // ledger: call이 done이다.
        assert.deepStrictEqual(
          (await callRecord(c, await callOf(c, b))).state,
          "done",
        );
        // fake: Operator의 셋째 요청에 App Engineer의 답이 있다.
        assert.ok(
          JSON.stringify(lane(fake, "operator")[2].body).includes("fixed"),
        );
        // route: App Engineer session이 하나 열렸다.
        assert.deepStrictEqual((await sessionIds(c, ae)).length, 1);
      },
    );

    await step(
      "call-cancel-late-reply: 취소한 call에 늦게 온 reply는 closed로 돌아간다",
      async () => {
        fake.reset();
        const ask = await shellAsk(folder, "call-cancel-late-reply");
        let sent = "";
        fake.script(
          [
            callStep(toPm, "result", "ping"),
            text("sent"),
            withCallId(
              "cancel",
              (call) => ({ call, reason: "no longer needed" }),
              () => sent,
            ),
            text("cancelled"),
          ],
          LOPHN,
        );
        fake.script(
          [
            { reply: ask.reply("w1") },
            withCallId("reply", (call) => ({ call, body: "late", refs: [] })),
            text("replied"),
            text("saw the cancel"),
          ],
          PM,
        );
        const known = await sessionIds(c, pm);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "ask the project manager");
        const b = await opened(c, pm, known);
        const { request } = await waitPermission(c, b);
        await waitTurnEnd(c, a);
        sent = await callOf(c, b);
        await say(c, a, "cancel it");
        await waitTurnEnd(c, a, 1);
        await decide(c, b, request, "once");
        await waitTurnEnd(c, b, 1);
        assertNoMismatch(fake);

        // ledger: call은 cancelled다.
        const call = await callOf(c, b);
        assert.deepStrictEqual((await callRecord(c, call)).state, "cancelled");
        // fake: B의 reply 결과는 오류가 아니라 closed: true다.
        const result = resultOf(lane(fake, "pm")[2], "t_reply");
        assert.deepStrictEqual(
          [result.closed, result.delivered],
          [true, false],
        );
        // ledger: A는 그 reply를 입력으로 받지 않았다.
        assert.deepStrictEqual(
          (await messagesOf(c, a)).filter((m) => m.reply_to === call),
          [],
        );
      },
    );

    await step(
      "call-sender-archived: 보낸 session이 닫혀도 reply는 받은 session에서 끝난다",
      async () => {
        fake.reset();
        const ask = await shellAsk(folder, "call-sender-archived");
        fake.script([callStep(toPm, "result", "ping"), text("sent")], LOPHN);
        fake.script(
          [
            { reply: ask.reply("w1") },
            withCallId("reply", (call) => ({ call, body: "late", refs: [] })),
            text("replied"),
          ],
          PM,
        );
        const known = await sessionIds(c, pm);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "ask the project manager");
        const b = await opened(c, pm, known);
        const { request } = await waitPermission(c, b);
        await waitTurnEnd(c, a);
        await archive(c, a);
        await decide(c, b, request, "once");
        await waitTurnEnd(c, b);
        assertNoMismatch(fake);

        // ledger: reply가 받은 session에서 call을 done으로 닫았다.
        const call = await callOf(c, b);
        assert.deepStrictEqual((await callRecord(c, call)).state, "done");
        // route: archive된 A에 reply 입력도 새 turn도 없다.
        assert.deepStrictEqual((await turnsOf(c, a)).length, 1);
        assert.deepStrictEqual(
          (await messagesOf(c, a)).filter((m) => m.reply_to === call),
          [],
        );
        // fake: B의 reply는 오류 없이 전해지지 않음(delivered: false)만 알린다.
        const result = resultOf(lane(fake, "pm")[2], "t_reply");
        assert.deepStrictEqual(
          [result.closed, result.delivered],
          [false, false],
        );
      },
    );

    await step(
      "inbox-order: call이 먼저 와도 사람 message가 먼저 turn이 된다",
      async () => {
        fake.reset();
        const ask = await shellAsk(folder, "inbox-order");
        const b = await openSession(c, pm);
        fake.script(
          [callStep({ session: b }, "none", "call-body-marker"), text("sent")],
          LOPHN,
        );
        fake.script(
          [
            { reply: ask.reply("w1") },
            text("wrote"),
            text("answered the human"),
            text("handled the call"),
          ],
          PM,
        );
        await say(c, b, "write the file");
        const { request } = await waitPermission(c, b);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "tell the project manager");
        await waitTurnEnd(c, a);
        const human = (await say(c, b, "human-follow-up")).message;
        await decide(c, b, request, "once");
        await waitTurnEnd(c, b, 2);
        assertNoMismatch(fake);

        // ledger: 둘째 turn의 입력은 사람 message, 셋째 turn의 입력은 call message다.
        const turns = await turnsOf(c, b);
        const callMessage = (await messagesOf(c, b)).find(
          (m) => m.call !== null,
        )!;
        assert.deepStrictEqual(
          turns.map((turn) => turn.input_message).slice(1),
          [human, callMessage.id],
        );
        // fake: 셋째 요청에는 사람 글이 있고, call 글은 넷째 요청에서 call 태그에 싸여 처음 나온다.
        const toB = lane(fake, "pm").map((e) => JSON.stringify(e.body));
        assert.ok(toB[2].includes("human-follow-up"));
        assert.ok(toB[3].includes("<lophn-call"));
        // 넷째 요청의 history에는 앞 turn이 가져간 사람 글이 있다.
        assert.ok(toB[3].includes("human-follow-up"));
        // route: B의 turn은 셋이고 모두 completed다.
        assert.deepStrictEqual(
          turns.map((turn) => turn.outcome?.kind),
          ["completed", "completed", "completed"],
        );
        // 아직 가져가지 않은 call의 글은 앞선 turn의 prompt에 들어가지 않는다.
        assert.ok(
          !toB[2].includes("call-body-marker"),
          "아직 turn이 가져가지 않은 call 글이 사람 message turn의 prompt에 태그 없이 들어갔다",
        );
      },
    );

    await step(
      "restart-lost: 안 가져간 call은 재시작에 lophn_restarted로 닫히고 A가 알림을 받는다",
      async () => {
        fake.reset();
        const ask = await shellAsk(folder, "restart-lost");
        const b = await openSession(c, pm);
        fake.script(
          [
            callStep({ session: b }, "result", "ping"),
            text("sent"),
            text("noted the restart"),
          ],
          LOPHN,
        );
        fake.script([{ reply: ask.reply("w1") }], PM);
        await say(c, b, "write the file");
        await waitPermission(c, b);
        const a = await openSession(c, { role: "lophn" });
        await say(c, a, "ask the project manager");
        await waitTurnEnd(c, a, 0);
        const call = await callOf(c, b);
        await c.kill();
        core = await bootCore(run);
        const after = core;
        await settle(after);
        await waitTurnEnd(after, a, 1);
        assertNoMismatch(fake);

        // ledger: call은 failed(lophn_restarted)이고 B의 첫 turn은 restarted로 끊겼다.
        const record = await callRecord(after, call);
        assert.deepStrictEqual(
          [record.state, record.fail_reason],
          ["failed", "lophn_restarted"],
        );
        assert.deepStrictEqual((await turnsOf(after, b))[0].outcome, {
          kind: "interrupted",
          reason: "restarted",
        });
        // ledger: A는 알림을 입력 하나로 받았다.
        assert.deepStrictEqual(
          (await messagesOf(after, a)).filter((m) => m.reply_to === call)
            .length,
          1,
        );
        // fake: B 하나와 A 셋이다.
        assert.deepStrictEqual(fake.journal().length, 4);
      },
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
