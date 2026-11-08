import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { AgentCallRow } from "../../protocol/lophn-agent/calls.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import type { AgentAtWorkspace } from "../../protocol/lophn-agent/workspaces.ts";
import type { Tx } from "../../protocol/server/mod.ts";
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
const lophn = { agent: "lophn", workspace: null } as const;

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
  let opened = 0;
  const openedBy: (string | null)[] = [];
  const store: CallStore = {
    insert: (_tx, record) => {
      rows.set(record.call, record);
      return ok(undefined);
    },
    byDedup: (_tx, sender, dedup) =>
      [...rows.values()].find(
        (row) =>
          row.from.kind === "agent" &&
          row.from.session === sender &&
          row.dedup === dedup,
      ) ?? null,
    read: (_tx, call) => rows.get(call) ?? null,
    move: (_tx, call, to, reason) => {
      const row = rows.get(call)!;
      const moved = { ...row, state: to, fail_reason: reason };
      rows.set(call, moved);
      return ok(moved);
    },
    markConsumed: () => ok(undefined),
    lost: () => [],
    openReceivedBy: (_tx, session) =>
      [...rows.values()].filter(
        (row) => row.state === "accepted" && row.receiver_session === session,
      ),
  };
  const directory: SessionDirectory = {
    find: (session) => sessions[session] ?? null,
    resolveAddress: () => ok(sessions[RECEIVER]?.agent ?? lophn),
    open: (_tx, _agent, _opener, spawnedBy) => {
      opened += 1;
      openedBy.push(spawnedBy);
      return ok(sessions[RECEIVER]!);
    },
    accepts,
    listOpen: () => [],
  };
  const router = createRouter({
    directory,
    store,
    callPolicy: () => policy,
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
    opened: () => opened,
    openedBy,
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
  const projectA = { kind: "project", id: "prj_a" } as const;
  const projectB = { kind: "project", id: "prj_b" } as const;
  const sessions = {
    [SENDER]: target(SENDER, true, { agent: "lophn", workspace: projectA }),
    [RECEIVER]: target(RECEIVER, true, { agent: "lophn", workspace: projectB }),
  };
  const input = { ...base, to: { agent: "lophn" }, dedup: "tool-1" } as const;

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

// 권한 경계다. home의 기본 lophn이 private workspace의 lophn에게 reply none으로 일을 넘기는 고정 예외 하나. 답이 오가는 reply는 막힌다.
test("home lophn hands work to a private app's lophn only with reply none", () => {
  const app = { kind: "app", id: "app_private" } as const;
  const sessions = {
    [SENDER]: target(SENDER, true, { agent: "lophn", workspace: null }),
    [RECEIVER]: target(RECEIVER, true, { agent: "lophn", workspace: app }),
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
