import assert from "node:assert/strict";
import { test } from "node:test";
import { dependencyNames } from "../packages/publish.ts";
import {
  missingCapPermission,
  missingSdkPermission,
} from "./sdk-permissions.ts";

const manifest = (dependencies: Record<string, string>) => [
  {
    path: "package.json",
    bytes: new TextEncoder().encode(JSON.stringify({ dependencies })),
  },
];

test("cap-net을 쓰는 @me package는 net.fetch 없이 publish되지 않는다", () => {
  const names = dependencyNames(manifest({ "@lophn/cap-net": "1.0.0" }));
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
