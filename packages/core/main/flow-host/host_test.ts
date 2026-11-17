import assert from "node:assert/strict";
import { test } from "node:test";
import { flowCommand } from "./host.ts";

// Node로 옮기며 한 번 없어졌던 한도다. 없으면 AI가 짠 flow가 기계 memory를 다 잡는다.
test("a flow process starts with a V8 heap limit before its entry", () => {
  const command = flowCommand("/data/sdk/entry.ts", "/data/wf/flow.ts");
  assert.deepStrictEqual(command.args, [
    "--max-old-space-size=512",
    "/data/sdk/entry.ts",
    "/data/wf/flow.ts",
  ]);
});
