import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOW_PORT, type FlowPort, parseStartLine } from "./wire.ts";

test("parseStartLine populates frozen inputs and defaults to empty object", () => {
  const withoutInputs = parseStartLine(
    JSON.stringify({ type: "start", instance: "wfi_1", input: "hello" }),
  );
  assert.ok(withoutInputs.ok);
  assert.deepStrictEqual(withoutInputs.value.inputs, {});
  assert.ok(Object.isFrozen(withoutInputs.value.inputs));

  const withInputs = parseStartLine(
    JSON.stringify({
      type: "start",
      instance: "wfi_2",
      input: "hello",
      inputs: { mode: "full", budget: 10, tags: ["a"] },
    }),
  );
  assert.ok(withInputs.ok);
  assert.deepStrictEqual(withInputs.value.inputs, {
    mode: "full",
    budget: 10,
    tags: ["a"],
  });
  assert.ok(Object.isFrozen(withInputs.value.inputs));
});

test("parseStartLine rejects non-object inputs", () => {
  for (const bad of [null, [], "str", 42]) {
    const parsed = parseStartLine(
      JSON.stringify({
        type: "start",
        instance: "wfi_1",
        input: "hello",
        inputs: bad,
      }),
    );
    assert.equal(parsed.ok, false);
  }
});

test("mod exports frozen inputs from the active flow port", async () => {
  const store = globalThis as Record<symbol, unknown>;
  const previous = store[FLOW_PORT];
  const port: FlowPort = {
    instance: "wfi_3",
    input: "run",
    inputs: { mode: "quick", count: 3 },
    request: () => Promise.resolve({ ok: true, result: null }),
  };
  store[FLOW_PORT] = port;
  try {
    const mod = await import("./mod.ts");
    assert.equal(mod.instance, "wfi_3");
    assert.equal(mod.input, "run");
    assert.deepStrictEqual(mod.inputs, { mode: "quick", count: 3 });
    assert.ok(Object.isFrozen(mod.inputs));
  } finally {
    if (previous === undefined) delete store[FLOW_PORT];
    else store[FLOW_PORT] = previous;
  }
});
