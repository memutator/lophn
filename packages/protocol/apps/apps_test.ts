import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { ERROR_CODES, ok } from "../../base/mod.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";
import {
  definePort,
  type PortKey,
  type ReadSnapshot,
  type Tx,
} from "../server/mod.ts";
import { eventEnvelopeSchema } from "../events/events.ts";
import { routePath } from "../base/route.ts";
import {
  appArchive,
  appArchived,
  appConnectSource,
  appConnectSourceInputSchema,
  appCreate,
  appCreated,
  appCreateInputSchema,
  appDescriptionSchema,
  appGet,
  appInputSchema,
  appList,
  appListInputSchema,
  appNameSchema,
  type AppRegistrationLookup,
  appRegistrationLookup,
  appRegistrationSchema,
  appSchema,
  appSourceConnected,
  appUnarchive,
  appUnarchived,
} from "./apps.ts";
import { EVENTS, ROUTES } from "./registry.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const VERSION = "ver_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const META = { as_of_seq: "4", next_cursor: null };

const created = {
  id: APP,
  slug: "usage-dashboard",
  name: "MAHAS",
  description: "한 줄 목적",
  planning_version: null,
  source_path: null,
  active_release: null,
  revision: "4",
  run_enabled: false,
  status: "active" as const,
};

Deno.test("apps/registration#R2, apps/registration#R3, apps/registration#R4, apps/registration#R8, apps/registration#R10: route와 event 이름은 architecture 5.4와 같다", () => {
  assertEquals(
    ROUTES.filter((route) =>
      route.resource === "apps" &&
      [
        "create",
        "connect_source",
        "archive",
        "unarchive",
        "list",
        "get",
      ].includes(route.method)
    ).map((route) => [route.kind, routePath(route), route.name]),
    [
      ["command", "/v1/apps/create", "app.create"],
      ["command", "/v1/apps/connect_source", "app.connect_source"],
      ["command", "/v1/apps/archive", "app.archive"],
      ["command", "/v1/apps/unarchive", "app.unarchive"],
      ["read", "/v1/apps/list", "app.list"],
      ["read", "/v1/apps/get", "app.get"],
    ],
  );
  assertEquals(
    EVENTS.filter((event) =>
      [
        "AppCreated",
        "AppSourceConnected",
        "AppArchived",
        "AppUnarchived",
      ].includes(event.type)
    ).map((event) => event.type),
    ["AppCreated", "AppSourceConnected", "AppArchived", "AppUnarchived"],
  );
  assertEquals(appCreate.actors, ["user", "coding_agent"]);
  assertEquals(appConnectSource.actors, ["user", "coding_agent"]);
  assertEquals(appArchive.actors, ["user"]);
  assertEquals(appUnarchive.actors, ["user"]);
  assertEquals(appList.actors, ["user", "coding_agent", "agent", "app"]);
  assertEquals(appGet.name, "app.get");
  assertEquals(appGet.input.parse({ app: APP }), { app: APP });
  assertEquals(appGet.output.parse({ ...META, app: created }).app, created);
  for (const route of ROUTES) {
    assertEquals(ALL_ROUTES.filter((entry) => entry === route).length, 1);
  }
  for (const event of EVENTS) {
    assertEquals(ALL_EVENTS.filter((entry) => entry === event).length, 1);
  }
  for (
    const route of [
      appCreate,
      appConnectSource,
      appArchive,
      appUnarchive,
      appList,
      appGet,
    ]
  ) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("apps/registration#R2, apps/registration#R10: 기획 판 없이 등록하고 project 없이 조회한다", () => {
  const input = appCreateInputSchema.parse({
    slug: "usage-dashboard",
    name: "MAHAS",
    description: "한 줄 목적",
  });
  assertEquals(input.planning_version, undefined);
  assertEquals("project" in input, false);
  const app = appSchema.parse(created);
  assertEquals(app.planning_version, null);
  assertEquals(app.source_path, null);
  assertEquals(app.active_release, null);
  assertEquals(app.run_enabled, false);
  appGet.output.parse({ ...META, app });
  appList.output.parse({ ...META, apps: [app] });
  eventEnvelopeSchema(appCreated).parse({
    seq: "4",
    type: "AppCreated",
    subject: APP,
    actor: "user",
    run: null,
    payload: {
      slug: "usage-dashboard",
      name: "MAHAS",
      description: "한 줄 목적",
    },
    at: AT,
  });
});

Deno.test("apps/registration#R2: 기획 version이 있는 등록도 통과한다", () => {
  const input = appCreateInputSchema.parse({
    slug: "usage-dashboard",
    name: "Usage Dashboard",
    description: "한 줄 목적",
    planning_version: VERSION,
  });
  assertEquals(input.planning_version, VERSION);
  appSchema.parse({ ...created, planning_version: VERSION });
  eventEnvelopeSchema(appCreated).parse({
    seq: "4",
    type: "AppCreated",
    subject: APP,
    actor: "coding_agent:cac_01h455vb4pex5v6nkc6gd5fdw1",
    run: null,
    payload: {
      slug: "usage-dashboard",
      name: "Usage Dashboard",
      description: "한 줄 목적",
      planning_version: VERSION,
    },
    at: AT,
  });
});

Deno.test("apps/registration#R4: git source 절대 경로를 연결한다", () => {
  const input = appConnectSourceInputSchema.parse({
    app: APP,
    source_path: "/home/dev/usage",
  });
  assertEquals(input.source_path, "/home/dev/usage");
  const connected = appSchema.parse({
    ...created,
    source_path: "/home/dev/usage",
    active_release: null,
  });
  assertEquals(connected.active_release, null);
  eventEnvelopeSchema(appSourceConnected).parse({
    seq: "5",
    type: "AppSourceConnected",
    subject: APP,
    actor: "user",
    run: null,
    payload: { source_path: "/home/dev/usage" },
    at: AT,
  });
});

Deno.test("apps/registration#R7: 입력 이름은 보존하고 빈 이름·줄바꿈 목적은 거절한다", () => {
  assertEquals(appNameSchema.parse("MAHAS"), "MAHAS");
  assert(!appNameSchema.safeParse("").success);
  assert(!appDescriptionSchema.safeParse("").success);
  assert(!appDescriptionSchema.safeParse("한 줄\n다음").success);
  assert(
    !appCreateInputSchema.safeParse({
      slug: "usage-dashboard",
      name: "",
      description: "한 줄 목적",
    }).success,
  );
});

Deno.test("apps/registration#R8: archive와 unarchive는 run_enabled false를 싣는다", () => {
  appInputSchema.parse({ app: APP });
  const archived = appSchema.parse({
    ...created,
    status: "archived",
    run_enabled: false,
  });
  assertEquals(archived.run_enabled, false);
  assert(!appSchema.safeParse({ ...archived, run_enabled: true }).success);
  eventEnvelopeSchema(appArchived).parse({
    seq: "6",
    type: "AppArchived",
    subject: APP,
    actor: "user",
    run: null,
    payload: { run_enabled: false },
    at: AT,
  });
  eventEnvelopeSchema(appUnarchived).parse({
    seq: "7",
    type: "AppUnarchived",
    subject: APP,
    actor: "user",
    run: null,
    payload: { run_enabled: false },
    at: AT,
  });
  assert(!appArchived.payload.safeParse({ run_enabled: true }).success);
  assert(!appUnarchived.payload.safeParse({ run_enabled: true }).success);
});

Deno.test("apps/registration#R2, apps/registration#R4, apps/registration#R10: 모르는 field·틀린 값·틀린 ID 접두사를 거절한다", () => {
  assert(
    !appCreateInputSchema.safeParse({
      slug: "usage-dashboard",
      name: "MAHAS",
      description: "한 줄 목적",
      project: "prj_01h455vb4pex5v6nkc6gd5fdw1",
    }).success,
  );
  assert(
    !appCreateInputSchema.safeParse({
      slug: "Usage",
      name: "MAHAS",
      description: "한 줄 목적",
    }).success,
  );
  assert(
    !appCreateInputSchema.safeParse({
      slug: "usage-dashboard",
      name: "MAHAS",
      description: "한 줄 목적",
      planning_version: OTHER,
    }).success,
  );
  assert(
    !appConnectSourceInputSchema.safeParse({
      app: OTHER,
      source_path: "/home/dev/usage",
    }).success,
  );
  assert(
    !appConnectSourceInputSchema.safeParse({
      app: APP,
      source_path: "relative/usage",
    }).success,
  );
  assert(
    !appConnectSourceInputSchema.safeParse({
      app: APP,
      source_path: "/home/dev/usage",
      extra: true,
    }).success,
  );
  assert(!appInputSchema.safeParse({ app: OTHER }).success);
  assert(!appInputSchema.safeParse({ app: APP, extra: true }).success);
  assert(!appListInputSchema.safeParse({ status: "running" }).success);
  assert(!appListInputSchema.safeParse({ extra: true }).success);
  assert(
    appCreateInputSchema.safeParse({
      slug: "a".repeat(63),
      name: "App",
      description: "Purpose",
    }).success,
  );
  assert(
    !appCreateInputSchema.safeParse({
      slug: "a".repeat(64),
      name: "App",
      description: "Purpose",
    }).success,
  );
  assert(!appSchema.safeParse({ ...created, id: OTHER }).success);
});

Deno.test("apps/registration#R10: Tx 안 앱 존재·status·slug 검사는 typed port다", () => {
  assertEquals(appRegistrationLookup.name, "apps.AppRegistrationLookup");
  assertNotStrictEquals(
    appRegistrationLookup,
    definePort<AppRegistrationLookup>(appRegistrationLookup.name),
  );
  const useInTransaction = (tx: Pick<Tx, "port">): AppRegistrationLookup =>
    tx.port(appRegistrationLookup);
  const useInSnapshot = (
    snapshot: Pick<ReadSnapshot, "port">,
  ): AppRegistrationLookup => snapshot.port(appRegistrationLookup);
  const lookup: AppRegistrationLookup = {
    get: (app) =>
      ok(
        app === APP
          ? { id: APP, slug: "usage-dashboard", status: "archived" }
          : null,
      ),
  };
  // fixture만 generic 주입을 흉내 낸다. 앱 구현은 transaction별 port resolver를 쓴다.
  const context: Pick<Tx, "port"> = {
    port: <T>(key: PortKey<T>): T => {
      assertStrictEquals(key, appRegistrationLookup);
      return lookup as T;
    },
  };
  assertStrictEquals(useInTransaction(context), lookup);
  assertStrictEquals(useInSnapshot(context), lookup);
  assertEquals(
    lookup.get(APP),
    ok({
      id: APP,
      slug: "usage-dashboard",
      status: "archived",
    }),
  );
  assertEquals(lookup.get("app_01h455vb4pex5v6nkc6gd5fdw2"), ok(null));
  const found = appRegistrationSchema.parse({
    id: APP,
    slug: "usage-dashboard",
    status: "active",
  });
  assertEquals(found.status, "active");
  assert(
    !appRegistrationSchema.safeParse({
      id: OTHER,
      slug: "usage-dashboard",
      status: "active",
    }).success,
  );
  assert(
    !appRegistrationSchema.safeParse({
      ...found,
      status: "running",
    }).success,
  );
});
