// `POST /v1/apps/automations`가 실제 core(임시 LOPHN_HOME)의 reader 등록과 메인 덮기를 지나 닿는지
// 본다. 현재 release 선언 port는 releases 조립(apps#T19)이 reader 등록에 더한다. 그 전의 core는
// 선언을 모르는 것이고 보일 automation이 없다(`reads_test.ts`가 선언을 아는 snapshot에서 사실 구분을
// 본다). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { call, command } from "../../../apps/core/testing/approvals-fixture.ts";
import { createCoreHarness } from "../../../apps/core/testing/core.ts";
import { appAutomations } from "../../contracts/apps/mod.ts";

Deno.test("apps/automations#R10: apps.automations는 실제 core에서 닿고 선언을 모르면 빈 목록, 범위 밖 앱은 없는 앱과 같다", async () => {
  const documents = await import("../../../apps/core/documents.ts");
  const apps = await import("../../../apps/core/apps.ts");
  const opened = await createCoreHarness({
    io: true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../../apps/core/apps.ts", import.meta.url).href,
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
