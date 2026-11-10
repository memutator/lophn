import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import type { AppDeclaration } from "../declaration/mod.ts";
import { createEventDelivery, createEventPublisher } from "./publish.ts";
import { eventPublicationSchemaSteps } from "./schema.ts";

const appId = (suffix: string) => `app_${"0".repeat(24)}${suffix}` as Id<"app">;
const PUBLISHER = appId("p1");
const SUBSCRIBER = appId("s1");
const OFFLINE = appId("f1");
// 화면만 구독하는 앱(process가 떠 있고 handler를 등록하지 않았다). process 전달 대상이 아니라 reachable도 unreachable도 아니다.
const VIEW_ONLY = appId("f2");
const OTHER = appId("x1");

function release(app: string, declaration: object) {
  return {
    app,
    id: `rel_${app.slice(4)}`,
    declaration: JSON.stringify(declaration),
  };
}

const publisherDeclaration = {
  events: [
    {
      name: "usage.limit",
      description: "A usage limit was reached.",
      payloadSchema: {
        type: "object",
        properties: { percent: { type: "integer", description: "Percent." } },
        required: ["percent"],
        additionalProperties: false,
      },
    },
  ],
} as unknown as AppDeclaration;

function setup(ancestry: Id<"app">[] = []) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE apps (id TEXT PRIMARY KEY, status TEXT);
     CREATE TABLE releases (id TEXT PRIMARY KEY, app TEXT, status TEXT, declaration TEXT);`,
  );
  db.exec(eventPublicationSchemaSteps[0].sql);
  const addApp = (app: string, declaration: object) => {
    db.prepare("INSERT INTO apps VALUES (?, 'active')").run(app);
    const row = release(app, declaration);
    db.prepare("INSERT INTO releases VALUES (?, ?, 'active', ?)").run(
      row.id,
      row.app,
      row.declaration,
    );
  };
  const subscription = (source: string, event: string) => ({
    subscriptions: [{ source, event }],
  });
  addApp(PUBLISHER, publisherDeclaration);
  addApp(SUBSCRIBER, subscription("masup", "usage.limit"));
  addApp(OFFLINE, subscription("masup", "usage.limit"));
  addApp(VIEW_ONLY, subscription("masup", "usage.limit"));
  // 다른 event를 구독한 앱과 아무것도 구독하지 않은 앱은 받지 않는다.
  addApp(appId("e1"), subscription("masup", "other.event"));
  addApp(OTHER, {});
  const sql: Pick<Sql, "get" | "all"> = {
    get: (query, params = []) =>
      db.prepare(query).get(...(params as SQLInputValue[])) as never,
    all: (query, params = []) =>
      db.prepare(query).all(...(params as SQLInputValue[])) as never,
  };
  const delivered: { name: string; input: unknown; caller: unknown }[] = [];
  const clock = manualClock(Date.parse("2026-11-10T00:00:00.000Z"));
  const delivery = createEventDelivery({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    random: seededRandom(2),
    activeTraceId: () => undefined,
    sql,
    transaction: (fn) =>
      fn({
        sql: {
          run: (query: string, params: SQLInputValue[] = []) =>
            db.prepare(query).run(...params),
        },
      } as unknown as Tx),
    running: (app) =>
      Promise.resolve(
        app === OFFLINE ? "down" : app === VIEW_ONLY ? "none" : "running",
      ),
    async deliver(input) {
      delivered.push({
        name: input.name,
        input: input.input,
        caller: input.caller,
      });
      return {
        ok: true,
        value: { invocation: null, outcome: undefined as never },
      };
    },
    announce() {},
    failed() {},
  });
  const publish = createEventPublisher({
    delivery,
    app: (id) => ({
      ok: true,
      value: id === PUBLISHER ? { slug: "masup", archived: false } : null,
    }),
    activeDeclaration: () => ({
      ok: true,
      value: {
        release: `rel_${PUBLISHER.slice(4)}` as Id<"rel">,
        declaration: publisherDeclaration,
      },
    }),
    flight: () => undefined,
    ancestry: () => ancestry,
  });
  const ctx = { actor: `app:${PUBLISHER}` } as unknown as RequestContext;
  return {
    db,
    delivered,
    publish: (body: unknown) => publish(ctx, body as never),
  };
}

test("선언하지 않은 event와 schema에 맞지 않는 payload는 invalid_input이고 아무에게도 가지 않으며 기록도 없다", async () => {
  const { db, delivered, publish } = setup();
  for (const body of [
    { event: "undeclared.event", payload: {}, parent_invocation: null },
    {
      event: "usage.limit",
      payload: { percent: "high" },
      parent_invocation: null,
    },
    { event: "usage.limit", payload: {}, parent_invocation: null },
  ]) {
    const result = await publish(body);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "invalid_input");
  }
  assert.equal(delivered.length, 0);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM app_event_publications").get()?.n,
    0,
  );
});

test("event는 그 (source, event)를 구독으로 선언한 켜진 앱에만 가고 켜지지 않은 구독자는 닿지 못한 수로 남으며 payload는 기록되지 않는다", async () => {
  const { db, delivered, publish } = setup();
  const result = await publish({
    event: "usage.limit",
    payload: { percent: 91 },
    parent_invocation: null,
  });
  assert.ok(result.ok);
  const output = result.value as {
    reachable: number;
    unreachable: number;
    refused: number;
  };
  assert.deepStrictEqual(
    {
      reachable: output.reachable,
      unreachable: output.unreachable,
      refused: output.refused,
    },
    { reachable: 1, unreachable: 1, refused: 0 },
  );
  assert.deepStrictEqual(
    delivered.map((one) => one.name),
    ["on.masup.usage.limit"],
  );
  assert.deepStrictEqual(delivered[0].input, { percent: 91 });
  const row = db
    .prepare("SELECT * FROM app_event_publications")
    .get() as Record<string, unknown>;
  assert.equal(row.publisher, PUBLISHER);
  assert.deepStrictEqual(Object.keys(row).sort(), [
    "at",
    "event",
    "id",
    "publisher",
    "reachable",
    "refused",
    "release",
    "trace_id",
    "unreachable",
  ]);
});

// 구독 handler가 받은 event 때문에 다시 event를 내면(A → B → A) 앞선 호출은 이미 끝났어도 event가 싣고 온 chain이 고리를 끊는다.
test("event를 부른 chain에 이미 있는 구독자에게는 호출을 넘기지 않고 센다", async () => {
  // PUBLISHER가 SUBSCRIBER의 구독 handler 안에서 낸 것: 앞선 chain에 SUBSCRIBER가 있다.
  const { db, delivered, publish } = setup([SUBSCRIBER]);
  const result = await publish({
    event: "usage.limit",
    payload: { percent: 91 },
    parent_invocation: null,
  });
  assert.ok(result.ok);
  assert.deepStrictEqual(delivered, []);
  const row = db
    .prepare("SELECT reachable, refused FROM app_event_publications")
    .get();
  assert.deepStrictEqual({ ...row }, { reachable: 1, refused: 1 });
});
