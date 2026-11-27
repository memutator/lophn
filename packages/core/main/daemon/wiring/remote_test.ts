import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../../../base/mod.ts";
import { routePath } from "../../../../protocol/base/mod.ts";
import {
  acceptRemote,
  generateKeyPair,
  generateSigningKey,
  type RemoteTransport,
  remoteKeyBytes,
  remoteKeyText,
  type RosterEntryBody,
  type RosterInvitedStatement,
  type RosterInviteBody,
  type RosterRemovalBody,
  type RosterStatement,
  rosterStore,
  signRoster,
} from "../../../../protocol/remote/mod.ts";
import type {
  AuthenticatedContext,
  Tx,
} from "../../../../protocol/server/mod.ts";
import type { Dial } from "../../../../remote-client/mod.ts";
import {
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  devicesListRead,
  devicesPushTargetsRead,
  type openRemoteListener,
  ROSTER_SCHEMA_STEPS,
  readHostKeyMachine,
  rosterStatementsRead,
} from "../../../remote/mod.ts";
import { GRANTS_SCHEMA_STEPS, grantsRead } from "../../../remote/grants.ts";
import { dispatchHttp } from "../../../server/dispatch.ts";
import { createSql } from "../../../storage/ledger/sqlite.ts";
import {
  createCoreRegistration,
  REMOTE_COMMANDS,
  remoteWiring,
  signingKeyStep,
  viewerDropStep,
  viewerRosterStep,
} from "./remote.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

const PERSON: AuthenticatedContext = {
  principal: "user:local",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};
const MACHINE = { principal: "machine:remote", actor: "machine" } as never;
const phoneId = `dev_0${"1".padStart(25, "0")}`;

const STEPS = [
  ...DEVICES_SCHEMA_STEPS,
  ...DEVICES_KIND_STEPS,
  ...ROSTER_SCHEMA_STEPS,
  ...GRANTS_SCHEMA_STEPS,
];

const open = (root: string) => new DatabaseSync(join(root, "devices.db"));

function statementsOf(db: DatabaseSync): RosterStatement[] {
  return db
    .prepare("select text from roster_statements order by text")
    .all()
    .map((row) => JSON.parse(row.text as string) as RosterStatement);
}

// 기기 표·명단 표는 sqlite file에 devices.ts command·read 그대로다. writer는 command를 바로 돌리고 commit 뒤 할 일을 싣는다.
// remote는 켜져 있고 port와 relay가 없어 listener·relay는 열리지 않는다(host와 명단, key는 production code다).
// `during`은 기동 뒤 intake를 닫기 전에 memory route(`roster/join` 등)를 부른다. `dial`은 다른 컴퓨터에 붙는 길이다.
async function boot(
  root: string,
  machine: string,
  random = seededRandom(13),
  options: {
    dial?: Dial;
    openListener?: typeof openRemoteListener;
    port?: number;
    during?: (
      memory: Map<string, (who: unknown, input: unknown) => unknown>,
      provided: Map<string, unknown>,
      controls: {
        setPort(next: number | undefined): void;
        setEnabled(next: boolean): void;
        notifySettings(key: string): Promise<void>;
      },
    ) => Promise<void>;
  } = {},
) {
  const provided = new Map<string, unknown>();
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
    let enabled = true;
    let port = options.port;
    const subscribers: ((event: unknown) => void)[] = [];
    const ctx: Record<string, unknown> = {
      root: { path: root },
      machine: { id: machine, status: () => ({ name: "studio" }) },
      clock: manualClock(0),
      random,
      provide: (name: string, value: unknown) => provided.set(name, value),
      runtime: {
        reads: new Map([
          ["devices/list", read(devicesListRead.handle)],
          [
            "devices/push_targets",
            read(devicesPushTargetsRead.handle as never),
          ],
          ["roster/statements", read(rosterStatementsRead.handle as never)],
          ["roster/grants", read(grantsRead.handle as never)],
        ]),
        memory: { handlers: new Map() },
        record: async () => ok(undefined),
      },
      settings: {
        get: (setting: { key: string }) =>
          setting.key === "remote.enabled"
            ? enabled
            : setting.key === "remote.port"
              ? port
              : setting.key === "shell.devices"
                ? screens
                : undefined,
      },
      settingsUpdate: (edits: { value: unknown }[]) => {
        screens = edits[0].value;
        return ok({ changed: [], rejected: [] });
      },
      telemetry: { logger: { error() {}, warn() {}, info() {} } },
      attention: { bindPush() {}, forgetReporter() {} },
      bus: {
        subscribe: (
          _conditions: unknown,
          sink: { send(event: unknown): void },
        ) => {
          subscribers.push(sink.send);
          return () => undefined;
        },
        publish() {},
      },
      allRoutes: [],
      productStartListeners: [],
      // shell main이 붙지 않았다: 살아 있는 shell capability가 없다.
      peek: {},
    };
    const wiring = remoteWiring(options.dial, options.openListener);
    // build가 쓰는 날 writer. 아직 쓰기 앞 처리기를 접은 `ctx.writer`는 없다.
    const raw = {
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
    };
    (ctx.runtime as { writer: unknown }).writer = raw;
    const built = await wiring.build!(ctx as never);
    assert.ok(built.ok);
    ctx.writer = built.value.writer!(raw as never);
    assert.ok((await wiring.start!(ctx as never)).ok);
    await options.during?.(new Map(built.value.memory as never), provided, {
      setPort(next) {
        port = next;
      },
      setEnabled(next) {
        enabled = next;
      },
      async notifySettings(settingKey) {
        for (const send of subscribers) {
          send({
            type: "StateChanged",
            payload: { changes: [{ name: "settings", id: settingKey }] },
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
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
      grants: sql
        .all("select key from remote_grants order by key", [])
        .map((row) => row.key as string),
      seeded: sql.get("select 1 from remote_grants_seed", []) !== undefined,
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
  for (const step of STEPS) db.exec(step.sql);
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
  assert.ok((await signingKeyStep.run(root, stepDeps)).ok);

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
      removed: [],
      names: [],
    } as never,
    {} as never,
  );
  stored.close();
  assert.ok(done.ok);

  // 이 컴퓨터가 B를 허락해 둔 채 B가 이 컴퓨터를 뺐다: 버린 명단과 함께 허락도 사라지고 옮기기 표지는 남는다.
  const allowed = open(root);
  allowed
    .prepare("insert into remote_grants (key, granted_at) values (?, 'at')")
    .run(bEntry.key);
  allowed.close();
  const removed = await boot(root, original);
  assert.deepEqual(removed.grants, []);
  assert.equal(removed.seeded, true);
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

// 메모리 안에서 이 컴퓨터와 초대한 컴퓨터를 잇는다. 실제 socket처럼 다음 microtask에 전한다.
function wire(): { client: RemoteTransport; server: RemoteTransport } {
  const on = {
    client: { message: (_: Uint8Array) => {}, close: () => {} },
    server: { message: (_: Uint8Array) => {}, close: () => {} },
  };
  const end = (self: "client" | "server", other: "client" | "server") => ({
    send: (bytes: Uint8Array) => queueMicrotask(() => on[other].message(bytes)),
    close: () => queueMicrotask(() => on[other].close()),
    onMessage: (fn: (bytes: Uint8Array) => void) => {
      on[self].message = fn;
    },
    onClose: (fn: () => void) => {
      on[self].close = fn;
    },
  });
  return { client: end("client", "server"), server: end("server", "client") };
}

// 거절된 초대장의 issuer를 저장하면 이 컴퓨터는 받아들이지도 않은 컴퓨터를 믿는 컴퓨터로 들고(offline으로 보이고 link를 건다)
// 죽은 초대 서명 statement를 keep에 둔다.
test("초대한 컴퓨터가 roster/join을 거절하면(used) 명단에 아무것도 저장하지 않는다", async () => {
  const random = seededRandom(31);
  const root = mkdtempSync(join(tmpdir(), "lophn-remote-join-"));
  const db = open(root);
  for (const step of STEPS) db.exec(step.sql);
  db.close();
  const issuerHost = generateKeyPair(random);
  const issuerSigning = generateSigningKey(random);
  const once = generateSigningKey(random);
  const issuerId = `dev_0${"8".padStart(25, "0")}` as RosterEntryBody["id"];
  const issuerMachine = `mch_0${"4".repeat(25)}` as const;
  const issuer: RosterEntryBody = {
    type: "entry",
    id: issuerId,
    kind: "computer",
    key: remoteKeyText(issuerHost.publicKey),
    signing_key: remoteKeyText(issuerSigning.publicKey),
    machine: issuerMachine as RosterEntryBody["machine"],
    name: "laptop",
    os: "linux",
    rev: 1,
    invite: null,
  };
  const invite: RosterInviteBody = {
    type: "invite",
    key: remoteKeyText(once.publicKey),
    by: issuerId as RosterInviteBody["by"],
    kind: "computer",
    terminal_input: true,
    expires_at: "1970-01-01T00:30:00.000Z",
  };
  const text = JSON.stringify({
    invite: {
      body: invite,
      signature: signRoster(invite, issuerSigning.secretKey),
    },
    secret: remoteKeyText(once.secretKey),
    issuer: {
      body: issuer,
      by: issuerId,
      signature: signRoster(issuer, issuerSigning.secretKey),
    },
    reach: {
      device: issuerId,
      addresses: ["10.0.0.9"],
      port: 7432,
      relay: null,
    },
  });
  // 초대한 컴퓨터: 붙는 것은 받고 join은 used로 거절한다.
  const dial: Dial = async () => {
    const w = wire();
    void acceptRemote({
      transport: w.server,
      staticKey: issuerHost,
      capabilities: [],
      random,
      machine: { id: issuerMachine, name: "laptop", addresses: [] },
    }).then((opened) => {
      assert.ok(opened.ok);
      opened.value.onFrame((frame) => {
        if (frame.type !== "join") return;
        opened.value.send({
          type: "result",
          id: frame.id,
          ok: false,
          error: {
            code: "conflict",
            message: "roster invite refused: used",
            details: { reason: "used" },
          },
        });
      });
    });
    return w.client;
  };
  let answer: unknown;
  const booted = await boot(root, `mch_0${"5".repeat(25)}`, random, {
    dial,
    during: async (memory) => {
      answer = await memory.get("roster/join")!(PERSON, { text });
    },
  });
  assert.deepEqual(answer, {
    ok: false,
    error: {
      code: "conflict",
      message: "the inviting computer refused this computer: used",
      details: { reason: "used" },
    },
  });
  // 남은 것은 이 컴퓨터의 자기 항목 하나다(issuer 항목, 그 서명, 초대 서명 statement가 없다).
  assert.deepEqual(
    booted.statements.map((each) => each.body.key),
    [booted.self?.key],
  );
});

// 다른 기계는 이 컴퓨터를 사람으로 받는다. wiring이 capability를 보지 않으면 사람의 CLI token이 그 기계의 사람 route에 닿는다.
test("살아 있는 shell capability 없이 부른 machines/call·machines/watch는 forbidden이다", async () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-remote-machines-"));
  mkdirSync(join(root, "remote"));
  const db = open(root);
  for (const step of STEPS) db.exec(step.sql);
  db.close();
  const answers: unknown[] = [];
  await boot(root, `mch_0${"6".repeat(25)}`, seededRandom(41), {
    during: async (memory) => {
      const machine = `mch_0${"7".repeat(25)}`;
      answers.push(
        await memory.get("machines/call")!(PERSON, {
          machine,
          resource: "providers",
          method: "disconnect",
          body: {},
          shell_capability: "cli",
        }),
        memory.get("machines/watch")!(PERSON, {
          machine,
          conditions: [],
          shell_capability: "cli",
        }),
      );
    },
  });
  for (const answer of answers) {
    assert.equal(
      (answer as { error?: { code: string } }).error?.code,
      "forbidden",
    );
  }
});

// 같은 폰이 컴퓨터마다 다른 id로 pairing되어 있었다. 명단이 id를 접을 때 앱 sync log나 `shell.devices`가 옛 id에 남으면 그 폰의
// 변경이 다른 기기의 것이 되고 preview 기기를 잃는다. commit 뒤 설정을 쓰기 전에 죽으면 행은 이미 옮겨져 있다.
test("폰 하나에 id가 둘이던 data root에서 id를 모은 뒤 app_sync_log와 shell.devices가 같은 id를 가리킨다", async () => {
  const random = seededRandom(37);
  const root = mkdtempSync(join(tmpdir(), "lophn-remote-fold-"));
  mkdirSync(join(root, "remote"));
  const db = open(root);
  for (const step of STEPS) db.exec(step.sql);
  // fold가 고치는 칸만 둔 sync log.
  db.exec("create table app_sync_log (device text, change_id text)");
  db.prepare(
    `insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, is_primary)
       values (?, 'phone', 'Pixel', 'android', 412, 915, 2.625, ?, 'at', 1)`,
  ).run(phoneId, remoteKeyText(generateKeyPair(random).publicKey));
  db.prepare("insert into app_sync_log values (?, 'c1')").run(phoneId);
  db.close();
  const machine = `mch_0${"6".repeat(25)}`;
  const first = await boot(root, machine, random);
  const me = first.self!;
  const mine = remoteKeyBytes(JSON.parse(first.signing).secret_key)!;
  const phone = first.statements.find(
    (each) => each.body.type === "entry" && each.body.id === phoneId,
  )!.body as RosterEntryBody;

  // 다른 컴퓨터 B가 같은 폰을 더 작은 id로 들였고, 이 컴퓨터는 B를 믿는다.
  const bHost = generateKeyPair(random);
  const bSigning = generateSigningKey(random);
  const bId = `dev_0${"9".padStart(25, "0")}` as RosterEntryBody["id"];
  const smaller = `dev_0${"0".padStart(25, "0")}` as RosterEntryBody["id"];
  const bEntry: RosterEntryBody = {
    type: "entry",
    id: bId,
    kind: "computer",
    key: remoteKeyText(bHost.publicKey),
    signing_key: remoteKeyText(bSigning.publicKey),
    machine: `mch_0${"7".repeat(25)}` as RosterEntryBody["machine"],
    name: "laptop",
    os: "linux",
    rev: 1,
    invite: null,
  };
  const onB = { ...phone, id: smaller };
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
      statements: [
        ...statementsOf(stored),
        { body: bEntry, by: me.id, signature: signRoster(bEntry, mine) },
        {
          body: bEntry,
          by: bId,
          signature: signRoster(bEntry, bSigning.secretKey),
        },
        { body: onB, by: bId, signature: signRoster(onB, bSigning.secretKey) },
      ],
      reach: [],
      folds: [],
      removed: [],
      names: [],
    } as never,
    {} as never,
  );
  stored.close();
  assert.ok(done.ok);

  const syncLog = () => {
    const check = open(root);
    try {
      return check
        .prepare("select device from app_sync_log")
        .all()
        .map((row) => row.device);
    } finally {
      check.close();
    }
  };
  // 기동의 저장이 접는다. 기기 행, sync log, shell.devices가 같은 write와 그 commit 뒤에 작은 id로 간다.
  const folded = await boot(root, machine, random);
  assert.deepEqual(folded.rows, [[smaller, null]]);
  assert.deepEqual(syncLog(), [smaller]);
  assert.equal((folded.screens as { device: string }[])[0]?.device, smaller);

  // 행과 sync log는 이미 옮겨졌는데 shell.devices는 옛 id다(설정을 쓰기 전에 죽었다). 다음 저장이 고친다.
  const again = await boot(root, machine, random, {
    during: async (memory) => {
      await memory.get("roster/rename")!(PERSON, {
        id: smaller,
        name: "Pixel 9",
      });
    },
  });
  assert.deepEqual(again.rows, [[smaller, null]]);
  assert.deepEqual(syncLog(), [smaller]);
  assert.equal((again.screens as { device: string }[])[0]?.device, smaller);
});

// --- 터미널 입력 허락은 이 컴퓨터의 표다 ---

type Random = ReturnType<typeof seededRandom>;

function emptyRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "remote"));
  const db = open(root);
  for (const step of STEPS) db.exec(step.sql);
  db.close();
  return root;
}

// 명단의 다른 컴퓨터. 이 컴퓨터가 서명해 들이면 믿는 컴퓨터가 된다.
function otherComputer(random: Random, n: number) {
  const host = generateKeyPair(random);
  const signing = generateSigningKey(random);
  const entry: RosterEntryBody = {
    type: "entry",
    id: `dev_0${String(n).padStart(25, "0")}` as RosterEntryBody["id"],
    kind: "computer",
    key: remoteKeyText(host.publicKey),
    signing_key: remoteKeyText(signing.publicKey),
    machine: `mch_0${String(n).repeat(25)}` as RosterEntryBody["machine"],
    name: `computer ${n}`,
    os: "linux",
    rev: 1,
    invite: null,
  };
  return { host, signing, entry };
}

function phoneEntry(random: Random, n: number): RosterEntryBody {
  return {
    type: "entry",
    id: `dev_0${String(n).padStart(25, "0")}` as RosterEntryBody["id"],
    kind: "phone",
    key: remoteKeyText(generateKeyPair(random).publicKey),
    signing_key: null,
    machine: null,
    name: `phone ${n}`,
    os: "android",
    rev: 1,
    invite: null,
  };
}

const signedWith = (
  body: RosterEntryBody,
  by: string,
  secret: Uint8Array,
): RosterStatement => ({ body, by, signature: signRoster(body, secret) });

// 이미 저장한 명단에 statement를 더해 둔다(다른 컴퓨터가 보낸 것이 닿은 뒤의 기동).
function storeMore(root: string, more: RosterStatement[]) {
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
      statements: [...statementsOf(stored), ...more],
      reach: [],
      folds: [],
      removed: [],
      names: [],
    } as never,
    {} as never,
  );
  stored.close();
  assert.ok(done.ok);
}

// 새 기기가 한 초대장의 비밀로 서명한 자기 항목. 초대장은 `issuer`가 낸 것이다.
function invitedPhone(
  random: Random,
  n: number,
  issuer: { id: string; secret: Uint8Array },
  terminalInput: boolean,
): { statement: RosterInvitedStatement; entry: RosterEntryBody } {
  const once = generateSigningKey(random);
  const invite: RosterInviteBody = {
    type: "invite",
    key: remoteKeyText(once.publicKey),
    by: issuer.id as RosterInviteBody["by"],
    kind: "phone",
    terminal_input: terminalInput,
    expires_at: "1970-01-01T00:30:00.000Z",
  };
  const entry = { ...phoneEntry(random, n), invite: invite.key };
  return {
    entry,
    statement: {
      body: entry,
      invite: { body: invite, signature: signRoster(invite, issuer.secret) },
      signature: signRoster(entry, once.secretKey),
    },
  };
}

type Memory = Map<string, (who: unknown, input: unknown) => unknown>;
type Provided = Map<string, unknown>;
const granted = (provided: Provided) =>
  provided.get("terminalInputGrant") as (principal: string) => boolean;
const receive = (provided: Provided, statements: RosterStatement[]) =>
  (
    provided.get("rosterCarry") as {
      receive(s: RosterStatement[]): Promise<{ ok: boolean }>;
    }
  ).receive(statements);

// 명단은 누가 내 기기인지만 말하고 무엇을 해도 되는지는 받는 컴퓨터가 정한다. 명단의 컴퓨터는 자기 항목에 스스로 서명할 수 있고
// 다른 항목에도 서명할 수 있어(꼭두각시 컴퓨터, 폰) 서명한 값은 경계가 되지 못한다. 허락이 명단 항목에서 읽히면 그 컴퓨터가 이 컴퓨터의
// 터미널에 친다.
test("명단의 컴퓨터가 자기 항목이나 다른 기기의 항목을 어떻게 서명해도 이 컴퓨터의 터미널 입력 허락은 켜지지 않고, 사람이 켠 것만 서며 뺀 기기의 것은 거둔다", async () => {
  const random = seededRandom(51);
  const root = emptyRoot("lophn-remote-grant-self-");
  const machine = `mch_0${"1".repeat(25)}`;
  const first = await boot(root, machine, random);
  // 새 data root라 옮길 것이 없고 표지만 선다.
  assert.deepEqual(first.grants, []);
  assert.equal(first.seeded, true);
  const me = first.self!;
  const mine = remoteKeyBytes(JSON.parse(first.signing).secret_key)!;

  // 이 컴퓨터가 들인 컴퓨터 B가 높은 rev로 자기 항목에, 꼭두각시 컴퓨터 C와 폰 P의 항목에 옛 칸 `terminal_input: true`를 실어 서명한다.
  const b = otherComputer(random, 3);
  const c = otherComputer(random, 4);
  const d = otherComputer(random, 5);
  const p = phoneEntry(random, 6);
  const viaB = (body: RosterEntryBody) =>
    signedWith(body, b.entry.id, b.signing.secretKey);
  const on = (body: RosterEntryBody) => ({ ...body, terminal_input: true });
  storeMore(root, [
    signedWith(b.entry, me.id, mine),
    viaB({ ...on(b.entry), rev: 99 }),
    viaB(on(c.entry)),
    viaB(on(p)),
  ]);

  let removed: string[] = [];
  const done = await boot(root, machine, random, {
    during: async (memory: Memory, provided: Provided) => {
      const listed = (await memory.get("roster/list")!(PERSON, {})) as {
        value: { devices: { id: string; terminal_input: boolean }[] };
      };
      const ids = [b.entry.id, c.entry.id, p.id] as string[];
      assert.deepEqual(
        listed.value.devices.filter((d) => ids.includes(d.id)).length,
        3,
      );
      // 다른 컴퓨터가 보낸 명단 frame(폴더, link, 폰이 나르는 것)도 같다.
      assert.ok(
        (await receive(provided, [viaB({ ...on(b.entry), rev: 100 })])).ok,
      );
      for (const id of ids) {
        assert.equal(granted(provided)(`device:${id}`), false, id);
        assert.equal(
          listed.value.devices.find((one) => one.id === id)?.terminal_input,
          false,
          id,
        );
      }

      // 사람이 이 컴퓨터에서 켠 것만 선다. B가 그 뒤에 어떤 값으로 다시 서명해도 바뀌지 않는다.
      const set = (id: string, value: boolean) =>
        memory.get("roster/set_terminal_input")!(PERSON, { id, on: value });
      assert.deepEqual(await set(b.entry.id, true), {
        ok: true,
        value: { id: b.entry.id },
      });
      assert.equal(granted(provided)(`device:${b.entry.id}`), true);
      assert.equal(granted(provided)(`device:${c.entry.id}`), false);
      assert.ok((await receive(provided, [viaB({ ...b.entry, rev: 200 })])).ok);
      assert.equal(granted(provided)(`device:${b.entry.id}`), true);
      // 자기 줄과 명단에 없는 기기는 허락을 바꾸지 못한다.
      for (const id of [me.id, p.id.replace("6", "7")]) {
        const refused = (await set(id, true)) as { error?: { code: string } };
        assert.notEqual(refused.error, undefined, id);
      }

      // 그 기계의 컴퓨터가 하나뿐일 때만 허락한 컴퓨터다: B의 기계 이름을 단 새 항목(D)이 서면 그 기계는 허락으로 보지 않는다.
      const computerGranted = provided.get("computerGranted") as (
        machine: string,
      ) => boolean;
      assert.equal(computerGranted(b.entry.machine!), true);
      assert.equal(computerGranted(c.entry.machine!), false);
      assert.ok(
        (
          await receive(provided, [
            viaB({ ...d.entry, machine: b.entry.machine }),
          ])
        ).ok,
      );
      assert.equal(computerGranted(b.entry.machine!), false);

      // 정해진 빼기로 뺀 기기의 허락은 거둔다(다시 들면 새 key다).
      assert.ok(
        (
          (await memory.get("roster/remove")!(PERSON, { id: b.entry.id })) as {
            ok: boolean;
          }
        ).ok,
      );
      assert.equal(granted(provided)(`device:${b.entry.id}`), false);
      removed = [b.entry.key];
    },
  });
  assert.deepEqual(removed, [b.entry.key]);
  assert.deepEqual(done.grants, []);
});

// 초대장의 허락은 그 초대를 낸 컴퓨터의 사람이 고른 것이다. 다른 컴퓨터는 같은 statement를 받아 새 기기에 서명하지만 허락은 얻지 않는다.
test("초대장의 허락은 초대장을 낸 컴퓨터에만 서고, 같은 statement가 다시 닿아도 사람이 끈 허락은 켜지지 않는다", async () => {
  const random = seededRandom(53);
  const root = emptyRoot("lophn-remote-grant-invite-");
  const machine = `mch_0${"1".repeat(25)}`;
  const first = await boot(root, machine, random);
  const me = first.self!;
  const mine = remoteKeyBytes(JSON.parse(first.signing).secret_key)!;
  const b = otherComputer(random, 3);
  storeMore(root, [signedWith(b.entry, me.id, mine)]);

  const mineInvite = invitedPhone(random, 6, { id: me.id, secret: mine }, true);
  const noInvite = invitedPhone(random, 7, { id: me.id, secret: mine }, false);
  const bInvite = invitedPhone(
    random,
    8,
    { id: b.entry.id, secret: b.signing.secretKey },
    true,
  );
  const late = invitedPhone(random, 9, { id: me.id, secret: mine }, true);
  await boot(root, machine, random, {
    during: async (memory: Memory, provided: Provided) => {
      const inList = async (id: string) =>
        (
          (await memory.get("roster/list")!(PERSON, {})) as {
            value: { devices: { id: string; terminal_input: boolean }[] };
          }
        ).value.devices.find((one) => one.id === id);
      for (const each of [mineInvite, noInvite, bInvite]) {
        assert.ok((await receive(provided, [each.statement])).ok);
        assert.notEqual(await inList(each.entry.id), undefined);
      }
      // 이 컴퓨터가 낸 초대장은 그 값대로 이 컴퓨터의 표에 선다.
      assert.equal(granted(provided)(`device:${mineInvite.entry.id}`), true);
      assert.equal(granted(provided)(`device:${noInvite.entry.id}`), false);
      // B가 낸 초대장의 허락은 B에게만 선다. 이 컴퓨터는 그 기기에 서명하지만 허락하지 않는다.
      assert.equal(granted(provided)(`device:${bInvite.entry.id}`), false);

      // 다른 컴퓨터(B)가 먼저 서명한 항목과 같이 닿아도 이 컴퓨터가 낸 초대장으로 처음 선 기기는 허락을 받고, 사람이 끈 뒤
      // 같은 둘이 다시 닿아도 켜지지 않는다.
      const counter = [
        signedWith(late.entry, b.entry.id, b.signing.secretKey),
        late.statement,
      ];
      assert.ok((await receive(provided, counter)).ok);
      assert.equal(granted(provided)(`device:${late.entry.id}`), true);
      await memory.get("roster/set_terminal_input")!(PERSON, {
        id: late.entry.id,
        on: false,
      });
      assert.ok((await receive(provided, counter)).ok);
      assert.equal(granted(provided)(`device:${late.entry.id}`), false);

      // 사람이 끈 뒤에 같은 초대 statement가 다시 닿아도 켜지지 않는다.
      await memory.get("roster/set_terminal_input")!(PERSON, {
        id: mineInvite.entry.id,
        on: false,
      });
      assert.ok((await receive(provided, [mineInvite.statement])).ok);
      assert.equal(granted(provided)(`device:${mineInvite.entry.id}`), false);
      assert.equal((await inList(mineInvite.entry.id))?.terminal_input, false);
    },
  });
});

// 한 초대장으로 짝이 되면 두 컴퓨터가 서로 허락해 둔 상태가 되는 편의가 있다. 합류하는 컴퓨터 앞의 사람이 켠 스위치만 그 컴퓨터의 표에 쓴다.
test("합류하는 컴퓨터는 스위치를 켠 때만 초대한 컴퓨터를 허락하고, 그 허락은 이 컴퓨터의 표에만 쓰이며 명단에 실리지 않는다", async () => {
  for (const input of [undefined, true, false]) {
    const random = seededRandom(57);
    const root = emptyRoot("lophn-remote-grant-join-");
    const issuer = otherComputer(random, 8);
    const once = generateSigningKey(random);
    const invite: RosterInviteBody = {
      type: "invite",
      key: remoteKeyText(once.publicKey),
      by: issuer.entry.id as RosterInviteBody["by"],
      kind: "computer",
      terminal_input: true,
      expires_at: "1970-01-01T00:30:00.000Z",
    };
    const text = JSON.stringify({
      invite: {
        body: invite,
        signature: signRoster(invite, issuer.signing.secretKey),
      },
      secret: remoteKeyText(once.secretKey),
      issuer: signedWith(
        issuer.entry,
        issuer.entry.id,
        issuer.signing.secretKey,
      ),
      reach: {
        device: issuer.entry.id,
        addresses: ["10.0.0.9"],
        port: 7432,
        relay: null,
      },
    });
    let answer: unknown;
    const booted = await boot(root, `mch_0${"5".repeat(25)}`, random, {
      // 초대한 컴퓨터가 꺼져 있다: 저장하고 pending으로 끝난다. 사람이 이 컴퓨터에서 켠 스위치라 그래도 쓴다.
      dial: () => Promise.reject(new Error("off")),
      during: async (memory: Memory) => {
        answer = await memory.get("roster/join")!(PERSON, {
          text,
          ...(input === undefined ? {} : { terminal_input: input }),
        });
      },
    });
    assert.equal((answer as { ok: boolean }).ok, true);
    assert.deepEqual(
      booted.grants,
      input === false ? [] : [issuer.entry.key],
      `terminal_input ${input}`,
    );
    // 초대한 컴퓨터가 이 컴퓨터를 허락하는지는 이 컴퓨터가 정하지 않는다: 이 컴퓨터가 서명한 항목 어디에도 허락이 실리지 않는다.
    assert.ok(
      booted.statements.every(
        (each) =>
          each.body.type !== "entry" || !("terminal_input" in each.body),
      ),
    );
  }
});

// 이 판 전에는 허락이 명단 항목에 서명되어 있었다. 첫 기동에서 켜져 있던 것을 옮기지 않으면 이 컴퓨터에 치던 기기가 끊기고, 옮기기가
// 다시 돌면 사람이 끈 허락이 켜지거나 그 뒤 명단의 컴퓨터가 서명한 값이 허락이 된다.
test("옮기기는 켜져 있던 허락을 이 컴퓨터의 표로 옮기고 꺼져 있던 것은 켜지 않으며 한 번만 돈다", async () => {
  const random = seededRandom(59);
  const root = emptyRoot("lophn-remote-grant-seed-");
  const machine = `mch_0${"1".repeat(25)}`;
  const first = await boot(root, machine, random);
  const me = first.self!;
  const mine = remoteKeyBytes(JSON.parse(first.signing).secret_key)!;

  // 이 판 전의 data root로 되돌린다: 표지가 없고, 명단 항목에 허락이 실려 있고, 옛 기기 표에 아직 서명하지 않은 폰 행이 있다.
  const allowed = otherComputer(random, 3);
  const refused = otherComputer(random, 4);
  const entry = (c: ReturnType<typeof otherComputer>, input: boolean) =>
    signedWith({ ...c.entry, terminal_input: input }, me.id, mine);
  storeMore(root, [entry(allowed, true), entry(refused, false)]);
  const old = open(root);
  old.exec("delete from remote_grants_seed");
  const phoneRow = (n: number, input: number) => {
    const key = remoteKeyText(generateKeyPair(random).publicKey);
    old
      .prepare(
        `insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, is_primary, terminal_input)
           values (?, 'phone', ?, 'android', 412, 915, 2.625, ?, 'at', 0, ?)`,
      )
      .run(`dev_0${String(n).padStart(25, "0")}`, `phone ${n}`, key, input);
    return key;
  };
  const allowedPhone = phoneRow(6, 1);
  phoneRow(7, 0);
  old.close();

  const migrated = await boot(root, machine, random);
  assert.deepEqual(migrated.grants, [allowed.entry.key, allowedPhone].sort());
  assert.equal(migrated.seeded, true);
  // 폰 행에 이 컴퓨터가 서명한 항목은 허락을 싣지 않는다.
  assert.ok(
    migrated.statements.every(
      (each) =>
        each.body.type !== "entry" ||
        each.body.id === allowed.entry.id ||
        each.body.id === refused.entry.id ||
        each.body.terminal_input === undefined,
    ),
  );

  // 사람이 끈 허락과 그 뒤 명단에 닿은 항목은 다시 옮겨지지 않는다.
  const later = open(root);
  later
    .prepare("delete from remote_grants where key = ?")
    .run(allowed.entry.key);
  later.close();
  const newer = otherComputer(random, 5);
  storeMore(root, [entry(newer, true)]);
  const again = await boot(root, machine, random);
  assert.deepEqual(again.grants, [allowedPhone]);
});

// shell main이 들던 옛 기기 key와 기계 목록은 core가 명단으로 붙으며 쓸모가 없다. 창 자리와 시작 기계까지 지우면 사람이 고른 것을 잃는다.
test("data step은 창 자리와 시작 기계를 남기고 옛 viewer key와 기계 목록 file만 지운다. 복사된 data root의 목록은 옮기지 않는다", async () => {
  const self = `mch_0${"1".repeat(25)}`;
  const other = `mch_0${"3".repeat(25)}`;
  const at = "2026-11-16T00:00:00.000Z";
  function rootWith(stamp: string) {
    const root = mkdtempSync(join(tmpdir(), "lophn-viewer-step-"));
    writeFileSync(
      join(root, "machine.json"),
      JSON.stringify({
        id: self,
        name: null,
        binding: null,
        created_at: at,
        cloned_from: null,
        cloned_at: null,
      }),
    );
    const dir = join(root, "shell", "viewer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "key.json"),
      JSON.stringify({ machine: stamp, secret_key: "k" }),
    );
    writeFileSync(
      join(dir, "machines.json"),
      JSON.stringify({
        machine: stamp,
        computers: [
          {
            addresses: ["192.168.0.31"],
            port: 7432,
            key: "k",
            machine: other,
            name: "Home server",
            announced: "Mac mini",
          },
        ],
        start: { mode: "machine", machine: other },
        last: other,
        seen: { [other]: at },
      }),
    );
    writeFileSync(join(dir, "windows.json"), '{"places":"kept"}');
    return { root, dir };
  }

  const { root, dir } = rootWith(self);
  // 끊겨 다시 돌아도 같은 결과다.
  for (let run = 0; run < 2; run += 1) {
    assert.ok((await viewerRosterStep.run(root, stepDeps)).ok);
    assert.equal(existsSync(join(dir, "key.json")), false);
    assert.equal(existsSync(join(dir, "machines.json")), false);
    assert.equal(
      readFileSync(join(dir, "windows.json"), "utf8"),
      '{"places":"kept"}',
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "start.json"), "utf8")),
      {
        machine: self,
        start: { mode: "machine", machine: other },
        last: other,
        last_name: "Home server",
      },
    );
  }
  if (process.platform !== "win32") {
    assert.equal(statSync(join(dir, "start.json")).mode & 0o777, 0o600);
  }

  const copied = rootWith(`mch_0${"2".repeat(25)}`);
  assert.ok((await viewerRosterStep.run(copied.root, stepDeps)).ok);
  assert.equal(existsSync(join(copied.dir, "key.json")), false);
  assert.equal(existsSync(join(copied.dir, "machines.json")), false);
  assert.equal(existsSync(join(copied.dir, "start.json")), false);
  assert.equal(existsSync(join(copied.dir, "windows.json")), true);
});

// 사람의 data root에서 쓸모없어진 file만 지운다. 같은 폴더의 다른 file이나 remote key를 지우면 사람의 것을 잃는다.
test("shell.viewer.drop은 start.json과 windows.json만 지우고 같은 폴더의 다른 file과 remote key는 그대로 둔다. 두 번 돌려도 같고, 비면 폴더도 지운다", async () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-viewer-drop-"));
  const dir = join(root, "shell", "viewer");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, "remote"), { recursive: true });
  writeFileSync(join(root, "remote", "host.key"), "key");
  writeFileSync(join(dir, "start.json"), "{}");
  writeFileSync(join(dir, "windows.json"), "{}");
  writeFileSync(join(dir, "other.json"), "kept");

  for (let run = 0; run < 2; run += 1) {
    assert.ok((await viewerDropStep.run(root, stepDeps)).ok);
    assert.equal(existsSync(join(dir, "start.json")), false);
    assert.equal(existsSync(join(dir, "windows.json")), false);
    assert.equal(readFileSync(join(dir, "other.json"), "utf8"), "kept");
    assert.equal(readFileSync(join(root, "remote", "host.key"), "utf8"), "key");
  }

  unlinkSync(join(dir, "other.json"));
  assert.ok((await viewerDropStep.run(root, stepDeps)).ok);
  assert.equal(existsSync(dir), false);
  assert.equal(readFileSync(join(root, "remote", "host.key"), "utf8"), "key");
  // 폴더가 아예 없어도 아무것도 하지 않는다.
  assert.ok((await viewerDropStep.run(root, stepDeps)).ok);
});

// remote.enabled가 켜져 있는데 port 충돌 등으로 listener를 열지 못하면 invite·join이 "remote is off" 대신 실패 이유를 알리고,
// port가 열리거나 remote가 꺼지면 그 이유를 비운다.
test("remote listener가 EADDRINUSE로 실패하면 roster/invite와 roster/join이 port 충돌 이유를 답하고, 다른 port로 열리거나 끄면 초기화된다", async () => {
  const random = seededRandom(73);
  const root = emptyRoot("lophn-remote-port-taken-");
  const machine = `mch_0${"8".repeat(25)}`;

  // roster/join이 parseInviteText를 통과하도록 유효한 초대장 글 하나를 만든다.
  const issuerHost = generateKeyPair(random);
  const issuerSigning = generateSigningKey(random);
  const once = generateSigningKey(random);
  const issuerId = `dev_0${"8".padStart(25, "0")}` as RosterEntryBody["id"];
  const issuer: RosterEntryBody = {
    type: "entry",
    id: issuerId,
    kind: "computer",
    key: remoteKeyText(issuerHost.publicKey),
    signing_key: remoteKeyText(issuerSigning.publicKey),
    machine: `mch_0${"9".repeat(25)}` as RosterEntryBody["machine"],
    name: "laptop",
    os: "linux",
    rev: 1,
    invite: null,
  };
  const inviteBody: RosterInviteBody = {
    type: "invite",
    key: remoteKeyText(once.publicKey),
    by: issuerId as RosterInviteBody["by"],
    kind: "computer",
    terminal_input: true,
    expires_at: "1970-01-01T00:30:00.000Z",
  };
  const inviteText = JSON.stringify({
    invite: {
      body: inviteBody,
      signature: signRoster(inviteBody, issuerSigning.secretKey),
    },
    secret: remoteKeyText(once.secretKey),
    issuer: {
      body: issuer,
      by: issuerId,
      signature: signRoster(issuer, issuerSigning.secretKey),
    },
    reach: {
      device: issuerId,
      addresses: ["10.0.0.9"],
      port: 7432,
      relay: null,
    },
  });

  const openListener: typeof openRemoteListener = async ({ port }) => {
    if (port === 7432) {
      throw Object.assign(
        new Error("listen EADDRINUSE: address already in use :::7432"),
        { code: "EADDRINUSE" },
      );
    }
    return { port, close: async () => undefined };
  };

  await boot(root, machine, random, {
    port: 7432,
    openListener,
    during: async (memory, _provided, controls) => {
      const inviteFailed = (await memory.get("roster/invite")!(PERSON, {
        kind: "phone",
        terminal_input: false,
      })) as { ok: boolean; error?: { code: string; message: string } };
      assert.equal(inviteFailed.ok, false);
      assert.equal(inviteFailed.error?.code, "unavailable");
      assert.equal(
        inviteFailed.error?.message,
        "the remote port 7432 is in use by another program; change remote.port",
      );

      const joinFailed = (await memory.get("roster/join")!(PERSON, {
        text: inviteText,
      })) as { ok: boolean; error?: { code: string; message: string } };
      assert.equal(joinFailed.ok, false);
      assert.equal(joinFailed.error?.code, "unavailable");
      assert.equal(
        joinFailed.error?.message,
        "the remote port 7432 is in use by another program; change remote.port",
      );

      // 비어 있는 port로 바꾸면 listener가 열리고 invite가 성공한다.
      controls.setPort(7433);
      await controls.notifySettings("remote.port");
      const inviteOk = (await memory.get("roster/invite")!(PERSON, {
        kind: "phone",
        terminal_input: false,
      })) as { ok: boolean };
      assert.equal(inviteOk.ok, true);

      // remote를 끄면 실패 이유 없이 "remote is off"로 돌아온다.
      controls.setEnabled(false);
      await controls.notifySettings("remote.enabled");
      const inviteOff = (await memory.get("roster/invite")!(PERSON, {
        kind: "phone",
        terminal_input: false,
      })) as { ok: boolean; error?: { code: string; message: string } };
      assert.equal(inviteOff.ok, false);
      assert.equal(inviteOff.error?.code, "unavailable");
      assert.equal(inviteOff.error?.message, "remote is off");
    },
  });
});
