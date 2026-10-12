import { assertEquals } from "@std/assert";
import {
  type AppWriteCall,
  classifyAppWrites,
  readAppWrites,
} from "./app-revert.ts";
import { APP, INV, openWorld, REL, TCL } from "./testing/mod.ts";

// 앱 write 분류(agent-RW3c). classifyAppWrites는 순수 함수이고 readAppWrites는 tool_calls stub 표를 읽는다.

function write(
  n: number,
  over: { app?: number; revert?: string | null; receipt?: boolean } = {},
): AppWriteCall {
  return {
    tool_call: TCL(n),
    seq: String(100 + n),
    command: {
      app: APP(over.app ?? 1),
      release: REL(1),
      command: "ticket.update",
      revert_command: over.revert === undefined ? "ticket.revert" : over.revert,
    },
    receipt: over.receipt === false ? null : {
      invocation: INV(n),
      receipt: `receipt-${n}`,
      expected_revision: String(n),
    },
  };
}

const same = (app: number, revision: string) =>
  new Map([[APP(app), revision]]) as ReadonlyMap<string, string | null>;

Deno.test("lophn-agent/revert#R10 [agent-RW3c]: a supported write with a receipt becomes a restore step carrying its binding", () => {
  const [item] = classifyAppWrites({
    revert: "rvt_x",
    calls: [write(1)],
    revisions: same(1, "1"),
  });
  assertEquals(item, {
    ordinal: 0,
    class: "app",
    target: TCL(1),
    source: [TCL(1)],
    plan: "restore",
    reason: null,
    app_revert: {
      app: APP(1),
      release: REL(1),
      command: "ticket.update",
      tool_call: TCL(1),
      invocation: INV(1),
      receipt: "receipt-1",
      expected_revision: "1",
      revert_command: "ticket.revert",
      step_key: `rvt_x:${INV(1)}`,
      revert_invocation: null,
    },
  });
  // preview에는 아직 revert id가 없다.
  const preview = classifyAppWrites({
    revert: null,
    calls: [write(1)],
    revisions: same(1, "1"),
  });
  assertEquals(preview[0]!.app_revert!.step_key, `preview:${INV(1)}`);
});

Deno.test("lophn-agent/revert#R10 [agent-RW3c]: steps run in the reverse of the original call order", () => {
  const items = classifyAppWrites({
    revert: "rvt_x",
    calls: [write(1), write(2), write(3)],
    revisions: same(1, "3"),
  });
  assertEquals(items.map((item) => [item.ordinal, item.target]), [
    [0, TCL(3)],
    [1, TCL(2)],
    [2, TCL(1)],
  ]);
});

Deno.test("lophn-agent/revert#R18 [agent-RW3c]: a write without a declared revert command or without a receipt remains, with its reason", () => {
  const items = classifyAppWrites({
    revert: "rvt_x",
    calls: [
      write(1, { revert: null }),
      write(2, { receipt: false }),
      write(3),
    ],
    revisions: same(1, "3"),
  });
  assertEquals(
    items.map((item) => [item.target, item.plan, item.reason]),
    [
      [TCL(3), "restore", null],
      [TCL(2), "remain", "no_receipt"],
      [TCL(1), "remain", "no_revert_command"],
    ],
  );
  assertEquals(items[1]!.app_revert, null);
  assertEquals(items[2]!.app_revert, null);
});

Deno.test("lophn-agent/revert#R4 [agent-RW3c]: a changed app revision skips that step and the same app's earlier steps, not another app's", () => {
  const items = classifyAppWrites({
    revert: "rvt_x",
    calls: [write(1), write(2), write(3, { app: 2 }), write(4)],
    // 앱 1의 가장 나중 write(4)의 receipt 기준은 "4"인데 지금 revision은 "9"다.
    revisions: new Map([[APP(1), "9"], [APP(2), "3"]]),
  });
  assertEquals(
    items.map((item) => [item.target, item.plan, item.reason]),
    [
      [TCL(4), "skip", "app_revision_changed"],
      [TCL(3), "restore", null],
      [TCL(2), "skip", "app_revision_changed"],
      [TCL(1), "skip", "app_revision_changed"],
    ],
  );
  // 근거는 남긴다.
  assertEquals(items[0]!.app_revert!.expected_revision, "4");
});

Deno.test("lophn-agent/revert#R9 [agent-RW3c]: an app whose revision cannot be read is not assumed safe", () => {
  const items = classifyAppWrites({
    revert: "rvt_x",
    calls: [write(1)],
    revisions: new Map([[APP(1), null]]),
  });
  assertEquals(items[0]!.plan, "skip");
  assertEquals(items[0]!.reason, "app_revision_changed");
  const absent = classifyAppWrites({
    revert: "rvt_x",
    calls: [write(1)],
    revisions: new Map(),
  });
  assertEquals(absent[0]!.reason, "app_revision_changed");
});

const content = (n: number) =>
  JSON.stringify({
    revert: {
      invocation: INV(n),
      receipt: `receipt-${n}`,
      expected_revision: String(n),
    },
  });

Deno.test("lophn-agent/revert#R9 [agent-RW3c]: readAppWrites reads only successful app writes after the checkpoint, in call order", () => {
  const world = openWorld();
  world.addSession();
  const first = world.addRequest(1);
  world.addToolCall(1, first.run, {
    app_command: {
      app: APP(1),
      release: REL(1),
      command: "ticket.update",
      revert_command: "ticket.revert",
    },
    result: { content: content(1) },
  });
  const second = world.addRequest(2);
  const app = {
    app: APP(1),
    release: REL(1),
    command: "ticket.update",
    revert_command: "ticket.revert",
  };
  world.addToolCall(2, second.run, {
    app_command: app,
    result: { content: content(2) },
  });
  // 읽기·실패·거절·앱 command가 아닌 쓰기는 들지 않는다.
  world.addToolCall(3, second.run, {
    effect: "read",
    app_command: app,
    result: { content: content(3) },
  });
  world.addToolCall(4, second.run, {
    app_command: app,
    outcome: "failed",
    result: null,
  });
  world.addToolCall(5, second.run, { app_command: null });
  // 선언이 없는 앱 write와 영수증이 없는 앱 write는 들되 근거가 없다.
  world.addToolCall(6, second.run, {
    app_command: { ...app, revert_command: undefined },
    result: { content: content(6) },
  });
  world.addToolCall(7, second.run, {
    app_command: app,
    result: { content: JSON.stringify({}) },
  });
  const found = readAppWrites(world.lookup, {
    session: world.query("select id from sessions")[0]!["id"] as string,
    after_seq: second.seq,
  });
  assertEquals(found.map((call) => call.tool_call), [TCL(2), TCL(6), TCL(7)]);
  assertEquals(found[0], {
    tool_call: TCL(2),
    seq: found[0]!.seq,
    command: {
      app: APP(1),
      release: REL(1),
      command: "ticket.update",
      revert_command: "ticket.revert",
    },
    receipt: {
      invocation: INV(2),
      receipt: "receipt-2",
      expected_revision: "2",
    },
  });
  assertEquals(found[1]!.command.revert_command, null);
  assertEquals(found[2]!.receipt, null);
});
