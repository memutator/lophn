import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_COMMANDS } from "./agent.ts";

// 할당·정의 층 MCP server·skip은 사람만 쓴다. agent 명령 입력에 그 칸이 보이면 model이 권한을 넓힐 수 있다.
test("agent.create와 agent.update 입력은 skip, mcp_servers, apps, permissions를 받지 않는다", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["agent.create", { handle: "ops", body: "b" }],
    ["agent.update", { agent: "ops", body: "b" }],
  ];
  for (const [name, minimal] of cases) {
    const command = AGENT_COMMANDS.find((entry) => entry.name === name)!;
    assert.deepStrictEqual(
      command.input.safeParse(minimal).success,
      true,
      name,
    );
    const values: Record<string, unknown> = {
      skip: true,
      mcp_servers: [],
      apps: [],
      permissions: { deny: [] },
    };
    for (const field of Object.keys(values)) {
      assert.deepStrictEqual(
        command.input.safeParse({ ...minimal, [field]: values[field] }).success,
        false,
        `${name} ${field}`,
      );
    }
  }
});
