import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import { CALL_COMMANDS } from "./call.ts";
import type { CommandContext } from "./types.ts";

// 같은 tool call로 `call.send`를 다시 부르면 call이 하나만 생기는 것은 dedup이 tool call의 id(key)여서다.
// run-loop가 실패한 read를 같은 id로 다시 부르므로, 입력에서 받은 값이 dedup이 되면 재시도가 call과 session을 하나 더 만든다.
test("call.send sends the tool call id as dedup and as the idempotency key", async () => {
  const seen: { input: unknown; key: string }[] = [];
  const ctx = {
    core: {
      command: (_route: unknown, input: unknown, options: { key: string }) => {
        seen.push({ input, key: options.key });
        return Promise.resolve(
          ok({ call: "cal_1", state: "accepted", fail_reason: null }),
        );
      },
    },
    key: "tcl_1",
  } as unknown as CommandContext;
  const send = CALL_COMMANDS.find((command) => command.name === "call.send")!;
  const input = send.input.parse({
    to: { agent: "lophn" },
    reply: "none",
    body: "hi",
  }) as Record<string, unknown>;
  for (let i = 0; i < 2; i++) assert.ok((await send.run(input, ctx)).ok);
  assert.deepStrictEqual(
    seen.map((one) => [(one.input as { dedup: string }).dedup, one.key]),
    [
      ["tcl_1", "tcl_1"],
      ["tcl_1", "tcl_1"],
    ],
  );
});
