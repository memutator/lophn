import { assertEquals } from "@std/assert";
import { type Package, packagesList } from "../../../contracts/apps/mod.ts";
import { ok } from "../../../base/mod.ts";
import { createSdkTool } from "./sdk.ts";

const mockPackages: Package[] = [
  {
    id: "pkg_123",
    name: "@lophn/test-pkg",
    description: "테스트",
    kind: "component",
    versions: [
      {
        version: "1.0.0",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      },
    ],
  },
];

function createMockClient(packages: Package[]) {
  return {
    read: (route: unknown, input: unknown) => {
      if (route === packagesList) {
        const inputObj = input as Record<string, unknown>;
        if (inputObj.name !== undefined) {
          const found = packages.find((p) => p.name === inputObj.name);
          return ok({
            packages: found ? [found] : [],
            as_of_seq: 1,
            next_cursor: null,
          });
        }
        return ok({
          packages,
          as_of_seq: 1,
          next_cursor: null,
        });
      }
      return ok({});
    },
    command: () => Promise.resolve(ok({}) as never),
  };
}

Deno.test("R22-mcp: MCP SDK tool catalog 작동", async () => {
  const tool = createSdkTool({ client: createMockClient(mockPackages) });
  const result = await tool("lophn_sdk", packagesList, { op: "catalog" });
  assertEquals(result.isError, undefined);
  assertEquals(result.summary.includes("1개"), true);
});

Deno.test("R22-mcp: MCP SDK tool show 작동", async () => {
  const tool = createSdkTool({ client: createMockClient(mockPackages) });
  const result = await tool("lophn_sdk", packagesList, {
    op: "show",
    name: "@lophn/test-pkg",
  });
  assertEquals(result.isError, undefined);
});

Deno.test("R23-mcp: MCP SDK tool add 작동", async () => {
  const tool = createSdkTool({ client: createMockClient(mockPackages) });
  const result = await tool("lophn_sdk", packagesList, {
    op: "add",
    name: "@lophn/test-pkg",
    version: "1.0.0",
  });
  assertEquals(result.isError, undefined);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.import_key, "lophn-sdk:@lophn/test-pkg@1.0.0");
});
