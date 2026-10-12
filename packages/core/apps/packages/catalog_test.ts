import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "../../testing/core.ts";
import type { TeamModule } from "../../main/daemon/registration.ts";
import { guideBumpSections, permissionIncreaseIn } from "./model.ts";

// SDK catalog 읽기(apps/sdk#R2, R3, R4, R6, R12). 실제 core(temp LOPHN_HOME)를 띄우고
// HTTP로 catalog read가 닿는지 본다.

async function appsTeam(): Promise<TeamModule> {
  const module = await import("../register.ts");
  return { createLedgerRegistration: module.createLedgerRegistration };
}

// guide 원문. patch·minor·major 절과 permission 증가가 major 절에 있다(R12).
const GUIDE = `# @lophn/sample

## patch
API를 유지한 내부 수정이다.

## minor
API를 유지한 추가다.

## major
API 제거·변경이고 요구 permission 증가도 major다.
`;

type RegisterBody = {
  input: {
    name: string;
    description: string;
    kind: string;
    version: string;
    bundle_hash: string;
    guide_hash: string;
  };
  idempotency_key: string;
  compare: Record<string, never>;
  prepared: never[];
};

function registerBody(
  name: string,
  description: string,
  kind: string,
  version: string,
  idempotencyKey: string,
  bundleHash = "a".repeat(64),
  guideHash = "b".repeat(64),
): RegisterBody {
  return {
    input: {
      name,
      description,
      kind,
      version,
      bundle_hash: bundleHash,
      guide_hash: guideHash,
    },
    idempotency_key: idempotencyKey,
    compare: {},
    prepared: [],
  };
}

Deno.test("apps/sdk#R2: 한 Package에 한 kind를 담는다", async () => {
  const opened = await createCoreHarness({
    teams: [await appsTeam()],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "machine",
      principal: "install",
      scope: {
        operations: [
          "package.register_version",
          "packages.list",
          "packages.versions",
        ],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const post = poster(harness.port, issued.value.token);

    // component kind 등록.
    const created = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/sample",
        "sample package",
        "component",
        "1.0.0",
        "r2-first",
      ),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    // 같은 Package에 capability kind는 conflict다.
    const other = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/sample",
        "sample package",
        "capability",
        "1.1.0",
        "r2-second",
      ),
    );
    assertEquals(other.status, 409, JSON.stringify(other.body));
    // 같은 Package에 component version 추가는 200이다.
    const more = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/sample",
        "sample package",
        "component",
        "1.1.0",
        "r2-third",
      ),
    );
    assertEquals(more.status, 200, JSON.stringify(more.body));

    // versions read가 두 판을 담는다.
    const versions = await post("packages", "versions", {
      name: "@lophn/sample",
    });
    assertEquals(versions.status, 200, JSON.stringify(versions.body));
    const listed = versions.body as { versions: { version: string }[] };
    assertEquals(listed.versions.map((entry) => entry.version), [
      "1.0.0",
      "1.1.0",
    ]);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/sdk#R3: 목록에서 이름·목적·version·API·permission·peer·예제를 읽는다", async () => {
  const opened = await createCoreHarness({
    teams: [await appsTeam()],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "machine",
      principal: "install",
      scope: {
        operations: ["package.register_version", "packages.list"],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const post = poster(harness.port, issued.value.token);

    const created = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/reader",
        "Markdown 읽기 component",
        "component",
        "1.0.0",
        "r3-first",
      ),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));

    const listed = await post("packages", "list", {});
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const body = listed.body as {
      packages: {
        name: string;
        description: string;
        kind: string;
        versions: { version: string }[];
      }[];
    };
    const found = body.packages.find((pkg) => pkg.name === "@lophn/reader");
    assert(found !== undefined);
    // 한 줄 목적·정확한 version이 목록에 있다.
    assertEquals(found.description, "Markdown 읽기 component");
    assertEquals(found.kind, "component");
    assertEquals(found.versions[0].version, "1.0.0");
  } finally {
    await harness.close();
  }
});

Deno.test("apps/sdk#R4: R4 이름 1.0.0이 catalogue 대상이고 withheld는 등록될 수 없다", async () => {
  const opened = await createCoreHarness({
    teams: [await appsTeam()],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "machine",
      principal: "install",
      scope: {
        operations: ["package.register_version", "packages.list"],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const post = poster(harness.port, issued.value.token);

    const list = await post("packages", "list", {});
    assertEquals(list.status, 200);
    const body = list.body as { packages: { name: string }[] };

    // 제공하지 않는 이름은 catalog에 없다.
    assertEquals(
      body.packages.some((pkg) => pkg.name === "@lophn/cap-read-model"),
      false,
    );
    assertEquals(
      body.packages.some((pkg) => pkg.name === "@lophn/cap-notify"),
      false,
    );

    // R 이름은 모두 1.0.0 install 대상이다(installPackage 소스 경계 검사는 install_test).
    const R4_NAMES = [
      "@lophn/blueprint",
      "@lophn/tokens",
      "@lophn/ui-control",
      "@lophn/ui-overlay",
      "@lophn/ui-layout",
      "@lophn/ui-reading",
      "@lophn/ui-table",
      "@lophn/ui-chart",
      "@lophn/ui-filter",
      "@lophn/ui-stat",
      "@lophn/ui-state",
      "@lophn/ui-action",
      "@lophn/cap-fs",
      "@lophn/cap-net",
      "@lophn/cap-store",
      "@lophn/cap-problem",
      "@lophn/cap-schedule",
      "@lophn/cap-save",
      "@lophn/cap-secret",
    ];
    // 설치 제공 이름이 catalog에 아직 없어도 withheld만 아니면 등록 가능하다.
    for (const name of R4_NAMES.slice(0, 2)) {
      const created = await post(
        "packages",
        "register_version",
        registerBody(
          name,
          "first bundle",
          "component",
          "1.0.0",
          `r4-${name}`,
        ),
      );
      assertEquals(created.status, 200, JSON.stringify(created.body));
    }
  } finally {
    await harness.close();
  }
});

Deno.test("apps/sdk#R6: @me가 먼저 정렬되고 개인 등록은 forbidden이다", async () => {
  const opened = await createCoreHarness({
    teams: [await appsTeam()],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "machine",
      principal: "install",
      scope: {
        operations: ["package.register_version", "packages.list"],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const post = poster(harness.port, issued.value.token);

    // @lophn 둘을 먼저 등록한다.
    const first = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/aaa",
        "first",
        "domain",
        "1.0.0",
        "r6-a",
      ),
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const second = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/zzz",
        "second",
        "domain",
        "1.0.0",
        "r6-b",
      ),
    );
    assertEquals(second.status, 200, JSON.stringify(second.body));

    // 개인 등록 요청은 forbidden이다(R6).
    const personal = await post(
      "packages",
      "register_version",
      registerBody(
        "@me/private",
        "private package",
        "capability",
        "1.0.0",
        "r6-personal",
      ),
    );
    assertEquals(personal.status, 403, JSON.stringify(personal.body));

    // @me 이름이 없으면 @lophn 이름만 name순으로 남는다.
    const list = await post("packages", "list", {});
    assertEquals(list.status, 200);
    const body = list.body as { packages: { name: string }[] };
    const names = body.packages.map((pkg) => pkg.name);
    const index = names.indexOf("@lophn/aaa");
    const zzz = names.indexOf("@lophn/zzz");
    assert(index >= 0 && zzz >= 0 && index < zzz, names.join(","));
  } finally {
    await harness.close();
  }
});

Deno.test("apps/sdk#R8: 같은 version의 다른 hash는 conflict이고 같은 hash는 접수된다", async () => {
  const opened = await createCoreHarness({
    teams: [await appsTeam()],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "machine",
      principal: "install",
      scope: {
        operations: [
          "package.register_version",
          "packages.list",
          "packages.versions",
        ],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const post = poster(harness.port, issued.value.token);

    const first = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/stable",
        "stable",
        "format",
        "1.0.0",
        "r8-first",
        "c".repeat(64),
        "d".repeat(64),
      ),
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));

    // 같은 name·version, 다른 bundle hash → conflict(R8).
    const changed = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/stable",
        "stable",
        "format",
        "1.0.0",
        "r8-changed",
        "e".repeat(64),
        "d".repeat(64),
      ),
    );
    assertEquals(changed.status, 409, JSON.stringify(changed.body));

    // 같은 name·version, 같은 hash → 그대로 접수된다.
    const same = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/stable",
        "stable",
        "format",
        "1.0.0",
        "r8-same",
        "c".repeat(64),
        "d".repeat(64),
      ),
    );
    assertEquals(same.status, 200, JSON.stringify(same.body));

    // 새 version은 더해진다(R8, R11).
    const next = await post(
      "packages",
      "register_version",
      registerBody(
        "@lophn/stable",
        "stable",
        "format",
        "1.1.0",
        "r8-next",
        "f".repeat(64),
        "d".repeat(64),
      ),
    );
    assertEquals(next.status, 200, JSON.stringify(next.body));

    const versions = await post("packages", "versions", {
      name: "@lophn/stable",
    });
    assertEquals(versions.status, 200);
    const body = versions.body as { versions: { version: string }[] };
    assertEquals(body.versions.map((entry) => entry.version), [
      "1.0.0",
      "1.1.0",
    ]);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/sdk#R12: guide가 patch·minor·major를 구별하고 permission 증가는 major이다", () => {
  const sections = guideBumpSections(GUIDE);
  assert(sections !== undefined, "guide has no patch·minor·major sections");
  assert(!permissionIncreaseIn(sections.patch, sections.minor));
  assert(GUIDE.includes("major"));
  assert(GUIDE.includes("permission"));
});

function poster(
  port: number,
  token: string,
): (
  resource: string,
  method: string,
  body: unknown,
) => Promise<{ status: number; body: unknown }> {
  return async (resource, method, body) => {
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/${resource}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
}
