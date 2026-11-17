import assert from "node:assert/strict";
import { test } from "node:test";
import { dependencyVersions } from "../packages/publish.ts";
import {
  missingCapPermission,
  missingSdkPermission,
  missingUserPackagePermission,
} from "./sdk-permissions.ts";

const manifest = (dependencies: Record<string, string>) => [
  {
    path: "package.json",
    bytes: new TextEncoder().encode(JSON.stringify({ dependencies })),
  },
];

test("cap-net을 쓰는 @me package는 net.fetch 없이 publish되지 않는다", () => {
  const names = dependencyVersions(manifest({ "@lophn/cap-net": "1.0.0" })).map(
    (dependency) => dependency.name,
  );
  const missing = missingCapPermission(names, new Set(), "package permissions");
  assert.equal(missing?.package, "@lophn/cap-net");
  assert.match(missing?.message ?? "", /net\.fetch/);
  assert.equal(
    missingCapPermission(names, new Set(["net.fetch"]), "package permissions"),
    undefined,
  );
});

test("@me 의존의 permission이 소비 앱 선언에 없으면 release가 거절된다", () => {
  const declaration = (kinds: string[]) =>
    ({
      sdk_dependencies: [{ name: "@me/foo", version: "1.2.0" }],
      permissions: kinds.map((kind) => ({ kind })),
    }) as never;
  const catalog = new Map([["@me/foo@1.2.0", ["net.fetch"]]]);
  const missing = missingSdkPermission(declaration([]), catalog);
  assert.equal(
    missing?.message,
    "@me/foo@1.2.0 needs net.fetch in the declaration permissions",
  );
  assert.equal(
    missingSdkPermission(declaration(["net.fetch"]), catalog),
    undefined,
  );
});

// 지우면 net.fetch를 적은 `@me/b`에 기대는 `@me/a`가 net.fetch 없이 나가고, 그것만 쓰는 앱은 실행 중 거절된다.
test("@me 의존의 permission을 덮지 않은 @me package는 publish되지 않는다", () => {
  const dependencies = dependencyVersions(manifest({ "@me/b": "2.0.0" }));
  const catalog = new Map([["@me/b@2.0.0", ["net.fetch"]]]);
  const missing = missingUserPackagePermission(
    dependencies,
    catalog,
    new Set(),
    "package permissions",
  );
  assert.equal(
    missing?.message,
    "@me/b@2.0.0 needs net.fetch in the package permissions",
  );
  assert.equal(
    missingUserPackagePermission(
      dependencies,
      catalog,
      new Set(["net.fetch"]),
      "package permissions",
    ),
    undefined,
  );
});
