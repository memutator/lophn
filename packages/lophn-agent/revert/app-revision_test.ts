import { assertEquals } from "@std/assert";
import { latestAppRevision } from "./app-revert.ts";
import { APP, INV, openWorld, REL } from "./testing/mod.ts";

// 앱의 지금 revision으로 platform이 알 수 있는 값(lophn-agent/revert R9): ledger에 남은 가장 최근 성공
// write의 영수증이다. 영수증이 없으면 알 수 없다.

const call = (app: number, n: number) => ({
  app_command: {
    app: APP(app),
    release: REL(app),
    command: "ticket.update",
    revert_command: "ticket.revert",
  },
  result: {
    content: {
      revert: {
        invocation: INV(n),
        receipt: `receipt-${n}`,
        expected_revision: String(n),
      },
    },
  },
});

Deno.test("lophn-agent/revert#R9: the latest successful write's receipt is the app's revision, per app, across sessions", () => {
  const world = openWorld();
  world.addSession();
  const { run } = world.addRequest(1);
  world.addToolCall(1, run, call(1, 1));
  world.addToolCall(2, run, call(2, 2));
  world.addToolCall(3, run, call(1, 3));
  assertEquals(latestAppRevision(APP(1), world.lookup), "3");
  assertEquals(latestAppRevision(APP(2), world.lookup), "2");
  assertEquals(latestAppRevision(APP(3), world.lookup), null);
});

Deno.test("lophn-agent/revert#R9: a failed write or a write without a receipt does not set the revision", () => {
  const world = openWorld();
  world.addSession();
  const { run } = world.addRequest(1);
  world.addToolCall(1, run, call(1, 1));
  world.addToolCall(2, run, { ...call(1, 2), outcome: "failed" });
  world.addToolCall(3, run, {
    app_command: call(1, 3).app_command,
    result: { content: {} },
  });
  assertEquals(latestAppRevision(APP(1), world.lookup), "1");
});
