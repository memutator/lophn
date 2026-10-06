// lophn_sdk tool 테스트다(T22, mcp#R22·R23). tool 입력과 결과를 보고,
// 실행은 fixture flow client로 한다.
import { assert, assertEquals } from "@std/assert";
import {
  type Package,
  packagesGuide,
  packagesList,
  packagesVersions,
} from "../../../contracts/apps/mod.ts";
import { scriptedFlow } from "../../connection/testing/mod.ts";
import { createSdkTool } from "./sdk.ts";

const mockPackages: Package[] = [
  {
    id: "pkg_123",
    name: "@lophn/test-pkg",
    description: "테스트 component",
    kind: "component",
    versions: [
      {
        version: "1.0.0",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      },
      {
        version: "0.9.0",
        bundle_hash: "c".repeat(64),
        guide_hash: "d".repeat(64),
      },
    ],
  },
  {
    id: "pkg_456",
    name: "@me/private-sdk",
    description: "개인 SDK",
    kind: "component",
    versions: [
      {
        version: "1.0.0",
        bundle_hash: "e".repeat(64),
        guide_hash: "f".repeat(64),
      },
    ],
  },
];

Deno.test("mcp#R22: SDK tool catalog 검색 없음", async () => {
  const flow = scriptedFlow({
    "packages.list": {
      packages: mockPackages,
      as_of_seq: 1,
      next_cursor: null,
    },
  });
  const tool = createSdkTool({ client: flow.client });
  const result = await tool("lophn_sdk", packagesList, { op: "catalog" });
  assertEquals(result.isError, undefined);
  assertEquals(result.summary.includes("2개"), true);
  const data = result.data as Record<string, unknown>;
  assert(Array.isArray(data.packages));
  assertEquals((data.packages as unknown[]).length, 2);
  const pkg = (data.packages as unknown[])[0] as Record<string, unknown>;
  assertEquals(pkg.name, "@lophn/test-pkg");
  assertEquals(pkg.latest_version, "1.0.0");
  assertEquals(pkg.kind, "component");
  assertEquals(pkg.description, "테스트 component");
});

Deno.test("mcp#R22: SDK tool catalog 이름 검색", async () => {
  const flow = scriptedFlow({
    "packages.list": (input: unknown) => {
      const inputObj = input as Record<string, unknown>;
      const found = mockPackages.find((p) => p.name === inputObj.name);
      return {
        packages: found ? [found] : [],
        as_of_seq: 1,
        next_cursor: null,
      };
    },
  });
  const tool = createSdkTool({ client: flow.client });
  const result = await tool("lophn_sdk", packagesList, {
    op: "catalog",
    name: "@lophn/test-pkg",
  });
  assertEquals(result.isError, undefined);
  const data = result.data as Record<string, unknown>;
  assertEquals((data.packages as unknown[]).length, 1);
});

Deno.test("mcp#R22: SDK tool show 성공", async () => {
  const flow = scriptedFlow({
    "packages.versions": {
      name: "@lophn/test-pkg",
      versions: mockPackages[0].versions,
      as_of_seq: 1,
      next_cursor: null,
    },
  });
  const tool = createSdkTool({ client: flow.client });
  const result = await tool("lophn_sdk", packagesVersions, {
    op: "show",
    name: "@lophn/test-pkg",
  });
  assertEquals(result.isError, undefined);
  assertEquals(result.summary.includes("@lophn/test-pkg"), true);
  assertEquals(result.summary.includes("2개"), true);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.name, "@lophn/test-pkg");
  assert(Array.isArray(data.versions));
  assertEquals((data.versions as unknown[]).length, 2);
});

Deno.test("mcp#R23: SDK tool add exact version", async () => {
  const flow = scriptedFlow({
    "packages.guide": {
      name: "@lophn/test-pkg",
      version: "1.0.0",
      guide_hash: "a".repeat(64),
      as_of_seq: 1,
      next_cursor: null,
    },
  });
  const tool = createSdkTool({ client: flow.client });
  const result = await tool("lophn_sdk", packagesGuide, {
    op: "add",
    name: "@lophn/test-pkg",
    version: "1.0.0",
  });
  assertEquals(result.isError, undefined);
  assertEquals(result.summary.includes("추가 안내"), true);
  const data = result.data as Record<string, unknown>;
  assertEquals(
    data.import_key,
    "lophn-sdk:@lophn/test-pkg@1.0.0",
  );
  assertEquals(
    data.import_value,
    "./sdk/@lophn/test-pkg/1.0.0/",
  );
});

Deno.test("mcp#R23: SDK tool add range version 거절", async () => {
  const flow = scriptedFlow({});
  const tool = createSdkTool({ client: flow.client });
  const result = await tool("lophn_sdk", packagesGuide, {
    op: "add",
    name: "@lophn/test-pkg",
    version: "^1.0.0",
  });
  assertEquals(result.isError, true);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.code, "invalid_input");
  assertEquals(result.summary.includes("범위"), true);
});
