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
    lost: () => [],
    openReceivedBy: () => [],
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
    gate: { authorize: () => ok(undefined), visible: () => true },
    transport: {
      deliver: (_tx, to, input) => {
        delivered.push({ to: to.session, input });
        return ok("delivered" as const);
      },
      cancel: () => ok(undefined),
      queued: () => [],
    },
  });
  return { tx, router, rows, delivered, opened: () => opened };
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

Deno.test("a call to a closed session fails as closed and delivers nothing to it", () => {
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
  // 실패는 이유를 붙여 보낸 session에 돌아간다.
  assertEquals(delivered.map((one) => one.to), [SENDER]);
  assertEquals(delivered[0]!.input.outcome, {
    state: "failed",
    reason: "closed",
  });
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
