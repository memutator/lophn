import { assert, assertEquals } from "@std/assert";
import { packageSchema, packageVersionNameSchema } from "./packages.ts";

Deno.test("apps/sdk#R2: a package has one component capability domain or format kind", () => {
  const value = packageSchema.parse({
    id: "pkg_01aryz6s41s4z4k7p41s4z4k7p",
    name: "@lophn/cap-fs",
    description: "Reads granted files",
    kind: "capability",
    versions: [{
      version: "1.0.0",
      bundle_hash: "ab".repeat(32),
      guide_hash: "cd".repeat(32),
    }],
  });
  assertEquals(value.kind, "capability");
  assertEquals(value.versions[0]?.version, "1.0.0");
  assert(packageSchema.safeParse({ ...value, kind: "both" }).success === false);
  assert(
    !packageSchema.safeParse({ ...value, id: "app_01aryz6s41s4z4k7p41s4z4k7p" })
      .success,
  );
  assert(!packageSchema.safeParse({ ...value, description: "   " }).success);
  assert(!packageSchema.safeParse({ ...value, versions: [] }).success);
  assert(
    !packageSchema.safeParse({
      ...value,
      versions: [...value.versions, ...value.versions],
    }).success,
  );
  assert(
    packageSchema.safeParse({
      ...value,
      later: true,
      versions: value.versions.map((version) => ({ ...version, later: true })),
    }).success,
  );
});

Deno.test("apps/sdk#R7: only one exact SemVer is accepted", () => {
  assert(packageVersionNameSchema.safeParse("1.0.0").success);
  for (const version of ["1.0.0-0", "1.0.0-alpha.0", "1.0.0+build.01"]) {
    assertEquals(packageVersionNameSchema.safeParse(version).success, true);
  }
  for (
    const version of [
      "^1.0.0",
      "~1.0.0",
      "latest",
      "01.0.0",
      "1.0",
      "1.0.0-01",
      "1.0.0-alpha.01",
    ]
  ) {
    assertEquals(packageVersionNameSchema.safeParse(version).success, false);
  }
});
