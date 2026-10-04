import { assertEquals } from "@std/assert";
import { defineBlueprint } from "./define.ts";
import { automation, blueprint, command } from "./fixture.ts";
import { sameVerdict } from "./judge.ts";
import { type InputSchema, validateBlueprint } from "./mod.ts";

function expectOk(value: unknown, expectedOk: boolean, message?: string) {
  assertEquals(validateBlueprint(value).ok, expectedOk);
  sameVerdict(
    value,
    expectedOk,
    undefined,
    message === undefined ? undefined : { message },
  );
}

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
  expectOk(withLookup(automation()), true);
  expectOk(withLookup(automation({ when: { kind: "on_start" } })), true);
  expectOk(withLookup(automation(), "write"), true);
  expectOk(
    withLookup(automation({
      when: { kind: "interval", interval_ms: 59999 },
    })),
    false,
    "interval_ms must be at least 60000",
  );
  expectOk(
    withLookup(automation({ command: "missing" })),
    false,
    "automation command does not exist",
  );

  const confirming = withLookup(automation());
  confirming.commands[2] = { ...confirming.commands[2]!, confirm: true };
  expectOk(confirming, false, "automation command cannot require confirm");

  const fixed = withLookup(automation({ input: { day: "2026-10-04" } }));
  fixed.commands[2] = { ...fixed.commands[2]!, input: day };
  expectOk(fixed, true);
  const defined = defineBlueprint(fixed);
  assertEquals(defined.automatic_tasks[0]?.input, { day: "2026-10-04" });
  assertEquals(defined.automatic_tasks[0]?.when, {
    kind: "interval",
    interval_ms: 60000,
  });

  const badInput = withLookup(automation({ input: { day: "today" } }));
  badInput.commands[2] = { ...badInput.commands[2]!, input: day };
  expectOk(badInput, false, "input.day is shorter than minLength");
  expectOk(withLookup(automation(), "external"), true);
});

Deno.test("apps/blueprint#R14: on_start는 다른 필드를 받지 않고 input 없는 command는 input을 거절한다", () => {
  expectOk(
    withLookup(automation({
      when: { kind: "on_start", interval_ms: 60000 } as {
        kind: "on_start";
      },
    })),
    false,
    "on_start accepts no other field",
  );
  expectOk(
    withLookup(automation({ input: {} })),
    false,
    "command accepts no input",
  );
});
