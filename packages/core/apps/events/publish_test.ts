import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { encodeRecord } from "../../../protocol/folder/records.ts";
import {
  eventFilePath,
  eventFileSchema,
} from "../../../protocol/remote/carry.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { FOLDER_EVENTS_SEEN_STEPS } from "../../folder/schema.ts";
import {
  markEventSeen,
  readArrivedEvents,
} from "../../folder/import/events.ts";
import type { Flight } from "../calls/intake.ts";
import type { AppDeclaration } from "../declaration/mod.ts";
import {
  createEventArrival,
  createEventDelivery,
  createEventPublisher,
  crossPublisherOf,
  type EventToDeliver,
  receivedAppEvent,
} from "./publish.ts";
import {
  EVENT_PUBLICATIONS_MACHINE_STEPS,
  eventPublicationSchemaSteps,
} from "./schema.ts";

const appId = (suffix: string) => `app_${"0".repeat(24)}${suffix}` as Id<"app">;
const PUBLISHER = appId("p1");
const SUBSCRIBER = appId("s1");
const OFFLINE = appId("f1");
// 화면만 구독하는 앱(process가 떠 있고 handler를 등록하지 않았다). process 전달 대상이 아니라 reachable도 unreachable도 아니다.
const VIEW_ONLY = appId("f2");
const OTHER = appId("x1");
const ME = `mch_${"0".repeat(24)}m1` as Id<"mch">;
const ORIGIN = `mch_${"0".repeat(24)}c1` as Id<"mch">;
const DESK = `mch_${"0".repeat(24)}d1` as Id<"mch">;
// 이 기계에 없는 앱(다른 컴퓨터에만 있다).
const REMOTE_ONLY = appId("z9");
const BUNDLE = "a".repeat(64);

function release(app: string, declaration: object) {
  return {
    app,
    id: `rel_${app.slice(4)}`,
    declaration: JSON.stringify(declaration),
  };
}

const publisherDeclaration = {
  sync_to: "computers",
  events: [
    {
      name: "usage.limit",
      description: "A usage limit was reached.",
      across_machines: true,
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
  db.exec(EVENT_PUBLICATIONS_MACHINE_STEPS[0].sql);
  db.exec(FOLDER_EVENTS_SEEN_STEPS[0].sql);
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
  const delivered: {
    app: string;
    name: string;
    input: unknown;
    caller: unknown;
  }[] = [];
  const clock = manualClock(Date.parse("2026-11-10T00:00:00.000Z"));
  // 이 기계의 call 정책에서 private인 앱 workspace.
  const privateApps = new Set<string>();
  // 이 기계의 발행 앱 active release 선언(test가 바꾼다).
  const declaration = { current: publisherDeclaration };
  const appStore = {
    app: (id: string) => ({
      ok: true as const,
      value: id === PUBLISHER ? { slug: "masup", archived: false } : null,
    }),
    activeDeclaration: () => ({
      ok: true as const,
      value: {
        release: `rel_${PUBLISHER.slice(4)}` as Id<"rel">,
        bundle_hash: BUNDLE,
        declaration: declaration.current,
      },
    }),
    isPrivate: (app: Id<"app">) => privateApps.has(app),
  };
  const tx = {
    sql: {
      run: (query: string, params: SQLInputValue[] = []) =>
        db.prepare(query).run(...params),
    },
  } as unknown as Tx;
  const delivery = createEventDelivery({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    random: seededRandom(2),
    activeTraceId: () => undefined,
    sql,
    transaction: (fn) => fn(tx),
    running: (app) =>
      Promise.resolve(
        app === OFFLINE ? "down" : app === VIEW_ONLY ? "none" : "running",
      ),
    async deliver(input) {
      delivered.push({
        app: (input.target as { app: string }).app,
        name: input.name,
        input: input.input,
        caller: input.caller,
      });
      return {
        ok: true,
        value: { invocation: null, outcome: undefined as never },
      };
    },
    announce: (published) => void announced.push(published),
    failed() {},
    // 구독 선언의 컴퓨터 이름: laptop은 ORIGIN, desk는 DESK다.
    isPrivate: (app) => privateApps.has(app),
    machineOf: (name) =>
      name === "laptop" ? ORIGIN : name === "desk" ? DESK : null,
    crossSeen: (origin, app, id) =>
      ok(markEventSeen(tx, { me: ME, origin, app, id, at: clock.now() })),
    crossPublisher: crossPublisherOf(appStore),
  });
  const announced: Record<string, unknown>[] = [];
  // 발행 앱이 도는 호출(parent_invocation으로 찾는다).
  const flights = new Map<string, Flight>();
  const carried: { app: string; name: string; id: string }[] = [];
  const shared = { delivery, ...appStore, warn() {} };
  const publish = createEventPublisher({
    ...shared,
    ids: createIdSource({ clock, random: seededRandom(3) }),
    crossEvents: {
      async write(app, _release, event) {
        carried.push({ app, name: event.name, id: event.id });
        return { ok: true, value: undefined };
      },
    },
    flight: (id) => flights.get(id),
    ancestry: () => ancestry,
  });
  const arrived = createEventArrival({ ...shared, nowMs: () => clock.nowMs() });
  const ctx = { actor: `app:${PUBLISHER}` } as unknown as RequestContext;
  const internal: EventToDeliver[] = [];
  delivery.addInternal({
    wantsSource: () => false,
    deliver: (event) => void internal.push(event),
  });
  return {
    db,
    delivered,
    announced,
    declaration,
    flights,
    internal,
    addApp,
    privateApps,
    carried,
    clock,
    delivery,
    tx,
    arrived,
    publish: (body: unknown) => publish(ctx, body as never),
    // 도착은 기다리지 않고 낸다. 다음 차례까지 돌려 전달이 끝나게 한다.
    async arrive(payload: unknown) {
      arrived({
        app: PUBLISHER,
        origin: ORIGIN,
        name: "usage.limit",
        payload: payload as never,
        at: clock.now(),
        bundle_hash: BUNDLE,
      });
      await new Promise((resolve) => setImmediate(resolve));
    },
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
    "machine",
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

// private은 그 기계의 call 정책이다. 내는 기계가 private이면 event file을 쓰지 않고, 받는 기계가 private이면 내지 않는다.
test("private인 workspace의 앱이 낸 across_machines event는 다른 기계로 가지 않고, private인 기계에 도착한 event는 그 기계에서 나지 않는다", async () => {
  const { db, delivered, privateApps, carried, publish, arrive } = setup();
  const body = {
    event: "usage.limit",
    payload: { percent: 91 },
    parent_invocation: null,
  };
  const fromOrigin = () =>
    db
      .prepare(
        "SELECT count(*) AS n FROM app_event_publications WHERE machine = ?",
      )
      .get(ORIGIN)?.n;

  privateApps.add(PUBLISHER);
  assert.ok((await publish(body)).ok);
  assert.deepStrictEqual(carried, []);
  delivered.length = 0;
  await arrive({ percent: 50 });
  assert.equal(delivered.length, 0);
  assert.equal(fromOrigin(), 0);

  privateApps.clear();
  assert.ok((await publish(body)).ok);
  assert.deepStrictEqual(
    carried.map(({ app, name }) => ({ app, name })),
    [{ app: PUBLISHER, name: "usage.limit" }],
  );
  delivered.length = 0;
  await arrive({ percent: 50 });
  assert.deepStrictEqual(
    delivered.map((one) => ({
      input: one.input,
      machine: (one.caller as { machine?: string }).machine,
    })),
    [{ input: { percent: 50 }, machine: ORIGIN }],
  );
  assert.equal(fromOrigin(), 1);
});

const CROSS_ID = "01hzzzzzzzzzzzzzzzzzzzzzzz";
const TRACE = "b".repeat(32);
const PUBLICATION = `pub_${"0".repeat(24)}q1` as Id<"pub">;

const received = (
  extra: Partial<
    Parameters<ReturnType<typeof setup>["delivery"]["receive"]>[1]
  > = {},
) => ({
  publisher: PUBLISHER,
  source: "masup",
  event: "usage.limit",
  payload: { percent: 77 },
  publication: PUBLICATION,
  trace_id: TRACE,
  chain: [PUBLISHER],
  ...extra,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

// 구독자를 가르는 한 곳이 이 기계의 event, 늦은 길, 연결로 온 event에 같이 쓰인다. 틀리면 이 기계의 event가 다른 컴퓨터를 적은 구독에 가거나 그 반대다.
test("구독은 기계를 적은 대로 받는다: 이 기계의 event는 기계를 적지 않은 구독, 다른 컴퓨터의 event는 그 컴퓨터를 적은 구독과 같은 앱이 이 기계에도 있을 때의 기계를 적지 않은 구독이다", async () => {
  const t = setup();
  const LAPTOP_SUB = appId("l1");
  const DESK_SUB = appId("d1");
  const REMOTE_SUB = appId("r1");
  const sub = (source: string, machine: string) => ({
    subscriptions: [{ source, event: "usage.limit", machine }],
  });
  t.addApp(LAPTOP_SUB, sub("masup", "laptop"));
  t.addApp(DESK_SUB, sub("masup", "desk"));
  t.addApp(REMOTE_SUB, sub("remote-slug", "laptop"));
  const apps = () => t.delivered.map((one) => one.app).sort();
  const clear = () => {
    t.delivered.length = 0;
    t.internal.length = 0;
  };

  assert.ok(
    (
      await t.publish({
        event: "usage.limit",
        payload: { percent: 91 },
        parent_invocation: null,
      })
    ).ok,
  );
  assert.deepStrictEqual(apps(), [SUBSCRIBER]);

  clear();
  await t.arrive({ percent: 50 });
  assert.deepStrictEqual(apps(), [LAPTOP_SUB, SUBSCRIBER]);

  // 연결로 온 event는 기록 줄을 쓰지 않는다(그 컴퓨터에 있다). 안 구독자는 난 기계를 받는다.
  clear();
  const rows = () =>
    t.db.prepare("SELECT count(*) AS n FROM app_event_publications").get()?.n;
  const before = rows();
  await t.delivery.receive(ORIGIN, received());
  assert.deepStrictEqual(apps(), [LAPTOP_SUB, SUBSCRIBER]);
  assert.equal(rows(), before);
  assert.deepStrictEqual(
    t.internal.map((one) => ({ machine: one.machine, source: one.source })),
    [{ machine: ORIGIN, source: "masup" }],
  );
  assert.deepStrictEqual(t.delivered[0].caller, {
    kind: "event",
    publisher: PUBLISHER,
    event: "usage.limit",
    publication: PUBLICATION,
    trace_id: TRACE,
    chain: [PUBLISHER],
    parent_invocation: null,
    machine: ORIGIN,
  });

  // 이 기계에 없는 앱의 event는 그 컴퓨터를 적은 구독만 받는다. 기계를 적지 않은 구독은 이 기계의 앱을 가리킨다.
  clear();
  await t.delivery.receive(
    ORIGIN,
    received({
      publisher: REMOTE_ONLY,
      source: "remote-slug",
      chain: [REMOTE_ONLY],
    }),
  );
  assert.deepStrictEqual(apps(), [REMOTE_SUB]);
  assert.equal(t.internal.length, 1);

  // 같은 앱이 이 기계에 있어도 private이면 기계를 적지 않은 구독은 받지 않는다.
  clear();
  t.privateApps.add(PUBLISHER);
  await t.delivery.receive(ORIGIN, received());
  assert.deepStrictEqual(apps(), [LAPTOP_SUB]);
  t.privateApps.clear();

  // private인 workspace의 앱은 다른 기계의 event를 받지 않는다. 감시는 컴퓨터마다라 다른 구독이 같은 컴퓨터를 보고 있어도 마찬가지다.
  clear();
  t.privateApps.add(LAPTOP_SUB);
  t.privateApps.add(SUBSCRIBER);
  await t.delivery.receive(ORIGIN, received());
  await t.arrive({ percent: 50 });
  assert.deepStrictEqual(apps(), []);
  // 이 기계의 event는 private인 앱도 받는다(이 기계 안의 일이다).
  assert.ok(
    (
      await t.publish({
        event: "usage.limit",
        payload: { percent: 91 },
        parent_invocation: null,
      })
    ).ok,
  );
  assert.deepStrictEqual(apps(), [SUBSCRIBER]);
  t.privateApps.clear();

  // 기계를 건넌 고리도 끊긴다: chain에 있는 구독자에게는 넘기지 않는다.
  clear();
  await t.delivery.receive(
    ORIGIN,
    received({ chain: [PUBLISHER, SUBSCRIBER] }),
  );
  assert.deepStrictEqual(apps(), [LAPTOP_SUB]);
});

// 같은 event를 두 번 내면 구독한 job이 둘 열리거나 앱 handler가 두 번 돈다. `across_machines` event는 연결로도 file로도 와서
// 두 길이 `folder_events_seen` 한 표로 센다.
test("같은 event가 연결과 늦은 길로 둘 다 와도 구독자는 한 번만 받고, cross_id가 없는 event는 표에 적지 않는다", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-events-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const writeFile = (home: string, id: string) => {
    const path = eventFilePath(ORIGIN, PUBLISHER, id);
    mkdirSync(join(home, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(
      join(home, ...path.split("/")),
      encodeRecord(eventFileSchema, {
        format: 1,
        machine: ORIGIN,
        app: PUBLISHER,
        id,
        bundle_hash: BUNDLE,
        name: "usage.limit",
        payload: { percent: 77 },
        at: "2026-11-10T00:00:00.000Z",
      }),
    );
  };
  const counts = (s: ReturnType<typeof setup>) => ({
    handlers: s.delivered.filter((one) => one.app === SUBSCRIBER).length,
    internal: s.internal.length,
    seen: s.db.prepare("SELECT count(*) AS n FROM folder_events_seen").get()?.n,
  });
  const readFiles = async (s: ReturnType<typeof setup>, home: string) => {
    const done = await readArrivedEvents({
      me: ME,
      apps: [{ app: PUBLISHER, sync_to: "computers", bundle_hash: BUNDLE }],
      destinations: {
        resolve: () => ({ path: home, state: "ok" }),
        list: () => [],
      } as never,
      transaction: (fn) => fn(s.tx),
      clock: s.clock,
      arrived: s.arrived,
    });
    assert.ok(done.ok);
    await tick();
  };

  // 낸 기계가 file id를 먼저 만들어 file과 연결로 가는 event가 같은 id를 싣는다.
  const origin = setup();
  assert.ok(
    (
      await origin.publish({
        event: "usage.limit",
        payload: { percent: 77 },
        parent_invocation: null,
      })
    ).ok,
  );
  assert.equal(origin.carried.length, 1);
  assert.equal(origin.announced[0].cross_id, origin.carried[0].id);

  for (const order of ["connection first", "file first"]) {
    const s = setup();
    const home = join(dir, order.replace(" ", "-"));
    writeFile(home, CROSS_ID);
    const live = async () => {
      await s.delivery.receive(ORIGIN, received({ cross_id: CROSS_ID }));
      await tick();
    };
    if (order === "connection first") {
      await live();
      await readFiles(s, home);
    } else {
      await readFiles(s, home);
      await live();
    }
    // 두 번 와도 구독 앱 handler 하나, 안 구독자 하나, 표의 줄 하나.
    assert.deepStrictEqual(
      counts(s),
      { handlers: 1, internal: 1, seen: 1 },
      order,
    );
  }

  // file이 없는 event(`across_machines`가 아니다)는 센 적이 없다: 오는 대로 낸다.
  const plain = setup();
  await plain.delivery.receive(ORIGIN, received());
  await plain.delivery.receive(ORIGIN, received());
  assert.deepStrictEqual(counts(plain), { handlers: 2, internal: 2, seen: 0 });
});

// 다른 컴퓨터가 보낸 글이다. 앱이 선언해 낸 event(audience가 없고 되돌려 나른 것이 아니다)만 이 기계의 event가 된다.
test("다른 컴퓨터가 link로 보낸 event 가운데 앱이 낸 AppEventPublished만 읽고, 그 밖의 모양과 core event와 앱 화면만 받는 event와 되돌려 나른 event는 버린다", () => {
  const payload = {
    source: "masup",
    event: "usage.limit",
    payload: { percent: 91 },
    audience: null,
    publication: `pub_${"0".repeat(25)}1`,
    trace_id: "a".repeat(32),
    chain: [PUBLISHER],
    cross_id: "01hzzzzzzzzzzzzzzzzzzzzzzz",
  };
  const event = (subject: string | null, over: object = {}) => ({
    type: "AppEventPublished",
    subject,
    at: "2026-11-10T00:00:00.000Z",
    payload: { ...payload, ...over },
  });
  assert.deepStrictEqual(receivedAppEvent(event(PUBLISHER)), {
    publisher: PUBLISHER,
    source: "masup",
    event: "usage.limit",
    payload: { percent: 91 },
    publication: payload.publication,
    trace_id: payload.trace_id,
    chain: payload.chain,
    cross_id: payload.cross_id,
  });
  for (const bad of [
    event(null),
    event(PUBLISHER, { audience: [SUBSCRIBER] }),
    event(PUBLISHER, { machine: ORIGIN }),
    event(PUBLISHER, { remote: true }),
    event(PUBLISHER, { trace_id: "nope" }),
    { type: "NoticeClosed" },
    "text",
    null,
  ]) {
    assert.equal(receivedAppEvent(bad), null);
  }
});

// 받은 call이나 다른 컴퓨터에서 온 event가 부른 호출 안에서 난 event가 다른 컴퓨터로 가면 두 컴퓨터의 앱이 서로의 event로 끝없이 부른다.
test("받은 call 안에서 앱이 낸 event는 remote로 표시되어 다른 컴퓨터로 나가지 않고 event file도 쓰지 않으며 이 기계의 구독자는 받는다", async () => {
  const t = setup();
  const body = {
    event: "usage.limit",
    payload: { percent: 91 },
    parent_invocation: `inv_${"0".repeat(25)}1`,
  };
  // 이 앱의 도는 호출이 받은 call(remote)이다.
  t.flights.set(body.parent_invocation, {
    id: body.parent_invocation,
    app: PUBLISHER,
    remote: true,
  } as never);
  assert.ok((await t.publish(body)).ok);
  assert.equal(t.announced[0]?.remote, true);
  assert.equal(t.announced[0]?.cross_id, undefined);
  assert.deepStrictEqual(t.carried, []);
  assert.deepStrictEqual(
    t.delivered.map((one) => one.app),
    [SUBSCRIBER],
  );

  // 이 기계의 호출 안에서 낸 event는 표시가 없고 다른 컴퓨터로 간다.
  t.flights.set(body.parent_invocation, {
    id: body.parent_invocation,
    app: PUBLISHER,
    remote: false,
  } as never);
  assert.ok((await t.publish(body)).ok);
  assert.equal(t.announced[1]?.remote, undefined);
  assert.equal(t.carried.length, 1);
});

// 같은 앱이 이 기계에도 있을 때 기계를 적지 않은 구독이 다른 컴퓨터의 event를 받는 길은 이 기계의 선언을 따른다. 선언이 across_machines가 아니거나 payload가 이 기계의
// schema에 맞지 않으면 그 구독은 받지 않는다(그 컴퓨터를 적은 구독은 선언을 보지 못해 받는다).
test("같은 앱이 이 기계에 있어도 across_machines 선언이 아니거나 payload가 이 기계의 schema에 맞지 않으면 기계를 적지 않은 구독은 다른 컴퓨터의 event를 받지 않는다", async () => {
  const t = setup();
  const NAMED = appId("l1");
  t.addApp(NAMED, {
    subscriptions: [
      { source: "masup", event: "usage.limit", machine: "laptop" },
    ],
  });
  const apps = () => t.delivered.map((one) => one.app).sort();
  const clear = () => (t.delivered.length = 0);

  await t.delivery.receive(ORIGIN, received());
  assert.deepStrictEqual(apps(), [NAMED, SUBSCRIBER]);

  clear();
  await t.delivery.receive(ORIGIN, received({ payload: { percent: "high" } }));
  assert.deepStrictEqual(apps(), [NAMED]);

  clear();
  const [event] = publisherDeclaration.events!;
  t.declaration.current = {
    ...publisherDeclaration,
    events: [{ ...event!, across_machines: false }],
  } as never;
  await t.delivery.receive(ORIGIN, received());
  assert.deepStrictEqual(apps(), [NAMED]);
  t.declaration.current = publisherDeclaration;

  // 다른 컴퓨터의 글이라 payload 크기 한도를 이 기계도 지킨다(선언을 볼 수 없는 구독에게도).
  clear();
  t.internal.length = 0;
  await t.delivery.receive(
    ORIGIN,
    received({ payload: { text: "x".repeat(20 * 1024) } }),
  );
  assert.deepStrictEqual(apps(), []);
  assert.equal(t.internal.length, 0);
  assert.equal(
    receivedAppEvent({
      type: "AppEventPublished",
      subject: PUBLISHER,
      at: "2026-11-10T00:00:00.000Z",
      payload: {
        source: "masup",
        event: "usage.limit",
        payload: { text: "x".repeat(40 * 1024) },
        audience: null,
        publication: PUBLICATION,
        trace_id: TRACE,
        chain: [PUBLISHER],
      },
    }),
    null,
  );
});
