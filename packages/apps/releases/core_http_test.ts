// 실제 core(임시 LOPHN_HOME)의 command·reader 등록을 지나 release 준비 확정과 읽기
// (`releases/{prepare,list,get,compare}`, `apps/blueprint`)가 닿는지 본다. 현재 release 선언 port와
// 같은 transaction의 app test 확인도 제품 등록 그대로다. activation(apps#T18)은 시험 team이 채택 참조만
// 대신한다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  call,
  codeOf,
  command,
} from "../../../apps/core/testing/approvals-fixture.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../../apps/core/testing/core.ts";
import {
  appBlueprint,
  releasesCompare,
  releasesGet,
  releasesList,
} from "../../protocol/apps/mod.ts";
import {
  blueprint,
  command as declared,
  prepareInput,
  VRF,
} from "./testing/mod.ts";

async function open(): Promise<CoreHarness> {
  const documents = await import("../../../apps/core/documents.ts");
  const apps = await import("../../../apps/core/apps.ts");
  const fixtures = await import("./testing/mod.ts");
  const opened = await createCoreHarness({
    io: true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      { createLedgerRegistration: fixtures.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../../apps/core/apps.ts", import.meta.url).href,
      new URL("./testing/mod.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  return opened.value;
}

async function login(
  harness: CoreHarness,
  actor: "user" | "machine",
  operations: string[],
  conditions: Record<string, string> = {},
): Promise<string> {
  const issued = await harness.credential({
    actor,
    principal: `${actor}-${operations.length}-${
      Object.keys(conditions).length
    }`,
    scope: { operations, targets: {} },
    conditions,
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value.token;
}

const USER = [
  "app.create",
  appBlueprint.name,
  releasesList.name,
  releasesGet.name,
  releasesCompare.name,
];
const MACHINE = [
  "release.prepare",
  "releases.tests.add_verification",
  "releases.tests.adopt",
];

Deno.test("apps/releases#R5, apps/blueprint#R2: 실제 core에서 같은 hash의 test 뒤 준비되고 채택된 release의 blueprint를 읽는다", async () => {
  const harness = await open();
  try {
    const user = await login(harness, "user", USER);
    const machine = await login(harness, "machine", MACHINE);
    const created = await call(
      harness,
      "apps/create",
      user,
      command({
        slug: "calendar",
        name: "Calendar",
        description: "a calendar",
      }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = String(created.body["id"]);
    const input = {
      ...prepareInput(blueprint({ commands: [declared("list")] })),
      app,
    };
    // blueprint는 앱 ID를 받아 검증하므로 이 앱의 정규형으로 다시 만든다.
    const fixed = { ...input, tests: [VRF] };

    // 같은 hash의 통과한 test가 없으면 준비되지 않는다.
    const untested = await call(
      harness,
      "releases/prepare",
      machine,
      command(fixed),
    );
    assertEquals(
      codeOf(untested),
      "invalid_input",
      JSON.stringify(untested.body),
    );

    const stored = await call(
      harness,
      "releases_tests/add_verification",
      machine,
      command({
        id: VRF,
        app,
        kind: "app_test",
        result: "pass",
        bundle_hash: String(fixed.bundle_hash),
      }),
    );
    assertEquals(stored.status, 200, JSON.stringify(stored.body));
    const prepared = await call(
      harness,
      "releases/prepare",
      machine,
      command(fixed),
    );
    assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
    const release = prepared.body["release"] as Record<string, unknown>;
    assertEquals(release["status"], "prepared");
    assertEquals(release["tests"], [VRF]);

    // 채택 전에는 blueprint가 없는 앱과 같은 not_found다.
    const before = await call(harness, "apps/blueprint", user, { app });
    assertEquals(before.status, 404);

    const adopted = await call(
      harness,
      "releases_tests/adopt",
      machine,
      command({ release: release["id"] }),
    );
    assertEquals(adopted.status, 200, JSON.stringify(adopted.body));
    const read = await call(harness, "apps/blueprint", user, { app });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    assert(appBlueprint.output.safeParse(read.body).success);
    assertEquals(read.body["release"], release["id"]);
    assertEquals(
      (read.body["commands"] as { key: string }[]).map((c) => c.key),
      ["list"],
    );

    const listed = await call(harness, "releases/list", user, { app });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    assertEquals((listed.body["releases"] as unknown[]).length, 1);
    const got = await call(harness, "releases/get", user, {
      release: release["id"],
    });
    assertEquals((got.body["release"] as { status: string }).status, "active");
    const compared = await call(harness, "releases/compare", user, {
      release: release["id"],
    });
    assertEquals(compared.status, 200, JSON.stringify(compared.body));
    assert(releasesCompare.output.safeParse(compared.body).success);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/releases#R1, apps/blueprint#R2: 범위 밖 앱의 release와 blueprint는 없는 것과 같은 답이다", async () => {
  const harness = await open();
  try {
    const user = await login(harness, "user", USER);
    const machine = await login(harness, "machine", MACHINE);
    const ids: string[] = [];
    for (const slug of ["calendar", "notes"]) {
      const created = await call(
        harness,
        "apps/create",
        user,
        command({ slug, name: slug, description: `${slug} app` }),
      );
      ids.push(String(created.body["id"]));
    }
    const [mine, theirs] = ids;
    const releases: string[] = [];
    const tests = [VRF, "vrf_01h455vb4pex5v6nkc6gd5fdw8"];
    for (const [index, app] of ids.entries()) {
      const input = {
        ...prepareInput(blueprint()),
        app,
        tests: [tests[index]],
      };
      await call(
        harness,
        "releases_tests/add_verification",
        machine,
        command({
          id: tests[index],
          app,
          kind: "app_test",
          result: "pass",
          bundle_hash: String(input.bundle_hash),
        }),
      );
      const prepared = await call(
        harness,
        "releases/prepare",
        machine,
        command(input),
      );
      assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
      const release = String((prepared.body["release"] as { id: string }).id);
      releases.push(release);
      await call(
        harness,
        "releases_tests/adopt",
        machine,
        command({ release }),
      );
    }
    const scoped = await login(harness, "user", USER, { app: theirs });
    const outside = await call(harness, "apps/blueprint", scoped, {
      app: mine,
    });
    const absent = await call(harness, "apps/blueprint", scoped, {
      app: "app_01h455vb4pex5v6nkc6gd5fdw9",
    });
    assertEquals(outside.status, 404);
    assertEquals(outside, absent);
    const got = await call(harness, "releases/get", scoped, {
      release: releases[0],
    });
    assertEquals(got.body["release"], null);
    // 범위 안 앱의 release는 그대로 보인다.
    const own = await call(harness, "releases/get", scoped, {
      release: releases[1],
    });
    assertEquals((own.body["release"] as { id: string }).id, releases[1]);
    const gone = await call(harness, "releases/get", scoped, {
      release: "rel_01h455vb4pex5v6nkc6gd5fdw9",
    });
    assertEquals(got.body["release"], gone.body["release"]);
    const listed = await call(harness, "releases/list", scoped, {});
    assertEquals(
      (listed.body["releases"] as { id: string }[]).map((r) => r.id),
      [releases[1]],
    );
    const compare = await call(harness, "releases/compare", scoped, {
      release: releases[0],
    });
    assertEquals(compare.status, 404);
  } finally {
    await harness.close();
  }
});
