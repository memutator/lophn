import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { commandRequestSchema } from "../platform/mod.ts";
import {
  appArchive,
  appConnectSource,
  appCreate,
  appDisableExecution,
  appEnableExecution,
  appGet,
  appList,
  appSchema,
  appUnarchive,
} from "./mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const app = {
  id: APP,
  slug: "usage-dashboard",
  name: "Usage Dashboard",
  description: "Purpose",
  planning_version: null,
  source_path: null,
  active_release: null,
  revision: "4",
  run_enabled: false,
  status: "active" as const,
};

Deno.test("apps/registration#R4, apps/registration#R8, apps/registration#R10: App revision은 snapshot seq와 별개로 CAS 입력에 보존된다", () => {
  const meta = { as_of_seq: "19", next_cursor: null };
  const get = appGet.output.parse({ ...meta, app });
  const list = appList.output.parse({ ...meta, apps: [app] });
  assertEquals(get.app.revision, "4");
  assertEquals(list.apps[0].revision, "4");
  assertNotEquals(get.app.revision, get.as_of_seq);
  for (
    const route of [
      appCreate,
      appConnectSource,
      appArchive,
      appUnarchive,
      appEnableExecution,
      appDisableExecution,
    ]
  ) {
    assertEquals(route.output.parse(app).revision, "4");
  }
  const request = commandRequestSchema(appArchive).parse({
    input: { app: get.app.id },
    compare: { base_revision: get.app.revision },
    idempotency_key: "archive-usage-dashboard",
    prepared: [],
  });
  assertEquals(request.compare, { base_revision: "4" });
});

Deno.test("apps/registration#R2, apps/registration#R10: App revision 누락·null·0·leading zero는 거절한다", () => {
  const { revision: _revision, ...missingRevision } = app;
  assert(!appSchema.safeParse(missingRevision).success);
  for (const revision of [null, "0", "04", 4]) {
    assert(!appSchema.safeParse({ ...app, revision }).success);
    assert(
      !appGet.output.safeParse({
        as_of_seq: "19",
        next_cursor: null,
        app: { ...app, revision },
      }).success,
    );
  }
});
