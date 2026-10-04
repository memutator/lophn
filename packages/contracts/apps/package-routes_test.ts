import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "../platform/events.ts";
import { routePath } from "../platform/route.ts";
import {
  PACKAGE_EVENTS,
  PACKAGE_ROUTES,
  packageRegisterVersion,
  packageRegisterVersionInputSchema,
  packagesGuide,
  packagesListInputSchema,
  packagesListOutputSchema,
  packagesUsage,
  packagesVersions,
  packageUsageSchema,
  packageVersionRegistered,
} from "./package-routes.ts";
import { EVENTS, ROUTES } from "./registry.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const PKG = "pkg_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const META = { as_of_seq: "8", next_cursor: null };

const registerInput = {
  name: "@lophn/cap-fs",
  description: "Reads granted files",
  kind: "capability" as const,
  version: "1.0.0",
  bundle_hash: "ab".repeat(32),
  guide_hash: "cd".repeat(32),
};

Deno.test("apps/sdk#R3, apps/sdk#R6, apps/sdk#R7: route와 event 이름은 architecture 5.4와 같다", () => {
  assertEquals(
    PACKAGE_ROUTES.map((route) => [route.kind, routePath(route), route.name]),
    [
      [
        "command",
        "/v1/packages/register_version",
        "package.register_version",
      ],
      ["read", "/v1/packages/list", "packages.list"],
      ["read", "/v1/packages/versions", "packages.versions"],
      ["worker", "/v1/packages/guide", "packages.guide"],
      ["read", "/v1/packages/usage", "packages.usage"],
    ],
  );
  assertEquals(
    PACKAGE_EVENTS.map((event) => event.type),
    ["PackageVersionRegistered"],
  );
  assertEquals(
    ROUTES.filter((route) => route.resource === "packages").length,
    PACKAGE_ROUTES.length,
  );
  assertEquals(
    ROUTES.filter((route) => route.resource === "packages").map((route) =>
      route.name
    ),
    PACKAGE_ROUTES.map((route) => route.name),
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Package")).map((event) =>
      event.type
    ),
    ["PackageVersionRegistered"],
  );
  assertEquals(packageRegisterVersion.actors, ["machine"]);
  assertEquals(
    packageRegisterVersion.errors,
    ["forbidden", "invalid_input", "conflict"],
  );
  for (const route of PACKAGE_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("apps/sdk#R7, apps/sdk#R8: register_version 입력은 정확한 SemVer와 해시만 받는다", () => {
  const input = packageRegisterVersionInputSchema.parse(registerInput);
  assertEquals(input.version, "1.0.0");
  assertEquals(input.bundle_hash, "ab".repeat(32));
  // range·latest·암묵적 최신은 거절한다.
  for (const version of ["^1.0.0", "~1.0.0", "latest", "1.0"]) {
    assert(
      !packageRegisterVersionInputSchema.safeParse({
        ...registerInput,
        version,
      }).success,
    );
  }
  // 잘못된 hash는 거절한다.
  assert(
    !packageRegisterVersionInputSchema.safeParse({
      ...registerInput,
      bundle_hash: "ZZ".repeat(32),
    }).success,
  );
  // 모르는 field는 거절한다.
  assert(
    !packageRegisterVersionInputSchema.safeParse({
      ...registerInput,
      id: PKG,
    }).success,
  );
  // 빈 목적·줄바꿈 목적은 거절한다.
  assert(
    !packageRegisterVersionInputSchema.safeParse({
      ...registerInput,
      description: "   ",
    }).success,
  );
  assert(
    !packageRegisterVersionInputSchema.safeParse({
      ...registerInput,
      description: "한 줄\n다음",
    }).success,
  );
});

Deno.test("apps/sdk#R3, apps/sdk#R6: 목록·versions·usage는 공개 이름과 정확한 version으로 찾는다", () => {
  const page = packagesListOutputSchema.parse({
    ...META,
    packages: [{
      id: PKG,
      name: "@lophn/cap-fs",
      description: "Reads granted files",
      kind: "capability",
      versions: [{
        version: "1.0.0",
        bundle_hash: "ab".repeat(32),
        guide_hash: "cd".repeat(32),
      }],
    }],
  });
  assertEquals(page.packages.length, 1);
  packagesListInputSchema.parse({ name: "@lophn/cap-fs", limit: 100 });
  assert(!packagesListInputSchema.safeParse({ name: "@other/cap-fs" }).success);
  assert(!packagesListInputSchema.safeParse({ limit: 201 }).success);
  // 사용처는 release의 고정 의존으로 찾는다(apps/sdk#R6).
  const usage = packageUsageSchema.parse({ app: APP, release: REL });
  assertEquals(usage.app, APP);
  assertEquals(usage.release, REL);
  packagesUsage.input.parse({ name: "@lophn/cap-fs", version: "1.0.0" });
  assert(!packagesUsage.input.safeParse({ name: "@lophn/cap-fs" }).success);
  assert(
    !packagesUsage.input.safeParse({ name: "@lophn/cap-fs", version: "^1.0.0" })
      .success,
  );
  packagesVersions.input.parse({ name: "@lophn/cap-fs" });
  packagesGuide.input.parse({ name: "@lophn/cap-fs", version: "1.0.0" });
});

Deno.test("apps/sdk#R7: PackageVersionRegistered payload는 정확한 version·hash를 찾는다", () => {
  eventEnvelopeSchema(packageVersionRegistered).parse({
    seq: "8",
    type: "PackageVersionRegistered",
    subject: PKG,
    actor: "machine",
    run: null,
    payload: {
      name: "@lophn/cap-fs",
      kind: "capability",
      version: "1.0.0",
      bundle_hash: "ab".repeat(32),
      guide_hash: "cd".repeat(32),
    },
    at: AT,
  });
  // 잘못된 subject 접두사와 range version은 거절한다.
  assert(
    !packageVersionRegistered.subject.safeParse(APP).success,
  );
  assert(
    !packageVersionRegistered.payload.safeParse({
      name: "@lophn/cap-fs",
      kind: "capability",
      version: "^1.0.0",
      bundle_hash: "ab".repeat(32),
      guide_hash: "cd".repeat(32),
    }).success,
  );
  // payload는 출력 value라 모르는 field도 받는다(platform/api#R6 덧붙는 출력).
  assertEquals(
    packageVersionRegistered.payload.safeParse({
      name: "@lophn/cap-fs",
      kind: "capability",
      version: "1.0.0",
      bundle_hash: "ab".repeat(32),
      guide_hash: "cd".repeat(32),
      approved: true,
    }).success,
    true,
  );
  // 잘못된 hash는 여전히 거절한다.
  assert(
    !packageVersionRegistered.payload.safeParse({
      name: "@lophn/cap-fs",
      kind: "capability",
      version: "1.0.0",
      bundle_hash: "ZZ".repeat(32),
      guide_hash: "cd".repeat(32),
    }).success,
  );
});
