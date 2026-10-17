import { assertEquals } from "@std/assert";
import { hookSignalOf } from "./hook-signal.ts";

// OpenCode는 turn 끝을 `session.status`(idle) 하나로만 낸다. `session.idle`까지 신호로 받으면 TurnEnded가 두 번 간다.
Deno.test("OpenCode의 turn 끝 신호는 session.status의 idle 하나다", () => {
  const status = (type: string) => ({ properties: { status: { type } } });
  assertEquals(
    hookSignalOf("opencode", "session.idle", { properties: {} }),
    null,
  );
  assertEquals(hookSignalOf("opencode", "session.status", status("idle")), {
    type: "TurnEnded",
    outcome: "completed",
  });
  assertEquals(hookSignalOf("opencode", "session.status", status("busy")), {
    type: "TurnStarted",
  });
});
