import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";
import { err, type ErrorCode, ok } from "../../../base/mod.ts";
import { defineTool } from "./define.ts";
import { selectTools } from "./registry.ts";
import type { ToolContext } from "./tool-context.ts";
import { buildWireTable } from "./wire.ts";
import { executeToolCall } from "./work.ts";
const MODEL = { input_media: ["text"] };

function fixture(gateVerdict: "run" | "deny" = "run") {
  const ran: string[] = [];
  const asked: string[] = [];
  const handler = (name: string) => () => {
    ran.push(name);
    return Promise.resolve(
      ok({
        status: "success" as const,
        summary: name,
        content: null,
        complete: true,
        source: null,
        continuation: null,
        pending: [],
      }),
    );
  };
  const definitions = [
    defineTool({
      name: "ticket.create",
      description: "create",
      effect: "write",
      input: z.strictObject({}),
      routes: [],
      handler: handler("ticket.create"),
    }),
    defineTool({
      name: "file.read",
      description: "read",
      effect: "read",
      input: z.strictObject({ path: z.string() }),
      routes: [],
      handler: handler("file.read"),
    }),
    defineTool({
      name: "agent.update",
      description: "gated",
      effect: "write",
      input: z.strictObject({}),
      inputSchema: { type: "object", additionalProperties: true },
      routes: [],
      handler: handler("agent.update"),
      gate: () => ({
        kind: "app_tool",
        app: "app_01J00000000000000000000000",
        tool: "notes.add",
        effect: "write",
      }),
    }),
  ];
  // workspace 종류마다 고정되는 이름 목록이다.
  const NAMES = {
    home: ["file.read"],
    app: ["file.read", "agent.update"],
  };
  const context = (kind: "home" | "app"): ToolContext =>
    ({
      listed: selectTools(NAMES[kind], MODEL, definitions),
      agent: "agt_01J00000000000000000000000",
      kind,
      session: "ses_01J00000000000000000000000",
      turn: "trn_01J00000000000000000000000",
      tool_call: "tcl_01J00000000000000000000000",
      gate: {
        check: (input: { call: { kind: string } }) => {
          asked.push(input.call.kind);
          return Promise.resolve(
            ok(
              gateVerdict === "run"
                ? { kind: "run" as const }
                : { kind: "denied" as const, reason: "not_assigned" as const },
            ),
          );
        },
      },
    }) as unknown as ToolContext;
  return { ran, asked, context };
}

test("workspace 종류의 고정 목록에 없는 tool은 목록에도 실행에도 나오지 않는다", async () => {
  const { ran, context } = fixture();
  const ctx = context("home");
  assert.deepStrictEqual(
    ctx.listed.map((tool) => tool.name),
    ["file.read"],
  );

  const missing = await executeToolCall(ctx, "ticket_create", {});
  assert.deepStrictEqual(missing.outcome.code, "not_found");
  assert.deepStrictEqual(missing.executed, false);

  const read = await executeToolCall(ctx, "file_read", { path: "a.md" });
  assert.deepStrictEqual(read.outcome.code, "ok");
  assert.deepStrictEqual(ran, ["file.read"]);
});

test("같은 wire 이름의 tool 둘은 목록을 만들 때 오류다", () => {
  const { context } = fixture();
  const [first] = context("home").listed;
  const clash = { ...first!, name: "file_read" };
  const built = buildWireTable([first!, clash]);
  assert.ok(!built.ok);
});

test("Gate가 막은 tool은 실행되지 않고 Gate 없는 tool은 Gate를 거치지 않는다", async () => {
  const { ran, asked, context } = fixture("deny");
  const ctx = context("app");

  const read = await executeToolCall(ctx, "file_read", { path: "a.md" });
  assert.deepStrictEqual(read.executed, true);
  assert.deepStrictEqual(asked, []);

  const gated = await executeToolCall(ctx, "agent_update", {});
  assert.deepStrictEqual(gated.outcome, {
    kind: "not_executed",
    code: "denied",
  });
  assert.deepStrictEqual(asked, ["app_tool"]);
  assert.deepStrictEqual(ran, ["file.read"]);
});

// model에 간략한 schema를 보여도 실행 input을 넓혀 할당·skip 같은 설정을 끼워 넣을 수 없어야 한다.
test("model용 schema가 느슨해도 실행 검증은 Gate와 handler 전에 입력을 거절한다", async () => {
  const { ran, asked, context } = fixture();
  const result = await executeToolCall(context("app"), "agent_update", {
    skip: true,
  });
  assert.deepStrictEqual(result.outcome.code, "invalid_input");
  assert.deepStrictEqual(result.executed, false);
  assert.deepStrictEqual(asked, []);
  assert.deepStrictEqual(ran, []);
});

// model은 틀린 입력을 고치려면 무엇이 틀렸는지 알아야 한다. 하지만 not_found·forbidden 문장은 범위 밖 대상의 이름과
// 존재를 담을 수 있어, 그 문장이 새면 할당 밖 대상을 탐색할 수 있다.
test("invalid_input은 어디가 왜 틀렸는지 알리고 not_found·forbidden은 handler 문장을 숨긴다", async () => {
  const failing = (code: ErrorCode) =>
    defineTool({
      name: `fail.${code}`,
      description: "fail",
      effect: "read",
      input: z.strictObject({ count: z.number().int().max(5) }),
      routes: [],
      handler: () =>
        Promise.resolve(err({ code, message: "secret-target-name" })),
    });
  const ctx = {
    listed: [
      failing("invalid_input"),
      failing("not_found"),
      failing("forbidden"),
    ],
  } as unknown as ToolContext;
  const summary = async (name: string, input: unknown) =>
    (await executeToolCall(ctx, name, input)).result.summary;

  const tooBig = await summary("fail_invalid_input", { count: 9 });
  const unknownKey = await summary("fail_invalid_input", {
    count: 1,
    extra: true,
  });
  assert.ok(tooBig.includes("at count") && tooBig.includes("5"), tooBig);
  assert.ok(unknownKey.includes("unknown key extra"), unknownKey);
  assert.ok(
    (await summary("fail_invalid_input", { count: 1 })).includes(
      "secret-target-name",
    ),
  );
  for (const name of ["fail_not_found", "fail_forbidden"]) {
    assert.deepStrictEqual(
      await summary(name, { count: 1 }),
      "tool target is not available",
    );
  }
});
