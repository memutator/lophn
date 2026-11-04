import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { createTargetAuthorizer } from "../../storage/ledger/target-authorization.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { type UsagePorts, usagePorts } from "../usage/mod.ts";
import { createDeclarationReads, createToolIndexRead } from "./reads.ts";

const APP_A = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const APP_B = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const AGENT = "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza";

const load: Parameters<typeof createDeclarationReads>[0] = (_sql, app) =>
  ok({
    release: { app },
    declaration: {
      name: `app ${app}`,
      description: "does things",
      operations: [],
      commands: [
        {
          name: "add",
          description: "adds",
          effect: "write",
          public: true,
          inputSchema: { type: "object" },
        },
        {
          name: "secret",
          description: "keeps",
          effect: "read",
          public: false,
          inputSchema: null,
        },
      ],
    },
  } as never);

// session이 놓인 곳만 흉내 낸 usage port다. 모르는 session은 null이다.
const usage = (place: Place | null) =>
  ({
    sessionPlace: (session: string) =>
      session === "ses_01hzzzzzzzzzzzzzzzzzzzzzza" ? { place } : null,
  }) as unknown as UsagePorts;
const port = (ports: UsagePorts) => (key: unknown) =>
  key === usagePorts ? ports : undefined;

// 앱 A에 묶인 agent 자격은 다른 앱의 tool 목록은 읽지만 log·호출 기록은 여전히 not_found다.
// 목록 route가 앱 범위 판정을 하지 않는 것이 log·호출 기록으로 번지면 다른 앱 데이터가 샌다.
test("앱 하나에 묶인 agent 자격은 다른 앱의 tool 목록을 읽지만 다른 앱의 log·호출 기록은 여전히 not_found다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  for (const [id, slug] of [
    [APP_A, "a"],
    [APP_B, "b"],
  ]) {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, run_enabled, revision, status)
       VALUES (?, ?, ?, 'does things', 0, '1', 'active')`,
    ).run(id, slug, `app ${slug}`);
  }
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as never,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as never,
  };
  const reads = { appToolIndex: createToolIndexRead(load) };
  const ctx: RequestContext = {
    principal: AGENT,
    actor: AGENT,
    scope: {
      operations: ["app.tool_index", "app.logs", "app.invocations"],
      targets: {},
    },
    conditions: { app: APP_A },
    credential_ref: "agent",
  };
  const snapshot = { sql, as_of_seq: "1", port: port(usage(null)) } as never;

  const list = reads.appToolIndex.handle(snapshot, ctx, {});
  assert.ok(list.ok);
  assert.deepStrictEqual(
    list.value.apps.map((entry) => entry.app),
    [APP_A, APP_B],
  );
  assert.deepStrictEqual(
    list.value.apps[1].tools.map((t) => t.name),
    ["add"],
  );
  assert.ok(!("inputSchema" in list.value.apps[1].tools[0]));
  const one = reads.appToolIndex.handle(snapshot, ctx, { app: APP_B });
  assert.ok(one.ok);
  assert.deepStrictEqual(one.value.apps[0].tools[0].inputSchema, {
    type: "object",
  });

  const authorize = createTargetAuthorizer(ctx);
  for (const operation of ["app.logs", "app.invocations"]) {
    const denied = authorize(ctx, operation, { app: APP_B });
    assert.ok(!denied.ok);
    assert.deepStrictEqual(denied.error.code, "not_found");
  }
});

// 다른 앱의 비공개 command가 결과에 새면 그 앱 밖 agent가 command 이름과 모양을 얻는다.
// 같은 route를 user token으로도 부르므로 거르는 쪽은 route다.
test("app.tool_index는 agent에게 다른 앱 place의 비공개 command를 싣지 않고 사람에게는 모두 싣는다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  db.prepare(
    `INSERT INTO apps (id, slug, name, description, run_enabled, revision, status)
     VALUES (?, 'a', 'app a', 'does things', 0, '1', 'active')`,
  ).run(APP_A);
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as never,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as never,
  };
  const read = createToolIndexRead(load);
  const names = (actor: string, place: Place | null) => {
    const ctx = {
      principal: actor,
      actor,
      scope: { operations: [], targets: {} },
      conditions: {},
      credential_ref: "c",
    } as RequestContext;
    const snapshot = { sql, as_of_seq: "1", port: port(usage(place)) };
    const got = read.handle(snapshot as never, ctx, {});
    assert.ok(got.ok);
    return got.value.apps[0].tools.map((t) => t.name);
  };
  assert.deepStrictEqual(names(AGENT, { kind: "app", id: APP_A }), [
    "add",
    "secret",
  ]);
  assert.deepStrictEqual(names(AGENT, { kind: "app", id: APP_B }), ["add"]);
  assert.deepStrictEqual(names(AGENT, null), ["add"]);
  assert.deepStrictEqual(names("user", null), ["add", "secret"]);
});
