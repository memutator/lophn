import assert from "node:assert/strict";
import { test } from "node:test";

import { appDependencies } from "./dependencies.ts";

test("package.json 의존은 정확한 판과 .lophn/sdk 사본만 bundle 의존이 된다", () => {
  const accepted = appDependencies({
    dependencies: {
      "@lophn/declaration": "file:.lophn/sdk/declaration/1.0.0",
      "@me/date-range": "file:.lophn/sdk/@me/date-range/1.0.0",
      react: "19.3.0",
    },
  });
  assert.ok(accepted.ok);
  assert.deepStrictEqual(accepted.value, [
    {
      name: "@lophn/declaration",
      version: "1.0.0",
      source: "sdk",
    },
    { name: "@me/date-range", version: "1.0.0", source: "package" },
    { name: "react", version: "19.3.0", source: "npm" },
  ]);

  const cases: [string, Record<string, string>, string][] = [
    ["범위", { react: "^19.3.0" }, "range_version"],
    ["tag", { react: "latest" }, "range_version"],
    ["원격", { react: "https://example.invalid/react.tgz" }, "remote_import"],
    ["npm 값", { react: "npm:react@19.3.0" }, "remote_import"],
    ["사본 밖", { react: "file:../react" }, "escaped_relative"],
    ["사본 밖 이름", { react: "file:.lophn/sdk/ui/1.0.0" }, "unknown_sdk"],
    [
      "다른 사본을 가리키는 이름",
      { "@lophn/app-ui": "file:.lophn/sdk/ui/1.0.0" },
      "unknown_sdk",
    ],
  ];
  for (const [label, dependencies, reason] of cases) {
    const rejected = appDependencies({ dependencies });
    assert.deepStrictEqual(rejected.ok, false, label);
    assert.deepStrictEqual(
      rejected.ok ? "" : rejected.error.reason,
      reason,
      label,
    );
  }
});

test("devDependencies도 같은 규칙이고 같은 이름이면 dependencies가 이긴다", () => {
  const found = appDependencies({
    devDependencies: { "@types/react": "19.3.0", react: "18.0.0" },
    dependencies: { react: "19.3.0" },
  });
  assert.ok(found.ok);
  assert.deepStrictEqual(found.value, [
    { name: "@types/react", version: "19.3.0", source: "npm" },
    { name: "react", version: "19.3.0", source: "npm" },
  ]);
});
