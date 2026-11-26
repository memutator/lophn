import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";
import { type ErrorCode, err, ok } from "../../../base/mod.ts";
import { defineTool } from "./define.ts";
import type { ToolContext } from "./tool-context.ts";
import { ANTI_BYPASS_DIRECTIVE, executeToolCall } from "./work.ts";

// 실패한 대상이 model이 보낸 입력뿐인 tool은 handler 문장을 그대로 싣고, 다른 tool의 not_found는 공통 문장으로 존재를 감춘다.
test("skill.read와 agent.card의 실패는 원인을 싣고 다른 tool의 not_found는 공통 문장을 쓴다", async () => {
  const failing = (name: string, code: ErrorCode) =>
    defineTool({
      name,
      description: "fail",
      effect: "read",
      input: z.strictObject({}),
      routes: [],
      handler: () =>
        Promise.resolve(err({ code, message: "skill x has no file notes.md" })),
    });
  const ctx = {
    listed: [
      failing("skill.read", "not_found"),
      failing("agent.card", "not_found"),
      failing("file.read", "not_found"),
    ],
  } as unknown as ToolContext;
  const summary = async (wireName: string) =>
    (await executeToolCall(ctx, wireName, {})).result.summary;

  assert.deepStrictEqual(
    await summary("skill_read"),
    "tool target is not available: skill x has no file notes.md",
  );
  assert.deepStrictEqual(
    await summary("agent_card"),
    "tool target is not available: skill x has no file notes.md",
  );
  assert.deepStrictEqual(
    await summary("file_read"),
    "tool target is not available",
  );
});

// forbidden은 권한·범위·정책 거부이므로 handler 문장을 그대로 싣고 우회 금지 지침을 붙인다.
// not_found와 unavailable은 기존 마스킹 규칙을 유지한다.
test("handler forbidden은 원문과 우회 금지 지침을 싣고 not_found·unavailable은 공통 문장을 유지한다", async () => {
  const reason = "an agent can only delete artifacts in its own project";
  const failing = (name: string, code: ErrorCode, message = reason) =>
    defineTool({
      name,
      description: "fail",
      effect: "read",
      input: z.strictObject({}),
      routes: [],
      handler: () => Promise.resolve(err({ code, message })),
    });
  const ctx = {
    listed: [
      failing("browser.snapshot", "unavailable"),
      failing("browser.act", "conflict"),
      failing("tab.open", "unavailable"),
      failing("browser.read", "not_found"),
      failing("tab.close", "forbidden"),
      failing("file.read", "unavailable"),
      failing("file.write", "forbidden", "path is outside the workspace"),
      failing("artifact.delete", "forbidden", reason),
    ],
  } as unknown as ToolContext;
  const summary = async (wireName: string) =>
    (await executeToolCall(ctx, wireName, {})).result.summary;

  assert.ok((await summary("browser_snapshot")).endsWith(reason));
  assert.ok((await summary("browser_act")).endsWith(reason));
  assert.ok((await summary("tab_open")).endsWith(reason));
  assert.ok((await summary("browser_read")).endsWith(reason));
  assert.equal(await summary("file_read"), "tool is unavailable");

  const tabClose = await summary("tab_close");
  assert.ok(tabClose.includes(reason), tabClose);
  assert.ok(tabClose.includes(ANTI_BYPASS_DIRECTIVE), tabClose);

  const fileWrite = await summary("file_write");
  assert.ok(fileWrite.includes("path is outside the workspace"), fileWrite);
  assert.ok(!fileWrite.includes("tool target is not available"), fileWrite);
  assert.ok(fileWrite.includes(ANTI_BYPASS_DIRECTIVE), fileWrite);

  const artifactDelete = await summary("artifact_delete");
  assert.ok(artifactDelete.includes(reason), artifactDelete);
  assert.ok(artifactDelete.includes(ANTI_BYPASS_DIRECTIVE), artifactDelete);
});

test("Gate 거부는 reason_kind, rule_pattern, message, recovery_hint와 우회 금지 지침을 모두 싣는다", async () => {
  const gated = defineTool({
    name: "shell.run",
    description: "run shell",
    effect: "external",
    input: z.strictObject({ command: z.string() }),
    routes: [],
    gate: (input) => ({ kind: "shell", command: input.command }),
    handler: () => {
      throw new Error("must not run when denied");
    },
  });
  const ctx = {
    session: "ses_00000000000000000000000001",
    turn: "trn_00000000000000000000000001",
    tool_call: "tcl_00000000000000000000000001",
    listed: [gated],
    gate: {
      check: async () =>
        ok({
          kind: "denied" as const,
          denial: {
            tool: "shell.run",
            category: "shell" as const,
            target_summary: "rm -rf ~",
            reason_kind: "floor" as const,
            rule_pattern: "rm -rf ~",
            message: "This command is blocked by a safety floor rule",
            recovery_hint: "Ask the person to run it manually if intended",
            recovery_action: null,
          },
        }),
    },
  } as unknown as ToolContext;

  const outcome = await executeToolCall(ctx, "shell_run", {
    command: "rm -rf ~",
  });
  assert.equal(outcome.executed, false);
  assert.deepEqual(outcome.outcome, { kind: "not_executed", code: "denied" });
  const text = outcome.result.summary;
  assert.ok(text.includes("floor"), text);
  assert.ok(text.includes("rm -rf ~"), text);
  assert.ok(text.includes("blocked by a safety floor rule"), text);
  assert.ok(text.includes("Ask the person to run it manually"), text);
  assert.ok(text.includes(ANTI_BYPASS_DIRECTIVE), text);
});

test("MCP 401/missing secret guidance(details.missing)는 결과 문장에 유지된다", async () => {
  const mcpTool = defineTool({
    name: "mcp__docs__search",
    description: "mcp",
    effect: "read",
    input: z.strictObject({}),
    routes: [],
    handler: () =>
      Promise.resolve(
        err({
          code: "unavailable",
          message: "서버가 401로 답했다",
          details: { missing: { mcp: "docs", part: "sign_in" } },
        }),
      ),
  });
  const ctx = { listed: [mcpTool] } as unknown as ToolContext;
  const outcome = await executeToolCall(ctx, "mcp__docs__search", {});
  assert.ok(
    outcome.result.summary.includes("--mcp docs --part sign_in"),
    outcome.result.summary,
  );
});

test("app.take_in은 conflict·not_found·unavailable 이유 문장을 싣고 forbidden은 원문과 우회 금지 지침을 싣는다", async () => {
  const failing = (code: ErrorCode, message: string) =>
    defineTool({
      name: "app.take_in",
      description: "fail",
      effect: "write",
      input: z.strictObject({}),
      routes: [],
      handler: () => Promise.resolve(err({ code, message })),
    });
  const summaryOf = async (code: ErrorCode, message: string) =>
    (
      await executeToolCall(
        { listed: [failing(code, message)] } as unknown as ToolContext,
        "app_take_in",
        {},
      )
    ).result.summary;

  assert.equal(
    await summaryOf("conflict", "the app was built with @lophn/app-ui@2.13.0"),
    "tool call conflicted: the app was built with @lophn/app-ui@2.13.0",
  );
  assert.equal(
    await summaryOf("not_found", "the app is not in a sync folder"),
    "tool target is not available: the app is not in a sync folder",
  );
  assert.equal(
    await summaryOf("unavailable", "dependencies: dependency_install_failed"),
    "tool is unavailable: dependencies: dependency_install_failed",
  );
  const forbidden = await summaryOf("forbidden", "secret scope");
  assert.ok(forbidden.includes("secret scope"), forbidden);
  assert.ok(forbidden.includes(ANTI_BYPASS_DIRECTIVE), forbidden);
});
