import assert from "node:assert/strict";
import { resolve } from "node:path";
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

test("call.send --on --attach uploads files via transfers/send and attaches them to calls/send_remote", async () => {
  const TRF = "trf_01hzzzzzzzzzzzzzzzzzzzzzza";
  const SHA = "b".repeat(64);
  const calls: { route: string; input: unknown }[] = [];
  const ctx = {
    cwd: "/work/repo",
    key: "tcl_2",
    core: {
      read: (route: { name: string }, input: unknown) => {
        calls.push({ route: route.name, input });
        if (route.name === "transfers.send") {
          return Promise.resolve(
            ok({
              transfer: TRF,
              to_machine: "mch_01hzzzzzzzzzzzzzzzzzzzzzzb",
              to_name: "VM",
              state: "delivered",
              files: [
                { name: "a.bin", rel_path: "a.bin", size: 9, sha256: SHA },
              ],
              created_at: "2026-11-26T00:00:00.000Z",
              expires_at: "2026-12-03T00:00:00.000Z",
            }),
          );
        }
        return Promise.resolve(
          ok({ call: "cal_2", state: "accepted", fail_reason: null }),
        );
      },
    },
  } as unknown as CommandContext;

  const send = CALL_COMMANDS.find((command) => command.name === "call.send")!;
  const input = send.input.parse({
    to: { agent: "reviewer" },
    reply: "result",
    body: "check attached",
    on: "VM",
    attach: ["a.bin"],
  }) as Record<string, unknown>;
  const ran = await send.run(input, ctx);
  assert.ok(ran.ok);
  assert.deepStrictEqual(calls, [
    {
      route: "transfers.send",
      input: { to: "VM", paths: [resolve("/work/repo", "a.bin")] },
    },
    {
      route: "SendRemoteCall",
      input: {
        to: { agent: "reviewer", machine: "VM" },
        reply: "result",
        body: [{ type: "text", text: "check attached" }],
        attachments: [
          {
            transfer: TRF,
            name: "a.bin",
            size: 9,
            sha256: SHA,
            rel_path: "a.bin",
          },
        ],
        dedup: "tcl_2",
      },
    },
  ]);

  // Local call without --on rejects --attach clearly.
  const local = send.input.parse({
    to: { agent: "reviewer" },
    reply: "none",
    body: "hi",
    attach: ["a.bin"],
  }) as Record<string, unknown>;
  const failed = await send.run(local, ctx);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "invalid_input");
  assert.match(failed.error.message, /--on/);
});
