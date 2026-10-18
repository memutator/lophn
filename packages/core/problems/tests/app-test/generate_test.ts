import { assertEquals } from "@std/assert";
import {
  type BundleDependency,
  dependenciesHash,
  generateAppTestChecks,
} from "./generate.ts";

function dependencyCheck(
  dependencies: BundleDependency[],
  imports: Record<string, string>,
) {
  const plan = generateAppTestChecks({
    bundle_hash: "bundle",
    test_hash: "test",
    app_api: [],
    data: { schema: 0, previous_schema: null },
    dependencies,
    imports,
    frozen: { sdk_dependencies: dependenciesHash(dependencies) },
  });
  return plan.checks.find((check) => check.name === "dependencies")!
    .precomputed!;
}

Deno.test("선언한 @me package와 내장 SDK의 import는 의존 확인을 통과하고 선언하지 않은 @me import는 걸린다", () => {
  const declared: BundleDependency[] = [
    { name: "@me/date-range", version: "1.0.0", source: "package" },
    { name: "@lophn/ui", version: "0.3.0", source: "sdk" },
  ];
  const cases: [string, Record<string, string>, string[]][] = [
    ["@me", {
      "@me/date-range": "./sdk/@me/date-range/1.0.0/mod.ts",
    }, []],
    ["내장", { "@lophn/ui": "./sdk/ui/0.3.0/mod.ts" }, []],
    ["선언 안 한 @me", {
      "@me/other": "./sdk/@me/other/1.0.0/mod.ts",
    }, ["@me/other"]],
  ];
  for (const [label, imports, undeclared] of cases) {
    const result = dependencyCheck(declared, imports);
    assertEquals(result.evidence.undeclared, undeclared, label);
    assertEquals(
      result.status,
      undeclared.length === 0 ? "pass" : "fail",
      label,
    );
  }
});
