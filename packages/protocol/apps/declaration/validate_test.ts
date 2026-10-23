import { assert, assertEquals } from "@std/assert";
import { toMcpTool, type ToolDeclaration, validateDeclaration } from "./mod.ts";

const tool = {
  name: "list_items",
  title: "List items",
  description: "Lists the items.",
  inputSchema: null,
  effect: "read",
  domain: "items",
  public: false,
};
const objectSchema = {
  type: "object",
  properties: { id: { type: "string", description: "item id" } },
  required: ["id"],
};

function declarationWith(tools: unknown[]) {
  return {
    name: "Items",
    description: "Keeps items.",
    screens: [],
    tools,
    permissions: [],
    app_connections: [],
    sdk_dependencies: [],
  };
}

// 선언 검사는 이름 노출(MCP tool 이름)과 program이 강제하는 effect·public을 정한다.
Deno.test("tool 선언은 이름 규칙, object root, public, 알 수 없는 칸을 거절하고 올바른 선언만 MCP 항목이 된다", () => {
  const rejected: [string, unknown[]][] = [
    ["space in name", [{ ...tool, name: "list items" }]],
    ["comma in name", [{ ...tool, name: "a,b" }]],
    ["name too long", [{ ...tool, name: "a".repeat(65) }]],
    ["empty name", [{ ...tool, name: "" }]],
    ["duplicate name", [tool, { ...tool }]],
    ["array input root", [{
      ...tool,
      inputSchema: { type: "array", items: { type: "string" } },
    }]],
    ["string output root", [{ ...tool, outputSchema: { type: "string" } }]],
    ["missing public", [{ ...tool, public: undefined }]],
    ["missing domain", [{ ...tool, domain: undefined }]],
    ["domain not a slug", [{ ...tool, domain: "Items_1" }]],
    ["project_scope", [{ ...tool, project_scope: false }]],
    ["old key field", [{ ...tool, key: "x" }]],
  ];
  for (const [label, tools] of rejected) {
    const result = validateDeclaration(declarationWith(tools));
    assert(!result.ok, label);
    assertEquals(result.error.code, "invalid_input", label);
  }

  const outside = validateDeclaration(declarationWith([tool]), {
    domains: ["other"],
  });
  assert(!outside.ok);
  assertEquals(
    outside.error.message,
    "tool list_items domain items is not a domain of this app",
  );
  assert(
    validateDeclaration(declarationWith([tool]), { domains: ["items"] }).ok,
  );

  const accepted = validateDeclaration(declarationWith([
    {
      ...tool,
      name: "add.item-1_x",
      effect: "external",
      public: true,
      inputSchema: objectSchema,
      outputSchema: objectSchema,
    },
    tool,
  ]));
  assert(accepted.ok);
  const tools: ToolDeclaration[] = accepted.value.tools;
  assertEquals(tools.map((item) => item.name), ["add.item-1_x", "list_items"]);

  const none = toMcpTool(tools[1]);
  assertEquals(none.inputSchema, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  assertEquals(none.annotations, {
    title: "List items",
    readOnlyHint: true,
    openWorldHint: false,
  });
  assert(
    !("outputSchema" in none) && !("public" in none) && !("domain" in none),
  );
  const external = toMcpTool(tools[0]);
  assertEquals(external.annotations, {
    title: "List items",
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  });
  assertEquals(external.outputSchema, tools[0].outputSchema);
  assertEquals(
    toMcpTool({ ...tools[0], effect: "write" }).annotations.openWorldHint,
    false,
  );
});
