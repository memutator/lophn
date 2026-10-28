import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TOOLS } from "./agent.ts";

// 할당·정의 층 MCP server·skip은 사람만 쓴다. agent tool 입력에 그 칸이 보이면 model이 권한을 넓힐 수 있다.
test("agent.create와 agent.update 입력은 skip과 mcp_servers를 받지 않는다", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["agent.create", { name: "ops", body: "b" }],
    ["agent.update", { agent: "ops", body: "b" }],
  ];
  for (const [name, minimal] of cases) {
    const tool = AGENT_TOOLS.find((entry) => entry.name === name)!;
    assert.deepStrictEqual(tool.input.safeParse(minimal).success, true, name);
    for (const field of ["skip", "mcp_servers"]) {
      assert.deepStrictEqual(
        tool.input.safeParse({
          ...minimal,
          [field]: field === "skip" ? true : [],
        }).success,
        false,
        `${name} ${field}`,
      );
    }
  }
});
