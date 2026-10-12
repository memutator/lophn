// `POST /v1/apps/automations`가 실제 core(임시 LOPHN_HOME)의 reader 등록과 메인 덮기를 지나 닿는지
// 본다. 현재 release 선언 port는 releases 조립(apps#T19)이 reader 등록에 더한다. 선언이 없는 core는
// 선언을 모르는 것이고 보일 automation이 없다(`reads_test.ts`가 선언을 아는 snapshot에서 사실 구분을
// 본다). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { call, command } from "../../testing/approvals-fixture.ts";
import { createCoreHarness } from "../../testing/core.ts";
import { appAutomations } from "../../../protocol/apps/mod.ts";
import {
  blueprint,
  command as releaseCommand,
  prepareInput,
} from "../releases/testing/mod.ts";

Deno.test("apps/automations#R10: apps.automations는 실제 core에서 닿고 선언을 모르면 빈 목록, 범위 밖 앱은 없는 앱과 같다", async () => {
  const documents = await import("../../projects/register.ts");
  const apps = await import("../register.ts");
  const opened = await createCoreHarness({
    io: true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../projects/register.ts", import.meta.url).href,
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const user = await harness.credential({
      actor: "user",
      principal: "user-1",
      scope: {
        operations: ["app.create", appAutomations.name],
        targets: {},
      },
      conditions: {},
    });
    assert(user.ok, user.ok ? "" : user.error.message);
    const created = await call(
      harness,
      "apps/create",
      user.value.token,
      command({ slug: "usage", name: "Usage", description: "usage app" }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = String(created.body["id"]);

    const reply = await call(harness, "apps/automations", user.value.token, {
      app,
    });
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    assert(appAutomations.output.safeParse(reply.body).success);
    assertEquals(reply.body["app"], app);
    assertEquals(reply.body["automations"], []);
    assertEquals(reply.body["observed_at"], null);

    const missing = await call(harness, "apps/automations", user.value.token, {
      app: "app_01h455vb4pex5v6nkc6gd5fdw9",
    });
    assertEquals(missing.status, 404);

    // 이 credential의 scope에 이 read가 없으면 닿지 않는다.
    const narrow = await harness.credential({
      actor: "user",
      principal: "user-2",
      scope: { operations: ["app.create"], targets: {} },
      conditions: {},
    });
    assert(narrow.ok);
    const denied = await call(harness, "apps/automations", narrow.value.token, {
      app,
    });
    assert(denied.status === 403 || denied.status === 404);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/automations#R10, apps/automations#R13: 채택된 release의 automation 선언이 실제 core에서 보이고 external은 켜는 승인 뒤에만 승인 이유가 없어진다", async () => {
  const documents = await import("../../projects/register.ts");
  const apps = await import("../register.ts");
  const fixtures = await import("../releases/testing/mod.ts");
  const opened = await createCoreHarness({
    io: true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      { createLedgerRegistration: fixtures.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../projects/register.ts", import.meta.url).href,
      new URL("../register.ts", import.meta.url).href,
      new URL("../releases/testing/mod.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const login = async (actor: "user" | "machine", operations: string[]) => {
      const issued = await harness.credential({
        actor,
        principal: `${actor}-${operations.length}`,
        scope: { operations, targets: {} },
        conditions: {},
      });
      assert(issued.ok, issued.ok ? "" : issued.error.message);
      return issued.value.token;
    };
    const user = await login("user", [
      "app.create",
      appAutomations.name,
      "app.blueprint",
    ]);
    const machine = await login("machine", [
      "release.prepare",
      "releases.tests.add_verification",
      "releases.tests.adopt",
      "releases.tests.add_grant",
    ]);
    const created = await call(
      harness,
      "apps/create",
      user,
      command({ slug: "usage", name: "Usage", description: "usage app" }),
    );
    const app = String(created.body["id"]);
    // 외부로 보내는 sync를 한 시간마다 도는 automation이다.
    const input = {
      ...prepareInput(blueprint({
        commands: [releaseCommand("sync", "external"), releaseCommand("list")],
        automatic_tasks: [{
          key: "nightly",
          label: "Nightly sync",
          when: { kind: "interval", interval_ms: 3_600_000 },
          command: "sync",
        }],
      })),
      app,
    };
    const vrf = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
    await call(
      harness,
      "releases_tests/add_verification",
      machine,
      command({
        id: vrf,
        app,
        kind: "app_test",
        result: "pass",
        bundle_hash: input.bundle_hash,
      }),
    );
    const prepared = await call(
      harness,
      "releases/prepare",
      machine,
      command({ ...input, tests: [vrf] }),
    );
    assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
    const release = String((prepared.body["release"] as { id: string }).id);
    await call(harness, "releases_tests/adopt", machine, command({ release }));

    // 선언은 있지만 external automation은 켜는 승인이 없어 돌지 않는다.
    const declared = await call(harness, "apps/automations", user, { app });
    assertEquals(declared.status, 200, JSON.stringify(declared.body));
    const [view] = declared.body["automations"] as {
      key: string;
      declared: boolean;
      runnable: boolean;
      release: string;
      reason: { code: string };
    }[];
    assertEquals(
      [view.key, view.declared, view.runnable, view.release],
      ["nightly", true, false, release],
    );
    assertEquals(view.reason.code, "permission_required");

    // 켜는 승인(automation.run grant)은 현재 선언의 정확한 command·고정 입력 hash·주기에 묶인다.
    const blueprintRead = await call(harness, "apps/blueprint", user, { app });
    assertEquals(blueprintRead.status, 200, JSON.stringify(blueprintRead.body));
    const fact = (blueprintRead.body["declarations"] as {
      automations: {
        key: string;
        command: string;
        input_hash: string;
        when: unknown;
      }[];
    }).automations[0];
    await call(
      harness,
      "releases_tests/add_grant",
      machine,
      command({
        id: "grt_01h455vb4pex5v6nkc6gd5fd01",
        app,
        kind: "automation.run",
        scope: {
          automation: fact.key,
          command: fact.command,
          input_hash: fact.input_hash,
          when: fact.when,
        },
        approval: "apr_01h455vb4pex5v6nkc6gd5fd01",
      }),
    );
    const approved = await call(harness, "apps/automations", user, { app });
    const [after] = approved.body["automations"] as {
      reason: { code: string };
    }[];
    // 승인 부족이 아니라 지금 열린 관측이 없다는 이유로 바뀐다. 과거 event로 실행 중이라 하지 않는다.
    assertEquals(after.reason.code, "no_observation");
  } finally {
    await harness.close();
  }
});
