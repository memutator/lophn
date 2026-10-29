import assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalOutput } from "../../ipc/terminal.ts";
import { TERMINAL_OUTPUT_CHANNEL } from "../../ipc/terminal.ts";
import { TerminalOutputs } from "./output.ts";

test("출력은 해당 terminal을 구독한 창에만 가고 창을 놓으면 더 보내지 않는다", () => {
  const sent: unknown[] = [];
  const outputs = new TerminalOutputs((id, channel, value) =>
    sent.push([id, channel, value]),
  );
  const chunk = (ref: string): TerminalOutput => ({
    terminal_ref: ref,
    generation: 1,
    seq: 1,
    chunk: "private",
    dropped_output: false,
  });
  outputs.watch(1, "a", true);
  outputs.watch(2, "b", true);
  const a = chunk("a");
  const b = chunk("b");
  outputs.output([a, b, chunk("unwatched")]);
  assert.deepStrictEqual(sent, [
    [1, TERMINAL_OUTPUT_CHANNEL, [a]],
    [2, TERMINAL_OUTPUT_CHANNEL, [b]],
  ]);
  sent.length = 0;
  outputs.forget(1);
  outputs.watch(2, "b", false);
  assert.equal(outputs.watching(1, "a"), false);
  assert.equal(outputs.watching(2, "b"), false);
  outputs.output([a, b]);
  assert.deepStrictEqual(sent, []);
});
