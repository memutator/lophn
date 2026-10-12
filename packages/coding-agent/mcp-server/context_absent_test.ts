// coding agent에게서 context 기능이 없어졌는지 본다(ctx-R7). coding agent는 앱 toolset만 갖는다:
// MCP tool·CLI command·변경 제안·contract 항목·skill 안내 어디에도 context가 남지 않는다.
import { assert, assertEquals } from "@std/assert";
import { findTool, STATIC_TOOLS } from "./registry.ts";
import { COMMANDS } from "../cli/mod.ts";

const ROOT = new URL("../../../", import.meta.url);

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(new URL(path, ROOT));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function text(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, ROOT));
}

Deno.test("coding-agent/mcp-server#R38 [ctx-R7]: MCP에 lophn_context tool이 없다", () => {
  assertEquals(findTool("lophn_context"), undefined);
  assert(STATIC_TOOLS.every((tool) => tool.name !== "lophn_context"));
});

Deno.test("coding-agent/cli#R42 [ctx-R7]: CLI에 context command가 없다", () => {
  const names = COMMANDS.map((command) => command.name);
  assert(
    names.every((name) => name !== "context" && !name.startsWith("context ")),
    `context command가 남았다: ${
      names.filter((name) => name.startsWith("context")).join(", ")
    }`,
  );
  const index = COMMANDS.find((command) => command.name === "index");
  assert(index !== undefined, "index command가 없다");
  assert(
    !Object.hasOwn(index.opRoutes ?? {}, "context"),
    "index에 context op가 남았다",
  );
});

Deno.test("coding-agent/mcp-server#R38 [ctx-R7]: context tool·command·변경 제안 파일이 없다", async () => {
  for (
    const path of [
      "packages/coding-agent/mcp-server/tools/context.ts",
      "packages/coding-agent/mcp-server/tools/context_test.ts",
      "packages/coding-agent/cli/commands/context.ts",
      "packages/coding-agent/cli/commands/context_test.ts",
      "packages/coding-agent/connection/context-proposal.ts",
    ]
  ) {
    assert(!(await exists(path)), `${path}가 남았다`);
  }
});

Deno.test("coding-agent/mcp-server#R38 [ctx-R7]: contract·배선·skill 안내에 context가 없다", async () => {
  for (
    const path of [
      "packages/protocol/coding-agent/mcp-decisions.ts",
      "packages/protocol/coding-agent/cli-decisions.ts",
    ]
  ) {
    const body = await text(path);
    for (
      const name of [
        "contextPerspectiveSchema",
        "contextList",
        "contextGet",
        "contextRelated",
        "contextCreateInputSchema",
        "contextUpdateInputSchema",
        "contextSetItemInputSchema",
        "contextRemoveItemInputSchema",
      ]
    ) {
      assert(!body.includes(name), `${path}에 ${name}가 남았다`);
    }
  }
  for (
    const path of [
      "packages/coding-agent/mcp-server/main.ts",
      "packages/coding-agent/guides/skills/lophn-navigate/SKILL.md",
    ]
  ) {
    assert(
      !(await text(path)).includes("lophn_context"),
      `${path}에 lophn_context가 남았다`,
    );
  }
});
