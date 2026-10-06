// SDK command 표와 CLI/MCP parity 테스트다(T22, cli#R30). 표가 MCP와 같은 소유 route를 가리키는지,
// 공통 option을 뗀 입력이 MCP op 입력과 같고 같은 실행 결과를 내는지 본다.
import { assert, assertEquals } from "@std/assert";
import {
  CLI_SDK_OPS,
  COMMANDS,
  findCommand,
  runSdk,
  SDK_COMMANDS,
  sdkOpInput,
} from "../../cli/mod.ts";
import { scriptedFlow } from "../../connection/testing/mod.ts";
import { SDK_OP_ROUTES } from "../../connection/mod.ts";
import { createSdkTool } from "./sdk.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";

function entry(name: string) {
  const found = findCommand(name);
  if (!found) throw new Error(name);
  return found;
}

function flow() {
  return scriptedFlow({
    "packages.versions": {
      name: "@lophn/ui-table",
      versions: [{
        version: "1.2.0",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      }],
      as_of_seq: 1,
      next_cursor: null,
    },
    "packages.guide": {
      name: "@lophn/ui-table",
      version: "1.2.0",
      guide_hash: "b".repeat(64),
      as_of_seq: 1,
      next_cursor: null,
    },
  });
}

Deno.test("coding-agent/cli#R30: sdk command 3개가 표에 있고 route는 MCP lophn_sdk와 같은 소유 route다", () => {
  assertEquals(SDK_COMMANDS.length, 3);
  for (const item of SDK_COMMANDS) assert(COMMANDS.includes(item), item.name);
  for (const [name, op] of Object.entries(CLI_SDK_OPS)) {
    assertEquals(entry(name).monoRoute, SDK_OP_ROUTES[op], name);
  }
});

Deno.test("coding-agent/cli#R30: 입력 schema는 검색어·version 선택·apply를 받고 범위 version을 거절한다", () => {
  assert(
    entry("sdk catalog").input.safeParse({
      command: "sdk catalog",
      query: "표",
    }).success,
  );
  assert(
    entry("sdk show").input.safeParse({
      command: "sdk show",
      name: "@lophn/ui-table",
      version: "1.2.0",
    }).success,
  );
  const add = entry("sdk add").input;
  assert(
    add.safeParse({
      command: "sdk add",
      name: "@lophn/ui-table",
      version: "1.2.0",
      apply: true,
      app: APP,
    }).success,
  );
  assert(
    !add.safeParse({
      command: "sdk add",
      name: "@lophn/ui-table",
      version: "^1.2.0",
    })
      .success,
  );
});

Deno.test("coding-agent/cli#R30: 공통 option을 떼면 MCP op 입력이고 반영 앱은 공통 --app이다", () => {
  assertEquals(
    sdkOpInput("sdk add", {
      command: "sdk add",
      json: true,
      connection: "cac_01arz3ndektsv4rrffq69g5fav",
      app: APP,
      name: "@lophn/ui-table",
      version: "1.2.0",
      apply: true,
    }),
    {
      op: "add",
      app: APP,
      name: "@lophn/ui-table",
      version: "1.2.0",
      apply: true,
    },
  );
  assertEquals(
    sdkOpInput("sdk catalog", {
      command: "sdk catalog",
      app: APP,
      query: "표",
    }),
    { op: "catalog", query: "표" },
  );
});

Deno.test("coding-agent/cli#R30: 같은 입력의 CLI와 MCP 실행이 같은 요청과 data를 낸다", async () => {
  const cliFlow = flow();
  const mcpFlow = flow();
  const cli = await runSdk("sdk add", {
    command: "sdk add",
    json: true,
    name: "@lophn/ui-table",
    version: "1.2.0",
  }, { client: cliFlow.client });
  const mcp = await createSdkTool({ client: mcpFlow.client })(
    "lophn_sdk",
    SDK_OP_ROUTES.add,
    { op: "add", name: "@lophn/ui-table", version: "1.2.0" },
  );
  assertEquals(cli.data, mcp.data);
  assertEquals(cliFlow.sent, mcpFlow.sent);
  assert(cli.next.some((line) => line.startsWith("lophn sdk add")));
});
