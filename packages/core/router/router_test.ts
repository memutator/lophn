import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { AgentCallRow } from "../../protocol/lophn-agent/calls.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import type { AgentAtPlace } from "../../protocol/lophn-agent/places.ts";
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
const lophn = { agent: "lophn", place: null } as const;

function target(
  session: string,
  accepting: boolean,
  agent: AgentAtPlace = lophn,
): TargetSession {
  return {
    session: session as TargetSession["session"],
    transport: "lophn",
    agent,
    accepting,
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
    open: () => {
      opened += 1;
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
  return { tx, router, rows, delivered, cancelled, opened: () => opened };
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

// 권한 경계다. project A의 agent가 project B로 보내는 call은 기본으로 거절되고 call 행도 session도 남지 않는다.
// agent 예외가 허용하면 간다. 사람이 보낸 call은 보지 않는다.
test("a call from project A to project B is forbidden by default and leaves no row or session; an agent exception allows it", () => {
  const projectA = { kind: "project", id: "prj_a" } as const;
  const projectB = { kind: "project", id: "prj_b" } as const;
  const sessions = {
    [SENDER]: target(SENDER, true, { agent: "lophn", place: projectA }),
    [RECEIVER]: target(RECEIVER, true, { agent: "lophn", place: projectB }),
  };
  const input = { ...base, to: { agent: "lophn" }, dedup: "tool-1" } as const;

  const refused = setup(sessions);
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

  const allowed = setup(sessions, undefined, {
    places: [],
    agents: [{ from: "lophn", to: "lophn", allow: true }],
  });
  const sent = allowed.router.route(allowed.tx, input);
  assert.ok(sent.ok);
  assert.deepStrictEqual(allowed.rows.size, 1);
});
