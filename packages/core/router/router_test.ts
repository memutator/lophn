import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import {
  type AgentCallRow,
  callReply,
} from "../../protocol/lophn-agent/calls.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import {
  type AgentAtWorkspace,
  lophnIdOf,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import {
  APP_CALL_SETTLED_TOPIC,
  ASK_ANSWERED_TOPIC,
  ASK_ENDED_TOPIC,
  CALL_SESSION_OPENED_TOPIC,
} from "./model.ts";
import { createRouter } from "./router.ts";
import type {
  CallStore,
  RoutedInput,
  SessionDirectory,
  TargetSession,
} from "./ports.ts";

// port 대역으로 Router의 결정만 본다. 닫힌 session, 늦은 답, 같은 dedup이 깨지면 곤란하다.

const SENDER = "ses_sender";
const RECEIVER = "ses_receiver";
const lophn = { agent: lophnIdOf(null), workspace: null } as const;

function target(
  session: string,
  accepting: boolean,
  agent: AgentAtWorkspace = lophn,
  spawned_by: string | null = null,
): TargetSession {
  return {
    session: session as TargetSession["session"],
    transport: "lophn",
    agent,
    accepting,
    spawned_by: spawned_by as TargetSession["spawned_by"],
    opened_by_machine: null,
  };
}

function setup(
  sessions: Record<string, TargetSession>,
  accepts: SessionDirectory["accepts"] = () => null,
  policy: CallPolicy = DEFAULT_CALL_POLICY,
) {
  let counter = 0;
  const tx = {
    now: () => "2026-10-16T00:00:00.000Z",
    newId: (prefix: string) => `${prefix}_${++counter}`,
  } as unknown as Tx;
  const rows = new Map<string, AgentCallRow>();
  const delivered: { to: string; input: RoutedInput }[] = [];
  const cancelled: boolean[] = [];
  const announced: { topic: string; data: unknown }[] = [];
  let opened = 0;
  const openedBy: (string | null)[] = [];
  const openedAt: AgentAtWorkspace[] = [];
  const store: CallStore = {
    insert: (_tx, record) => {
      rows.set(record.call, record);
      return ok(undefined);
    },
    byDedup: (_tx, sender, dedup) =>
      [...rows.values()].find(
        (row) =>
          row.from.kind === "agent" &&
          sender.kind === "agent" &&
          row.from.session === sender.session &&
          row.dedup === dedup,
      ) ?? null,
    read: (_tx, call) => rows.get(call) ?? null,
    move: (_tx, call, to, reason, result) => {
      const row = rows.get(call)!;
      const moved = {
        ...row,
        state: to,
        fail_reason: reason,
        result: result ?? null,
      };
      rows.set(call, moved);
      return ok(moved);
    },
    markConsumed: () => ok(undefined),
    setDelivery: () => ok(undefined),
    lost: () => [],
    openReceivedBy: (_tx, session) =>
      [...rows.values()].filter(
        (row) => row.state === "accepted" && row.receiver_session === session,
      ),
  };
  const directory: SessionDirectory = {
    find: (session) => sessions[session] ?? null,
    resolveAddress: () => ok(sessions[RECEIVER]?.agent ?? lophn),
    open: (_tx, agent, _opener, spawnedBy) => {
      opened += 1;
      openedAt.push(agent);
      openedBy.push(spawnedBy);
      return ok(sessions[RECEIVER]!);
    },
    app: (id) => ({ slug: id.replace("app_", ""), archived: false }),
    accepts,
    listOpen: () => [],
    projectOfIdentity: () => null,
    identityOfProject: () => ok("pri_test"),
    appIdOf: () => ok("app_x"),
  };
  const router = createRouter({
    directory,
    store,
    outbox: {} as never,
    seen: {} as never,
    self: () => "mch_self",
    steps: {} as never,
    callPolicy: () => policy,
    announce: (_tx, topic, data) => announced.push({ topic, data }),
    transport: {
      deliver: (_tx, to, input) => {
        delivered.push({ to: to.session, input });
        return ok(undefined);
      },
      cancel: (_tx, _to, _call, unattended) => {
        cancelled.push(unattended);
        return ok(undefined);
      },
    },
  });
  return {
    tx,
    router,
    rows,
    delivered,
    cancelled,
    announced,
    opened: () => opened,
    openedBy,
    openedAt,
  };
}

const base = {
  from: { kind: "agent", session: SENDER },
  reply: "result",
  body: textBlocks("do it"),
  refs: [],
  reply_to: null,
  kind: "call",
  delivery: "next_turn",
} as const;

test("a call to a closed session fails as closed and delivers no input to either side", () => {
  const { tx, router, delivered } = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, false),
  });
  const routed = router.route(tx, {
    ...base,
    to: { session: RECEIVER },
    dedup: "tool-1",
  });
  assert.ok(routed.ok);
  assert.deepStrictEqual(routed.value.state, "failed");
  assert.deepStrictEqual(routed.value.fail_reason, "closed");
  assert.deepStrictEqual(
    delivered.filter((one) => one.to === RECEIVER),
    [],
  );
  // 즉시 난 실패는 tool 결과로만 알린다. 같은 실패를 입력으로 또 받지 않는다.
  assert.deepStrictEqual(delivered, []);
});

test("a late reply to an ended call returns closed and sends nothing", () => {
  const { tx, router, rows, delivered } = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, true),
  });
  const routed = router.route(tx, {
    ...base,
    to: { session: RECEIVER },
    dedup: "tool-1",
  });
  assert.ok(routed.ok && routed.value.call !== null);
  rows.set(routed.value.call, {
    ...rows.get(routed.value.call)!,
    state: "cancelled",
  });
  delivered.length = 0;
  const late = router.reply(
    tx,
    { session: RECEIVER },
    {
      call: routed.value.call,
      body: textBlocks("done"),
      refs: [],
    },
  );
  assert.deepStrictEqual(late, ok({ delivered: false, closed: true }));
  assert.deepStrictEqual(delivered, []);
});

test("the same dedup makes one call and one session", () => {
  const { tx, router, rows, delivered, opened } = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, true),
  });
  const send = () =>
    router.route(tx, {
      ...base,
      to: { agent: "lophn" },
      dedup: "tool-1",
    });
  const first = send();
  const second = send();
  assert.ok(first.ok && second.ok);
  assert.deepStrictEqual(second.value.call, first.value.call);
  assert.deepStrictEqual(rows.size, 1);
  assert.deepStrictEqual(opened(), 1);
  assert.deepStrictEqual(delivered.length, 1);
});

// 권한 경계다. workflow가 보낸 step은 unattended 표시를 싣고 받는 session 하나에만, call 행 없이 닿는다.
test("step 입력은 unattended 표시를 싣고 받는 session 하나에만 닿으며 call 행을 만들지 않는다", () => {
  const step = { instance: "wfi_1" as never, step: "review" };
  for (const to of [{ session: RECEIVER }, { agent: "lophn" }] as const) {
    const { tx, router, rows, delivered } = setup({
      [SENDER]: target(SENDER, true),
      [RECEIVER]: target(RECEIVER, true),
    });
    const routed = router.route(tx, {
      from: { kind: "program" },
      to,
      reply: "none",
      body: textBlocks("do the step"),
      refs: [],
      reply_to: null,
      dedup: null,
      kind: "step",
      delivery: "next_turn",
      step,
      unattended: true,
    });
    assert.ok(routed.ok);
    assert.deepStrictEqual(delivered.length, 1);
    const sent = delivered[0]!;
    assert.deepStrictEqual(sent.to, RECEIVER);
    assert.deepStrictEqual(sent.input.unattended, true);
    assert.deepStrictEqual(sent.input.kind, "step");
    assert.deepStrictEqual(sent.input.step, step);
    assert.deepStrictEqual(sent.input.call, null);
    assert.deepStrictEqual(rows.size, 0);
  }
});

// 권한 경계다. unattended는 call 봉투를 따라 가고, attended 사슬로 새면 사람 없이 도는 turn이 묻는 길을 연다.
test("attended turn이 보낸 call은 attended로 열린다. unattended가 attended 사슬로 새지 않는다", () => {
  for (const mark of [false, true]) {
    const open = () => {
      const world = setup({
        [SENDER]: target(SENDER, true),
        [RECEIVER]: target(RECEIVER, true),
      });
      const routed = world.router.route(world.tx, {
        ...base,
        reply: "conversation",
        to: { session: RECEIVER },
        dedup: "tool-1",
        unattended: mark,
      });
      assert.ok(routed.ok && routed.value.call !== null);
      const call = routed.value.call;
      // 받는 쪽 입력과 행이 call의 표시를 싣는다.
      assert.deepStrictEqual(world.delivered.at(-1)!.to, RECEIVER);
      assert.deepStrictEqual(world.delivered.at(-1)!.input.unattended, mark);
      assert.deepStrictEqual(world.rows.get(call)!.unattended, mark);
      world.delivered.length = 0;
      return { ...world, call };
    };

    // 답은 call 행이 아니라 답한 turn의 표시를 따른다.
    for (const replyMark of [undefined, true]) {
      const { tx, router, delivered, call } = open();
      const sent = router.reply(
        tx,
        { session: RECEIVER },
        {
          call,
          body: textBlocks("done"),
          refs: [],
          unattended: replyMark,
        },
      );
      assert.ok(sent.ok && sent.value.delivered);
      assert.deepStrictEqual(delivered.at(-1)!.to, SENDER);
      assert.deepStrictEqual(
        delivered.at(-1)!.input.unattended,
        replyMark === true,
      );
    }

    // 받는 session이 끝나면 보낸 쪽에 가는 늦은 실패는 call의 표시를 따른다.
    {
      const { tx, router, delivered } = open();
      assert.ok(router.failReceivedBy(tx, RECEIVER).ok);
      assert.deepStrictEqual(delivered.at(-1)!.to, SENDER);
      assert.deepStrictEqual(
        delivered.at(-1)!.input.outcome?.reason,
        "receiver_ended",
      );
      assert.deepStrictEqual(delivered.at(-1)!.input.unattended, mark);
    }

    // 보낸 쪽의 취소 알림도 그렇다.
    {
      const { tx, router, cancelled, call } = open();
      const done = router.cancel(
        tx,
        { kind: "agent", session: SENDER },
        {
          call: call as never,
        },
      );
      assert.ok(done.ok);
      assert.deepStrictEqual(cancelled, [mark]);
    }
  }
});

test("a call the receiving agent cannot take is rejected and leaves no call row, no new session, no input", () => {
  const textOnly = () => ({
    name: "writer",
    input: ["text"] as const,
    replies: ["none", "result"] as const,
  });
  const { tx, router, rows, delivered, opened } = setup(
    { [SENDER]: target(SENDER, true), [RECEIVER]: target(RECEIVER, true) },
    textOnly,
  );
  const image = router.route(tx, {
    ...base,
    to: { agent: "writer" },
    body: [{ type: "image", mimeType: "image/png", blob: "0".repeat(64) }],
    dedup: "tool-1",
  } as never);
  assert.ok(!image.ok);
  assert.deepStrictEqual(image.error.code, "invalid_input");
  const conversation = router.route(tx, {
    ...base,
    to: { agent: "writer" },
    reply: "conversation",
    dedup: "tool-2",
  } as never);
  assert.ok(!conversation.ok);
  assert.deepStrictEqual(conversation.error.code, "invalid_input");
  assert.deepStrictEqual([...rows.keys()], []);
  assert.deepStrictEqual(delivered, []);
  // 새 session은 directory.open이 tx 안에서 연다. 거절은 err로 tx를 되돌려 그 session도 사라진다.
  assert.ok(opened() > 0);
  // 사람 메시지는 검사하지 않는다.
  const human = router.route(tx, {
    ...base,
    from: { kind: "human" },
    to: { agent: "writer" },
    body: [{ type: "image", mimeType: "image/png", blob: "0".repeat(64) }],
    dedup: null,
  } as never);
  assert.ok(human.ok);
});

// 권한 경계다. 정책이 거절한 agent call은 call 행도 session도 남기지 않는다. 사람이 보낸 call은 보지 않는다.
// 어느 call을 거절하는지(판정 순서)는 protocol의 mayCall test가 본다.
test("a call the policy refuses is forbidden and leaves no row or session; a human call is not checked", () => {
  const projectA = {
    kind: "project",
    id: "prj_00000000000000000000000001",
  } as const;
  const projectB = {
    kind: "project",
    id: "prj_00000000000000000000000002",
  } as const;
  const sessions = {
    [SENDER]: target(SENDER, true, {
      agent: lophnIdOf(projectA),
      workspace: projectA,
    }),
    [RECEIVER]: target(RECEIVER, true, {
      agent: lophnIdOf(projectB),
      workspace: projectB,
    }),
  };
  const input = {
    ...base,
    to: { agent: "lophn", workspace: { project: "b" } },
    dedup: "tool-1",
  } as const;

  const refused = setup(sessions, undefined, {
    ...DEFAULT_CALL_POLICY,
    private: [projectB],
  });
  const forbidden = refused.router.route(refused.tx, input);
  assert.ok(!forbidden.ok);
  assert.deepStrictEqual(forbidden.error.code, "forbidden");
  assert.deepStrictEqual(refused.rows.size, 0);
  assert.deepStrictEqual(refused.delivered, []);

  const human = refused.router.route(refused.tx, {
    ...input,
    from: { kind: "human" },
    dedup: null,
  });
  assert.ok(human.ok);
});

// 권한 경계다. Home의 lophn이 private workspace의 lophn에게 reply none으로 일을 넘기는 고정 예외 하나. 답이 오가는 reply는 막힌다.
test("home lophn hands work to a private app's lophn only with reply none", () => {
  const app = { kind: "app", id: "app_00000000000000000000000001" } as const;
  const sessions = {
    [SENDER]: target(SENDER, true, lophn),
    [RECEIVER]: target(RECEIVER, true, {
      agent: lophnIdOf(app),
      workspace: app,
    }),
  };
  const policy = { ...DEFAULT_CALL_POLICY, private: [app] };
  const input = { ...base, to: { agent: "lophn" }, dedup: "tool-1" } as const;

  const handoff = setup(sessions, undefined, policy);
  const sent = handoff.router.route(handoff.tx, { ...input, reply: "none" });
  assert.ok(sent.ok);
  assert.deepStrictEqual(handoff.delivered.length, 1);

  const asked = setup(sessions, undefined, policy);
  const refused = asked.router.route(asked.tx, { ...input, reply: "result" });
  assert.ok(!refused.ok);
  assert.deepStrictEqual(refused.error.code, "forbidden");
  assert.deepStrictEqual(asked.rows.size, 0);
});

// 주소 경계다. handle lophn에 workspace를 주면 그 workspace의 lophn에, 빼면 부른 쪽 workspace의 lophn에 session이 열린다.
test("a call to lophn opens the lophn of the named workspace, or of the caller's workspace when none is named", () => {
  const here = {
    kind: "project",
    id: "prj_00000000000000000000000001",
  } as const;
  const there = { kind: "app", id: "app_00000000000000000000000001" } as const;
  const sessions = {
    [SENDER]: target(SENDER, true, { agent: lophnIdOf(here), workspace: here }),
    [RECEIVER]: target(RECEIVER, true),
  };
  const unnamed = setup(sessions);
  assert.ok(
    unnamed.router.route(unnamed.tx, {
      ...base,
      to: { agent: "lophn" },
      dedup: "tool-1",
    }).ok,
  );
  assert.deepStrictEqual(unnamed.openedAt, [
    { agent: lophnIdOf(here), workspace: here },
  ]);
  // 이름 있는 workspace는 directory.resolveAddress가 푼 그대로 간다.
  const named = setup({
    ...sessions,
    [RECEIVER]: target(RECEIVER, true, {
      agent: lophnIdOf(there),
      workspace: there,
    }),
  });
  assert.ok(
    named.router.route(named.tx, {
      ...base,
      to: { agent: "lophn", workspace: { app: "calendar" } },
      dedup: "tool-1",
    }).ok,
  );
  assert.deepStrictEqual(named.openedAt, [
    { agent: lophnIdOf(there), workspace: there },
  ]);
});

// 팀 규칙 2. 부모 ses_p 밑에 SENDER와 형제 ses_b가 있고 ses_b 밑에 ses_c가 있다. ses_x는 팀 밖이다.
const team = () => ({
  ses_p: target("ses_p", true),
  [SENDER]: target(SENDER, true, lophn, "ses_p"),
  ses_b: target("ses_b", true, lophn, "ses_p"),
  ses_c: target("ses_c", true, lophn, "ses_b"),
  ses_x: target("ses_x", true),
});

test("a team member calls its parent, siblings and members under it but not a session outside the team", () => {
  const { tx, router } = setup(team());
  const call = (from: string, to: string) =>
    router.route(tx, {
      ...base,
      from: { kind: "agent", session: from },
      to: { session: to },
      dedup: `${from}-${to}`,
    });
  assert.ok(call(SENDER, "ses_p").ok);
  assert.ok(call(SENDER, "ses_b").ok);
  const outside = call(SENDER, "ses_x");
  assert.ok(!outside.ok && outside.error.code === "forbidden");
  // ses_b 밑의 ses_c는 한 칸 위(ses_b)까지만 닿는다. 부모는 아래 어디든 닿는다.
  const grandparent = call("ses_c", "ses_p");
  assert.ok(!grandparent.ok && grandparent.error.code === "forbidden");
  assert.ok(call("ses_c", "ses_b").ok);
  assert.ok(call("ses_p", "ses_c").ok);
  // 팀 밖 session은 제한이 없다.
  assert.ok(call("ses_x", "ses_c").ok);
});

test("a member opening a new session by agent name is refused as outside its team, and team spawn opens it as its child", () => {
  const sessions = { ...team(), [RECEIVER]: target(RECEIVER, true) };
  const refused = setup(sessions);
  const sent = refused.router.route(refused.tx, {
    ...base,
    to: { agent: "lophn" },
    dedup: "tool-1",
  });
  assert.ok(!sent.ok && sent.error.code === "forbidden");
  const spawned = setup({
    ...sessions,
    [RECEIVER]: target(RECEIVER, true, lophn, SENDER),
  });
  const routed = spawned.router.route(spawned.tx, {
    ...base,
    to: { agent: "lophn" },
    dedup: "tool-2",
    spawn: true,
  });
  assert.ok(routed.ok);
  assert.deepStrictEqual(spawned.openedBy, [SENDER]);
  // team spawn의 탭은 command가 relation과 같이 요청하므로 Router는 따로 알리지 않는다(탭이 둘 열리지 않게).
  assert.deepStrictEqual(spawned.announced, []);
});

test("call.send to an agent name opens a session that belongs to no team", () => {
  const { tx, router, openedBy } = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, true),
  });
  const routed = router.route(tx, {
    ...base,
    to: { agent: "lophn" },
    dedup: "tool-1",
  });
  assert.ok(routed.ok);
  assert.deepStrictEqual(openedBy, [null]);
});

test("a call that opens a new session asks for its tab once, and a call to an open session does not", () => {
  const world = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, true),
  });
  const opened = world.router.route(world.tx, {
    ...base,
    to: { agent: "lophn" },
    dedup: "tool-1",
  });
  assert.ok(opened.ok);
  assert.deepStrictEqual(world.announced, [
    {
      topic: CALL_SESSION_OPENED_TOPIC,
      data: { caller: SENDER, session: RECEIVER },
    },
  ]);
  // 같은 dedup의 다시 보내기와 열린 session으로 보내기는 새 session이 아니다.
  world.router.route(world.tx, {
    ...base,
    to: { agent: "lophn" },
    dedup: "tool-1",
  });
  world.router.route(world.tx, {
    ...base,
    to: { session: RECEIVER },
    dedup: "tool-2",
  });
  assert.strictEqual(world.announced.length, 1);
});

// 팀 자식(SENDER)이 부모 ses_p에게 질문·승인 call을 연다.
function askCall(kind: "question" | "approval") {
  const world = setup(team());
  const opened = world.router.route(world.tx, {
    ...base,
    to: { session: "ses_p" },
    dedup: null,
    ask: kind,
  });
  assert.ok(opened.ok && opened.value.call !== null);
  world.delivered.length = 0;
  return { ...world, call: opened.value.call };
}

const parentReply = (
  world: ReturnType<typeof askCall>,
  decision?: "allow" | "reject",
  text = "ok",
) =>
  world.router.reply(
    world.tx,
    { session: "ses_p" as never },
    {
      call: world.call as never,
      body: textBlocks(text),
      refs: [],
      ...(decision === undefined ? {} : { decision }),
    },
  );

test("a parent's answer to an ask call closes it and goes to the pairing, never to the child's queue", () => {
  const approval = askCall("approval");
  const answered = parentReply(approval, "allow", "go ahead");
  assert.ok(answered.ok);
  assert.deepStrictEqual(answered.value, { delivered: false, closed: false });
  assert.deepStrictEqual(approval.delivered, []);
  assert.strictEqual(approval.rows.get(approval.call)!.state, "done");
  assert.deepStrictEqual(approval.announced, [
    {
      topic: ASK_ANSWERED_TOPIC,
      data: { call: approval.call, decision: "allow", text: "go ahead" },
    },
  ]);
  // 늦은 답은 closed다.
  const late = parentReply(approval, "reject");
  assert.ok(late.ok && late.value.closed);
  assert.strictEqual(approval.announced.length, 1);
});

test("an approval call needs a decision, no other call takes one, and always does not exist", () => {
  const approval = askCall("approval");
  const missing = parentReply(approval);
  assert.ok(!missing.ok && missing.error.code === "invalid_input");
  const question = askCall("question");
  const extra = parentReply(question, "allow");
  assert.ok(!extra.ok && extra.error.code === "invalid_input");
  assert.deepStrictEqual(question.announced, []);
  // 보통 call에도 결정을 주지 못한다.
  const plain = setup(team());
  const sent = plain.router.route(plain.tx, {
    ...base,
    to: { session: "ses_p" },
    dedup: "tool-1",
  });
  assert.ok(sent.ok && sent.value.call !== null);
  const decided = plain.router.reply(
    plain.tx,
    { session: "ses_p" as never },
    {
      call: sent.value.call as never,
      body: textBlocks("x"),
      refs: [],
      decision: "allow",
    },
  );
  assert.ok(!decided.ok && decided.error.code === "invalid_input");
  // 부모가 shell 규칙을 더하는 길은 schema에 없다.
  assert.ok(
    !callReply.input.safeParse({
      call: "cal_01h455vb4pex5v6nkc6gd5fd01",
      body: textBlocks("x"),
      decision: "always",
    }).success,
  );
});

test("when the parent ends, an ask call fails without telling the child's queue and the pairing is told", () => {
  const world = askCall("approval");
  const done = world.router.failReceivedBy(world.tx, "ses_p");
  assert.ok(done.ok);
  assert.strictEqual(world.rows.get(world.call)!.state, "failed");
  assert.deepStrictEqual(world.delivered, []);
  assert.deepStrictEqual(world.announced, [
    { topic: ASK_ENDED_TOPIC, data: { call: world.call } },
  ]);
});

test("a custom or harness parent's automatic reply to an approval ask call closes it as a reject", () => {
  const world = askCall("approval");
  const done = world.router.reply(
    world.tx,
    { session: "ses_p" as never },
    {
      call: world.call as never,
      body: textBlocks("I looked at it"),
      refs: [],
      auto: true,
    },
  );
  assert.ok(done.ok);
  assert.strictEqual(world.rows.get(world.call)!.state, "done");
  assert.deepStrictEqual(world.announced, [
    {
      topic: ASK_ANSWERED_TOPIC,
      data: {
        call: world.call,
        decision: "reject",
        text: "I looked at it",
      },
    },
  ]);
});

// 앱이 보낸 call. 정책이 떼어 놓은 workspace로는 가지 않고, 받는 쪽의 답은 call 행에 글로 남아 그 앱에만 알려지고, 남의 call은 취소하지 못한다.
test("an app call obeys the workspace policy, its reply is stored on the row and settles for that app only", () => {
  const appWorkspace = { kind: "app", id: "app_notes" } as const;
  const away = target(RECEIVER, true, {
    agent: lophnIdOf(null),
    workspace: { kind: "project", id: "prj_other" },
  });
  const apart: CallPolicy = {
    ...DEFAULT_CALL_POLICY,
    workspaces: [
      {
        from: appWorkspace,
        to: { kind: "project", id: "prj_other" },
        allow: false,
      },
    ],
  };
  const refused = setup({ [RECEIVER]: away }, () => null, apart);
  const from = refused.router.appSender("app_notes");
  assert.ok(from.ok);
  const sent = refused.router.route(refused.tx, {
    ...base,
    from: from.value,
    to: { session: RECEIVER },
    dedup: null,
  });
  assert.ok(!sent.ok && sent.error.code === "forbidden");
  assert.equal(refused.rows.size, 0);
  assert.deepStrictEqual(refused.delivered, []);

  const open = setup({ [RECEIVER]: target(RECEIVER, true) });
  const sender = open.router.appSender("app_notes");
  assert.ok(sender.ok);
  const routed = open.router.route(open.tx, {
    ...base,
    from: sender.value,
    to: { session: RECEIVER },
    dedup: null,
  });
  assert.ok(routed.ok && routed.value.call !== null);
  const call = routed.value.call as Parameters<
    typeof open.router.reply
  >[2]["call"];
  assert.deepStrictEqual(open.rows.get(call)!.from, sender.value);
  const answered = open.router.reply(
    open.tx,
    { session: RECEIVER },
    { call, body: textBlocks("done"), refs: [] },
  );
  assert.deepStrictEqual(answered, ok({ delivered: true, closed: false }));
  assert.equal(open.rows.get(call)!.state, "done");
  assert.equal(open.rows.get(call)!.result, "done");
  assert.deepStrictEqual(open.announced, [
    {
      topic: APP_CALL_SETTLED_TOPIC,
      data: { app: "app_notes", call, state: "done", fail_reason: null },
    },
  ]);
  // 답은 받는 session 말고 어느 queue로도 가지 않는다(앱에는 queue가 없다).
  assert.equal(
    open.delivered.filter((one) => one.input.kind === "reply").length,
    0,
  );

  const other = open.router.appSender("app_other");
  assert.ok(other.ok);
  const second = open.router.route(open.tx, {
    ...base,
    from: sender.value,
    to: { session: RECEIVER },
    dedup: null,
  });
  assert.ok(second.ok && second.value.call !== null);
  const stolen = open.router.cancel(open.tx, other.value, {
    call: second.value.call as typeof call,
  });
  assert.ok(!stolen.ok && stolen.error.code === "forbidden");
});
