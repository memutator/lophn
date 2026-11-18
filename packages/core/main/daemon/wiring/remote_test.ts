import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock, ok, seededRandom } from "../../../../base/mod.ts";
import { routePath } from "../../../../protocol/base/mod.ts";
import {
  generateKeyPair,
  generateSigningKey,
  remoteKeyBytes,
  remoteKeyText,
  type RosterEntryBody,
  type RosterRemovalBody,
  type RosterStatement,
  rosterStore,
  signRoster,
} from "../../../../protocol/remote/mod.ts";
import type {
  AuthenticatedContext,
  Tx,
} from "../../../../protocol/server/mod.ts";
import {
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  devicesListRead,
  devicesPushTargetsRead,
  ROSTER_SCHEMA_STEPS,
  readHostKeyMachine,
  rosterStatementsRead,
} from "../../../remote/mod.ts";
import { dispatchHttp } from "../../../server/dispatch.ts";
import { createSql } from "../../../storage/ledger/sqlite.ts";
import {
  createCoreRegistration,
  REMOTE_COMMANDS,
  remoteWiring,
  signingKeyStep,
} from "./remote.ts";

const PERSON: AuthenticatedContext = {
  principal: "user:local",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};
const MACHINE = { principal: "machine:remote", actor: "machine" } as never;
const phoneId = `dev_0${"1".padStart(25, "0")}`;

const open = (root: string) => new DatabaseSync(join(root, "devices.db"));

function statementsOf(db: DatabaseSync): RosterStatement[] {
  return db
    .prepare("select text from roster_statements order by text")
    .all()
    .map((row) => JSON.parse(row.text as string) as RosterStatement);
}

// 기기 표·명단 표는 sqlite file에 devices.ts command·read 그대로다. writer는 command를 바로 돌리고 commit 뒤 할 일을 싣는다.
// remote는 켜져 있고 port와 relay가 없어 listener·relay는 열리지 않는다(host와 명단, key는 production code다).
async function boot(root: string, machine: string, random = seededRandom(13)) {
  const db = open(root);
  try {
    const sql = createSql(db, () => true);
    let pushed: { topic: string; data: unknown }[] = [];
    const tx = {
      sql,
      now: () => "2026-11-16T00:00:00.000Z",
      port: () => ({
        push: (topic: string, data: unknown) => pushed.push({ topic, data }),
      }),
    } as unknown as Tx;
    const read = (handle: typeof devicesListRead.handle) => () =>
      handle({ sql, as_of_seq: "1" } as never, {} as never, PERSON as never);
    let screens: unknown = [
      {
        name: "Pixel",
        os: "android",
        width: 412,
        height: 915,
        dpr: 2.625,
        device: phoneId,
      },
    ];
    const ctx: Record<string, unknown> = {
      root: { path: root },
      machine: { id: machine, status: () => ({ name: "studio" }) },
      clock: manualClock(0),
      random,
      provide: () => undefined,
      runtime: {
        reads: new Map([
          ["devices/list", read(devicesListRead.handle)],
          [
            "devices/push_targets",
            read(devicesPushTargetsRead.handle as never),
          ],
          ["roster/statements", read(rosterStatementsRead.handle as never)],
        ]),
        memory: { handlers: new Map() },
        record: async () => ok(undefined),
      },
      settings: {
        get: (setting: { key: string }) =>
          setting.key === "remote.enabled"
            ? true
            : setting.key === "shell.devices"
              ? screens
              : undefined,
      },
      settingsUpdate: (edits: { value: unknown }[]) => {
        screens = edits[0].value;
        return ok({ changed: [], rejected: [] });
      },
      telemetry: { logger: { error() {}, warn() {} } },
      attention: { bindPush() {}, forgetReporter() {} },
      bus: { subscribe: () => () => undefined },
      allRoutes: [],
    };
    const wiring = remoteWiring();
    const built = await wiring.build!(ctx as never);
    assert.ok(built.ok);
    ctx.writer = built.value.writer!({
      command: async (
        who: AuthenticatedContext,
        envelope: { command: string; input: unknown },
      ) => {
        pushed = [];
        const done = REMOTE_COMMANDS.find(
          (each) => each.route.name === envelope.command,
        )!.handle(tx, who, envelope.input as never, {} as never);
        return done.ok
          ? ok({
              result: done.value,
              replayed: false,
              first_seq: null,
              last_seq: null,
              after_commit: pushed,
            })
          : done;
      },
    } as never);
    assert.ok((await wiring.start!(ctx as never)).ok);
    await wiring.closeIntake!();
    const statements = statementsOf(db);
    const signing = readFileSync(
      join(root, "remote", "signing-key.json"),
      "utf8",
    );
    const signingKey = JSON.parse(signing).public_key as string;
    // 이 컴퓨터의 자기 항목: 자기 서명 key를 단 항목을 자기 id로 서명한 것.
    const self = statements.find(
      (each) =>
        "by" in each &&
        each.body.type === "entry" &&
        each.body.signing_key === signingKey &&
        each.by === each.body.id,
    )?.body as RosterEntryBody | undefined;
    return {
      rows: sql
        .all("select id, push_token from devices order by id", [])
        .map(Object.values),
      screens,
      key: readFileSync(join(root, "remote", "host-key.json"), "utf8"),
      signing,
      statements,
      self,
    };
  } finally {
    db.close();
  }
}

// 복사된 data root나 명단에서 빠진 컴퓨터가 옛 명단과 key를 남기면, 다른 기계가 들인 폰에 push를 보내고 그 연결을 받으며 뺀
// key로 다시 명단에 들려 한다.
test("옛 data root는 key와 폰을 그대로 옮기고, 명단에서 빠진 것을 안 컴퓨터와 복사된 data root는 명단·기기 행·key를 버리고 새 key와 새 자기 항목으로 뜬다", async () => {
  const original = `mch_0${"1".repeat(25)}`;
  const clone = `mch_0${"2".repeat(25)}`;
  const random = seededRandom(17);

  // 이 계획 전에 원래 기계에서 pairing한 폰 하나(push token이 있다)와 그 기계가 만든 host key.
  const root = mkdtempSync(join(tmpdir(), "lophn-remote-roster-"));
  mkdirSync(join(root, "remote"));
  const db = open(root);
  for (const step of [
    ...DEVICES_SCHEMA_STEPS,
    ...DEVICES_KIND_STEPS,
    ...ROSTER_SCHEMA_STEPS,
  ])
    db.exec(step.sql);
  db.prepare(
    `insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, is_primary, push_token)
       values (?, 'phone', 'Pixel', 'android', 412, 915, 2.625, ?, 'at', 1, 'ExponentPushToken[a]')`,
  ).run(phoneId, remoteKeyText(generateKeyPair(random).publicKey));
  db.close();
  const pair = generateKeyPair(random);
  const key = `${JSON.stringify({
    public_key: remoteKeyText(pair.publicKey),
    secret_key: remoteKeyText(pair.secretKey),
    machine: original,
  })}\n`;
  writeFileSync(join(root, "remote", "host-key.json"), key, { mode: 0o600 });
  assert.ok((await signingKeyStep.run(root)).ok);

  const same = await boot(root, original);
  assert.deepEqual(same.rows, [[phoneId, "ExponentPushToken[a]"]]);
  assert.equal(same.key, key);
  assert.equal((same.screens as unknown[]).length, 1);
  assert.ok(same.self !== undefined);
  assert.ok(
    same.statements.some(
      (each) =>
        "by" in each &&
        each.by === same.self!.id &&
        each.body.type === "entry" &&
        each.body.id === phoneId,
    ),
  );

  // 이 컴퓨터(A)가 들인 컴퓨터 B가 A를 뺐다. 그 statement가 닿은 뒤의 기동이다.
  const me = same.self!;
  const mine = remoteKeyBytes(JSON.parse(same.signing).secret_key)!;
  const bHost = generateKeyPair(random);
  const bSigning = generateSigningKey(random);
  const bId = `dev_0${"9".padStart(25, "0")}` as RosterEntryBody["id"];
  const bEntry: RosterEntryBody = {
    type: "entry",
    id: bId,
    kind: "computer",
    key: remoteKeyText(bHost.publicKey),
    signing_key: remoteKeyText(bSigning.publicKey),
    machine: `mch_0${"3".repeat(25)}` as RosterEntryBody["machine"],
    name: "laptop",
    os: "linux",
    terminal_input: true,
    rev: 1,
    invite: null,
  };
  const removal: RosterRemovalBody = {
    type: "removal",
    id: me.id,
    key: me.key,
    signing_key: me.signing_key,
    at: "2026-11-17T00:00:00.000Z",
  };
  const arrived: RosterStatement[] = [
    { body: bEntry, by: me.id, signature: signRoster(bEntry, mine) },
    {
      body: bEntry,
      by: bId,
      signature: signRoster(bEntry, bSigning.secretKey),
    },
    {
      body: removal,
      by: bId,
      signature: signRoster(removal, bSigning.secretKey),
    },
  ];
  const stored = open(root);
  const done = REMOTE_COMMANDS.find(
    (each) => each.route.name === rosterStore.name,
  )!.handle(
    {
      sql: createSql(stored, () => true),
      port: () => ({ push() {} }),
    } as never,
    MACHINE,
    {
      statements: [...statementsOf(stored), ...arrived],
      reach: [],
      folds: [],
    } as never,
    {} as never,
  );
  stored.close();
  assert.ok(done.ok);

  const removed = await boot(root, original);
  assert.deepEqual(removed.rows, []);
  assert.deepEqual(removed.screens, []);
  assert.notEqual(removed.key, key);
  assert.notEqual(removed.signing, same.signing);
  assert.equal(await readHostKeyMachine(join(root, "remote")), original);
  // 남은 것은 새 key의 새 자기 항목 하나다. 옛 명단(B, 빼기, 폰)을 들고 다시 들려 하지 않는다.
  assert.equal(removed.statements.length, 1);
  assert.notEqual(removed.self?.id, me.id);
  assert.equal(removed.self?.key, JSON.parse(removed.key).public_key);

  const cloned = await boot(root, clone, seededRandom(29));
  assert.notEqual(cloned.key, removed.key);
  assert.notEqual(cloned.signing, removed.signing);
  assert.equal(await readHostKeyMachine(join(root, "remote")), clone);
  assert.equal(cloned.statements.length, 1);
  assert.notEqual(cloned.self?.id, removed.self?.id);
});

// agent가 명단을 고치거나(기기 들이기·빼기, 초대장 내기) 다른 기계의 route를 부르면 사람만 하던 일을 agent가 다른 기계까지 한다.
test("agent 자격은 roster/*와 machines/*를 부르지 못하고 handler에 닿지 않는다", async () => {
  const routes = createCoreRegistration().memoryRoutes.filter(
    (route) => route.resource === "roster" || route.resource === "machines",
  );
  assert.ok(routes.some((route) => route.name === "machines.call"));
  assert.ok(routes.some((route) => route.name === "roster.join"));
  const reached: string[] = [];
  const memory = new Map(
    routes.map((route) => [
      `${route.resource}/${route.method}`,
      () => {
        reached.push(route.name);
        return ok({});
      },
    ]),
  );
  const agent = `agent:ses_0${"1".repeat(25)}`;
  for (const route of routes) {
    const done = (await dispatchHttp(
      new Request(`http://127.0.0.1${routePath(route)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { route, path: routePath(route) },
      {
        principal: agent,
        actor: "agent",
        scope: { operations: routes.map((each) => each.name), targets: {} },
        conditions: {},
        credential_ref: agent,
      },
      {
        credentials: undefined as never,
        clock: manualClock(0),
        memory,
        bodyTimeoutMs: 1000,
        jsonMaxBytes: 65_536,
      },
    )) as { json: { error?: { code: string } } };
    assert.equal(done.json.error?.code, "forbidden", route.name);
  }
  assert.deepEqual(reached, []);
});
