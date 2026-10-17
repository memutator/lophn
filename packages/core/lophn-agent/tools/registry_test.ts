import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { ok } from "../../../base/mod.ts";
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
    return Promise.resolve(ok({
      status: "success" as const,
      summary: name,
      content: null,
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    }));
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
      name: "operator.update",
      description: "gated",
      effect: "write",
      input: z.strictObject({}),
      routes: [],
      handler: handler("operator.update"),
      gate: () => ({
        kind: "settings_edit",
        target: { kind: "settings_edit", what: "agent_definition", id: null },
        effect: "write",
        input: {},
      }),
    }),
  ];
  // role마다 고정되는 이름 목록이다.
  const NAMES = {
    operator: ["file.read"],
    app_engineer: ["file.read", "operator.update"],
  };
  const context = (role: "operator" | "app_engineer"): ToolContext => ({
    listed: selectTools(NAMES[role], MODEL, definitions),
    agent: { role: "operator", agent: "agt_01J00000000000000000000000" },
    session: "ses_01J00000000000000000000000",
    turn: "trn_01J00000000000000000000000",
    tool_call: "tcl_01J00000000000000000000000",
    gate: {
      check: (call: { intent: { kind: string } }) => {
        asked.push(call.intent.kind);
        return Promise.resolve(
          ok(
            gateVerdict === "run"
              ? { kind: "run" as const }
              : { kind: "denied" as const, reason: "not_granted" as const },
          ),
        );
      },
    },
  } as unknown as ToolContext);
  return { ran, asked, context };
}

Deno.test("role의 고정 목록에 없는 tool은 목록에도 실행에도 나오지 않는다", async () => {
  const { ran, context } = fixture();
  const ctx = context("operator");
  assertEquals(ctx.listed.map((tool) => tool.name), ["file.read"]);

  const missing = await executeToolCall(ctx, "ticket_create", {});
  assertEquals(missing.outcome.code, "unknown_tool");
  assertEquals(missing.executed, false);

  const read = await executeToolCall(ctx, "file_read", { path: "a.md" });
  assertEquals(read.outcome.code, "ok");
  assertEquals(ran, ["file.read"]);
});

Deno.test("같은 wire 이름의 tool 둘은 목록을 만들 때 오류다", () => {
  const { context } = fixture();
  const [first] = context("operator").listed;
  const clash = { ...first!, name: "file_read" };
  const built = buildWireTable([first!, clash]);
  assert(!built.ok);
});

Deno.test("Gate가 막은 tool은 실행되지 않고 Gate 없는 tool은 Gate를 거치지 않는다", async () => {
  const { ran, asked, context } = fixture("deny");
  const ctx = context("app_engineer");

  const read = await executeToolCall(ctx, "file_read", { path: "a.md" });
  assertEquals(read.executed, true);
  assertEquals(asked, []);

  const gated = await executeToolCall(ctx, "operator_update", {});
  assertEquals(gated.outcome, { kind: "not_executed", code: "denied" });
  assertEquals(asked, ["settings_edit"]);
  assertEquals(ran, ["file.read"]);
});
