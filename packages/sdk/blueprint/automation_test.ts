import { assertEquals } from "@std/assert";
import { defineBlueprint } from "./define.ts";
import { automation, blueprint, command } from "./fixture.ts";
import { sameVerdict } from "./judge.ts";
import type { InputSchema } from "./mod.ts";

const day: InputSchema = {
  type: "object",
  properties: { day: { type: "string", minLength: 10, maxLength: 10 } },
  required: ["day"],
  additionalProperties: false,
};

function withLookup(
  task: ReturnType<typeof automation>,
  effect: "read" | "write" | "external" = "read",
) {
  return blueprint({
    commands: [
      ...blueprint().commands,
      command(
        "lookup",
        effect,
        effect === "write"
          ? { revert: { supported: false }, confirm: false }
          : { confirm: false },
      ),
    ],
    automatic_tasks: [task],
  });
}

Deno.test("apps/blueprint#R14: automation은 interval 60000 이상, on_start, 있는 command, confirm=false, 고정 input만 받는다", () => {
  sameVerdict(withLookup(automation()), true);
  sameVerdict(withLookup(automation({ when: { kind: "on_start" } })), true);
  sameVerdict(withLookup(automation(), "write"), true);
  sameVerdict(
    withLookup(automation({
      when: { kind: "interval", interval_ms: 59999 },
    })),
    false,
  );
  sameVerdict(withLookup(automation({ command: "missing" })), false);

  const confirming = withLookup(automation());
  confirming.commands[2] = { ...confirming.commands[2]!, confirm: true };
  sameVerdict(confirming, false);

  const fixed = withLookup(automation({ input: { day: "2026-10-04" } }));
  fixed.commands[2] = { ...fixed.commands[2]!, input: day };
  sameVerdict(fixed, true);
  const defined = defineBlueprint(fixed);
  assertEquals(defined.automatic_tasks[0]?.input, { day: "2026-10-04" });
  assertEquals(defined.automatic_tasks[0]?.when, {
    kind: "interval",
    interval_ms: 60000,
  });

  const badInput = withLookup(automation({ input: { day: "today" } }));
  badInput.commands[2] = { ...badInput.commands[2]!, input: day };
  sameVerdict(badInput, false);
  sameVerdict(withLookup(automation(), "external"), true);
});

Deno.test("apps/blueprint#R14: on_start는 다른 필드를 받지 않고 input 없는 command는 input을 거절한다", () => {
  sameVerdict(
    withLookup(automation({
      when: { kind: "on_start", interval_ms: 60000 } as {
        kind: "on_start";
      },
    })),
    false,
  );
  sameVerdict(withLookup(automation({ input: {} })), false);
});
