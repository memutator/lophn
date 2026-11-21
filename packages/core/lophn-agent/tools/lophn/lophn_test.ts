import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import { routePath } from "../../../../protocol/base/route.ts";
import { agentCallSend } from "../../../../protocol/lophn-agent/calls.ts";
import { callSendRemote } from "../../../../protocol/lophn-agent/mail.ts";
import { dispatchTarget } from "../dispatch.ts";
import type { ToolContext } from "../mod.ts";
import { executeToolCall } from "../work.ts";
import { commandTools } from "./command-tool.ts";

// `--on`이 붙은 call send가 이 컴퓨터의 session으로 가거나, `--on`이 빠진 call send가 다른 컴퓨터로 가면 일이 엉뚱한 곳에서 돈다.
// 가짜 core는 route마다 다른 call id를 답하고, 판정은 tool 결과의 call id로 한다.
const LOCAL = "cal_00000000000000000000000001";
const REMOTE = "cal_00000000000000000000000002";

test("lophn tool의 call send --on <컴퓨터>는 calls/send_remote로 가고 --on 없는 call send는 calls/send로 간다", async () => {
  const bodies: unknown[] = [];
  const ctx = {
    kind: "project",
    tool_call: "tcl_1",
    scope: { read: [] },
    listed: commandTools("project"),
    core: (path: string, body: unknown) => {
      bodies.push(body);
      const call =
        path === routePath(agentCallSend)
          ? LOCAL
          : path === routePath(callSendRemote)
            ? REMOTE
            : undefined;
      return Promise.resolve(
        ok(
          call === undefined
            ? {}
            : { call, state: "accepted", fail_reason: null },
        ),
      );
    },
  } as unknown as ToolContext;
  const send = async (args: string[]) => {
    const target = dispatchTarget("lophn", { args });
    const ran = await executeToolCall(ctx, target.name, target.input);
    return (ran.result.content as { call?: string } | undefined)?.call;
  };
  const line = ["--to", '{"agent":"reviewer"}', "--reply", "result"];

  assert.equal(
    await send(["call", "send", ...line, "--body", "look", "--on", "laptop"]),
    REMOTE,
  );
  assert.deepStrictEqual(bodies.at(-1), {
    to: { agent: "reviewer", machine: "laptop" },
    reply: "result",
    body: [{ type: "text", text: "look" }],
    dedup: "tcl_1",
  });
  assert.equal(await send(["call", "send", ...line, "--body", "look"]), LOCAL);
});
