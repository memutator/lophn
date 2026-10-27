import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES } from "../../protocol/lophn-agent/places.ts";
import { builtinToolNames } from "../agent-roles/tool-lists.ts";
import { appConnectSource } from "../../protocol/apps/apps.ts";
import { agentConditions, roleOperations } from "../agent-roles/credentials.ts";
import { FILE_HOOKS } from "../agent-roles/hooks.ts";
import { agentTools } from "./agent-tools.ts";
import { inputJsonSchema } from "../lophn-agent/tools/wire.ts";

// agent credential 상한은 core가 대조하는 route 이름이어야 한다. tool 이름이면 command가 forbidden이다.
test("App Engineer의 credential 상한에 app.link_source tool이 부르는 route 이름이 들고 Project Manager의 상한에는 없다", () => {
  const operations = roleOperations(
    "app_engineer",
    agentTools({ file: FILE_HOOKS }),
  );
  assert.ok(operations.includes(appConnectSource.name));
  assert.deepStrictEqual(appConnectSource.name, "app.connect_source");
  assert.ok(!operations.includes("app.link_source"));
  const manager = roleOperations(
    "project_manager",
    agentTools({ file: FILE_HOOKS }),
  );
  assert.ok(!manager.includes(appConnectSource.name));
  // 앱 place의 Operator는 App Engineer의 쓰기 route에 닿지 못하고 자기 앱 하나에 묶인다.
  const operator = roleOperations("operator", agentTools({ file: FILE_HOOKS }));
  assert.ok(!operator.includes(appConnectSource.name));
  const ids = { session: "s", turn: "t", process: "p" };
  assert.deepStrictEqual(
    agentConditions({
      ...ids,
      role: "operator",
      place: { kind: "app", id: "app_1" },
    }).app,
    "app_1",
  );
});

// selectTools는 정의 없는 이름을 조용히 건너뛴다. 어긋나면 agent가 그 tool을 말없이 못 본다.
test("role 목록의 모든 이름에 정의가 있고 모든 정의가 어느 role 목록에 있다", () => {
  const defined = new Set(
    agentTools({ file: FILE_HOOKS }).map((tool) => tool.name),
  );
  const listed = new Set(ROLES.flatMap((role) => builtinToolNames(role)));
  assert.deepStrictEqual(
    [...listed].filter((name) => !defined.has(name)),
    [],
  );
  assert.deepStrictEqual(
    [...defined].filter((name) => !listed.has(name)),
    [],
  );
});

// tool 입력 하나라도 JSON Schema로 바뀌지 않으면 그 role의 turn이 준비 단계에서 조용히 멈춘다.
test("모든 내장 tool의 입력이 model에 보낼 JSON Schema로 바뀐다", () => {
  const failed: string[] = [];
  for (const tool of agentTools({ file: FILE_HOOKS })) {
    try {
      inputJsonSchema(tool);
    } catch {
      failed.push(tool.name);
    }
  }
  assert.deepStrictEqual(failed, []);
});
