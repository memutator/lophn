import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import type { AgentCallRecord } from "../../protocol/lophn-agent/calls.ts";
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
const lophn = { role: "lophn" } as const;

function target(session: string, accepting: boolean): TargetSession {
  return {
    session: session as TargetSession["session"],
    transport: "lophn",
    agent: lophn,
    accepting,
  };
}

function setup(sessions: Record<string, TargetSession>) {
  let counter = 0;
  const tx = {
    now: () => "2026-10-16T00:00:00.000Z",
    newId: (prefix: string) => `${prefix}_${++counter}`,
  } as unknown as Tx;
  const rows = new Map<string, AgentCallRecord>();
  const delivered: { to: string; input: RoutedInput }[] = [];
  const cancelled: boolean[] = [];
  let opened = 0;
  const store: CallStore = {
    insert: (_tx, record) => {
      rows.set(record.call, record);
      return ok(undefined);
    },
    byDedup: (_tx, sender, dedup) =>
      [...rows.values()].find((row) =>
        row.from.kind === "agent" && row.from.session === sender &&
        row.dedup === dedup
      ) ?? null,
    read: (_tx, call) => rows.get(call) ?? null,
    move: (_tx, call, to, reason) => {
      const row = rows.get(call)!;
      const moved = { ...row, state: to, fail_reason: reason };
      rows.set(call, moved);
      return ok(moved);
    },
    markConsumed: () => ok(undefined),
    setReceiver: () => ok(undefined),
    lost: () => [],
    openReceivedBy: (_tx, session) =>
      [...rows.values()].filter((row) =>
        row.state === "accepted" && row.receiver_session === session
      ),
  };
  const directory: SessionDirectory = {
    find: (session) => sessions[session] ?? null,
    resolveAgent: () => ok(lophn),
    openOf: () => null,
    open: () => {
      opened += 1;
      return ok(sessions[RECEIVER]!);
    },
    listOpen: () => [],
  };
  const router = createRouter({
    directory,
    store,
    transport: {
      deliver: (_tx, to, input) => {
        delivered.push({ to: to.session, input });
        return ok("delivered" as const);
      },
      cancel: (_tx, _to, _call, unattended) => {
        cancelled.push(unattended);
        return ok(undefined);
      },
      queued: () => [],
    },
  });
  return { tx, router, rows, delivered, cancelled, opened: () => opened };
}

const base = {
  from: { kind: "agent", session: SENDER },
  reply: "result",
  body: "do it",
  refs: [],
  reply_to: null,
  options: null,
  kind: "call",
  delivery: "next_turn",
} as const;

Deno.test("a call to a closed session fails as closed and delivers no input to either side", () => {
  const { tx, router, delivered } = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, false),
  });
  const routed = router.route(tx, {
    ...base,
    to: { session: RECEIVER },
    dedup: "tool-1",
  });
  assert(routed.ok);
  assertEquals(routed.value.state, "failed");
  assertEquals(routed.value.fail_reason, "closed");
  assertEquals(delivered.filter((one) => one.to === RECEIVER), []);
  // 즉시 난 실패는 tool 결과로만 알린다. 같은 실패를 입력으로 또 받지 않는다.
  assertEquals(delivered, []);
});

Deno.test("a late reply to an ended call returns closed and sends nothing", () => {
  const { tx, router, rows, delivered } = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, true),
  });
  const routed = router.route(tx, {
    ...base,
    to: { session: RECEIVER },
    dedup: "tool-1",
  });
  assert(routed.ok && routed.value.call !== null);
  rows.set(routed.value.call, {
    ...rows.get(routed.value.call)!,
    state: "cancelled",
  });
  delivered.length = 0;
  const late = router.reply(tx, { session: RECEIVER }, {
    call: routed.value.call,
    body: "done",
    refs: [],
  });
  assertEquals(late, ok({ delivered: false, closed: true }));
  assertEquals(delivered, []);
});

Deno.test("the same dedup makes one call and one session", () => {
  const { tx, router, rows, delivered, opened } = setup({
    [SENDER]: target(SENDER, true),
    [RECEIVER]: target(RECEIVER, true),
  });
  const send = () =>
    router.route(tx, {
      ...base,
      to: { role: "lophn" },
      dedup: "tool-1",
    });
  const first = send();
  const second = send();
  assert(first.ok && second.ok);
  assertEquals(second.value.call, first.value.call);
  assertEquals(rows.size, 1);
  assertEquals(opened(), 1);
  assertEquals(delivered.length, 1);
});

// 권한 경계다. workflow가 보낸 step은 unattended 표시를 싣고 받는 session 하나에만, call 행 없이 닿는다.
Deno.test("step 입력은 unattended 표시를 싣고 받는 session 하나에만 닿으며 call 행을 만들지 않는다", () => {
  const step = { instance: "wfi_1" as never, step: "review" };
  for (const to of [{ session: RECEIVER }, { role: "lophn" }] as const) {
    const { tx, router, rows, delivered } = setup({
      [SENDER]: target(SENDER, true),
      [RECEIVER]: target(RECEIVER, true),
    });
    const routed = router.route(tx, {
      from: { kind: "program" },
      to,
      reply: "none",
      body: "do the step",
      refs: [],
      reply_to: null,
      dedup: null,
      options: null,
      kind: "step",
      delivery: "next_turn",
      step,
      unattended: true,
    });
    assert(routed.ok);
    assertEquals(delivered.length, 1);
    const sent = delivered[0]!;
    assertEquals(sent.to, RECEIVER);
    assertEquals(sent.input.unattended, true);
    assertEquals(sent.input.kind, "step");
    assertEquals(sent.input.step, step);
    assertEquals(sent.input.call, null);
    assertEquals(rows.size, 0);
  }
});

// 권한 경계다. unattended는 call 봉투를 따라 가고, attended 사슬로 새면 사람 없이 도는 turn이 묻는 길을 연다.
Deno.test("attended turn이 보낸 call은 attended로 열린다. unattended가 attended 사슬로 새지 않는다", () => {
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
      assert(routed.ok && routed.value.call !== null);
      const call = routed.value.call;
      // 받는 쪽 입력과 행이 call의 표시를 싣는다.
      assertEquals(world.delivered.at(-1)!.to, RECEIVER);
      assertEquals(world.delivered.at(-1)!.input.unattended, mark);
      assertEquals(world.rows.get(call)!.unattended, mark);
      world.delivered.length = 0;
      return { ...world, call };
    };

    // 답은 call 행이 아니라 답한 turn의 표시를 따른다.
    for (const replyMark of [undefined, true]) {
      const { tx, router, delivered, call } = open();
      const sent = router.reply(tx, { session: RECEIVER }, {
        call,
        body: "done",
        refs: [],
        unattended: replyMark,
      });
      assert(sent.ok && sent.value.delivered);
      assertEquals(delivered.at(-1)!.to, SENDER);
      assertEquals(delivered.at(-1)!.input.unattended, replyMark === true);
    }

    // 받는 session이 끝나면 보낸 쪽에 가는 늦은 실패는 call의 표시를 따른다.
    {
      const { tx, router, delivered } = open();
      assert(router.failReceivedBy(tx, RECEIVER).ok);
      assertEquals(delivered.at(-1)!.to, SENDER);
      assertEquals(delivered.at(-1)!.input.outcome?.reason, "receiver_ended");
      assertEquals(delivered.at(-1)!.input.unattended, mark);
    }

    // 보낸 쪽의 취소 알림도 그렇다.
    {
      const { tx, router, cancelled, call } = open();
      const done = router.cancel(tx, { kind: "agent", session: SENDER }, {
        call: call as never,
      });
      assert(done.ok);
      assertEquals(cancelled, [mark]);
    }
  }
});
