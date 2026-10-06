import { assertEquals } from "@std/assert";
import {
  type Package,
  packagesGuide,
  packagesList,
  packagesVersions,
} from "../../contracts/apps/mod.ts";
import { err, type LophnError, ok } from "../../base/mod.ts";
import { runSdkOp, type SdkOpDeps } from "./sdk-ops.ts";

const mockPackages: Package[] = [
  {
    id: "pkg_abc123",
    name: "@lophn/component-test",
    description: "test component",
    kind: "component",
    versions: [
      {
        version: "1.2.3",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      },
      {
        version: "1.2.2",
        bundle_hash: "c".repeat(64),
        guide_hash: "d".repeat(64),
      },
    ],
  },
  {
    id: "pkg_def456",
    name: "@lophn/capability-example",
    description: "example capability",
    kind: "capability",
    versions: [
      {
        version: "2.0.0",
        bundle_hash: "e".repeat(64),
        guide_hash: "f".repeat(64),
      },
    ],
  },
];

function createMockClient(packages: Package[]) {
  return {
    read: (
      route: unknown,
      input: unknown,
    ): Promise<
      { ok: true; value: unknown } | { ok: false; error: LophnError }
    > => {
      const inputObj = input as Record<string, unknown>;
      if (route === packagesList) {
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
      if (route === packagesVersions) {
        const found = packages.find((p) => p.name === inputObj.name);
        return ok({
          name: inputObj.name,
          versions: found?.versions ?? [],
          as_of_seq: 1,
          next_cursor: null,
        });
      }
      if (route === packagesGuide) {
        const found = packages.find((p) => p.name === inputObj.name);
        if (!found) {
          return err({
            code: "not_found",
            message: "package not found",
          });
        }
        const version = found.versions.find(
          (v) => v.version === inputObj.version,
        );
        if (!version) {
          return err({
            code: "not_found",
            message: "version not found",
          });
        }
        return ok({
          name: inputObj.name,
          version: inputObj.version,
          guide_hash: version.guide_hash,
          as_of_seq: 1,
          next_cursor: null,
        });
      }
      return ok({});
    },
  };
}

Deno.test("R22-catalog: catalog works", async () => {
  const deps: SdkOpDeps = {
    client: createMockClient(mockPackages),
  };

  const result = await runSdkOp({ op: "catalog" }, deps);
  assertEquals(result.isError, undefined);
  assertEquals(result.summary.includes("2"), true);
  const data = result.data as Record<string, unknown>;
  assertEquals(Array.isArray(data.packages), true);
  assertEquals(
    (data.packages as unknown[]).length,
    2,
  );
});

Deno.test("R22-show: show works", async () => {
  const deps: SdkOpDeps = {
    client: createMockClient(mockPackages),
  };

  const result = await runSdkOp(
    { op: "show", name: "@lophn/component-test" },
    deps,
  );
  assertEquals(result.isError, undefined);
  assertEquals(result.summary.includes("component-test"), true);
  const data = result.data as Record<string, unknown>;
  assertEquals(Array.isArray(data.versions), true);
});

Deno.test("R23-add: exact version required", async () => {
  const deps: SdkOpDeps = {
    client: createMockClient(mockPackages),
  };

  const result = await runSdkOp(
    { op: "add", name: "@lophn/component-test" },
    deps,
  );
  assertEquals(result.isError, true);
  assertEquals(
    (result.data as Record<string, unknown>).code,
    "invalid_input",
  );
});

Deno.test("R23-add: range version rejected", async () => {
  const deps: SdkOpDeps = {
    client: createMockClient(mockPackages),
  };

  const result = await runSdkOp(
    { op: "add", name: "@lophn/component-test", version: "^1.2.3" },
    deps,
  );
  assertEquals(result.isError, true);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.code, "invalid_input");
});

Deno.test("R23-add: uninstalled version rejected", async () => {
  const deps: SdkOpDeps = {
    client: createMockClient(mockPackages),
  };

  const result = await runSdkOp(
    { op: "add", name: "@lophn/component-test", version: "99.0.0" },
    deps,
  );
  assertEquals(result.isError, true);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.code, "not_found");
});

Deno.test("R23-add: exact version success", async () => {
  const deps: SdkOpDeps = {
    client: createMockClient(mockPackages),
  };

  const result = await runSdkOp(
    { op: "add", name: "@lophn/component-test", version: "1.2.3" },
    deps,
  );
  assertEquals(result.isError, undefined);
  assertEquals(result.summary.includes("안내"), true);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.import_key, "lophn-sdk:@lophn/component-test@1.2.3");
  assertEquals(data.import_value, "./sdk/@lophn/component-test/1.2.3/");
});

Deno.test("R22-catalog: search nonexistent package", async () => {
  const deps: SdkOpDeps = {
    client: createMockClient(mockPackages),
  };

  const result = await runSdkOp(
    { op: "catalog", name: "@lophn/nonexistent" },
    deps,
  );
  assertEquals(result.isError, undefined);
  const data = result.data as Record<string, unknown>;
  assertEquals((data.packages as unknown[]).length, 0);
});
