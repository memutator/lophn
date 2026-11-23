import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../../protocol/base/ids.ts";
import { flowStartMessageSchema } from "../../../protocol/workflows/flow-wire.ts";
import { flowCommand, startMessage } from "./host.ts";

// Node로 옮기며 한 번 없어졌던 한도다. 없으면 AI가 짠 flow가 기계 memory를 다 잡는다.
test("a flow process starts with a V8 heap limit before its entry", () => {
  const command = flowCommand("/data/sdk/entry.ts", "/data/wf/flow.ts");
  assert.deepStrictEqual(command.args, [
    "--max-old-space-size=512",
    "/data/sdk/entry.ts",
    "/data/wf/flow.ts",
  ]);
});

test("startMessage forwards optional inputs into the start frame", () => {
  const instance = "wfi_01arz3ndektsv4rrffq69g5fav" as Id<"wfi">;
  const plain = startMessage({ instance, input: "run" });
  assert.deepStrictEqual(plain, {
    type: "start",
    instance,
    input: "run",
  });
  assert.ok(flowStartMessageSchema.safeParse(plain).success);

  const withInputs = startMessage({
    instance,
    input: "run",
    inputs: { mode: "fast", retries: 2, tags: ["a", "b"] },
  });
  assert.deepStrictEqual(withInputs, {
    type: "start",
    instance,
    input: "run",
    inputs: { mode: "fast", retries: 2, tags: ["a", "b"] },
  });
  assert.ok(flowStartMessageSchema.safeParse(withInputs).success);
});
