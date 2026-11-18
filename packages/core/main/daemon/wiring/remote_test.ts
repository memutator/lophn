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
    during?: (
      memory: Map<string, (who: unknown, input: unknown) => unknown>,
    ) => Promise<void>;
  } = {},
) {
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
      bus: { subscribe: () => () => undefined, publish() {} },
      allRoutes: [],
      // shell main이 붙지 않았다: 살아 있는 shell capability가 없다.
      peek: {},
    };
    const wiring = remoteWiring(options.dial);
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
    await options.during?.(new Map(built.value.memory as never));
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
      removed: [],
      names: [],
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
  for (const step of [
    ...DEVICES_SCHEMA_STEPS,
    ...DEVICES_KIND_STEPS,
    ...ROSTER_SCHEMA_STEPS,
  ])
    db.exec(step.sql);
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
    terminal_input: true,
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
  for (const step of [
    ...DEVICES_SCHEMA_STEPS,
    ...DEVICES_KIND_STEPS,
    ...ROSTER_SCHEMA_STEPS,
  ])
    db.exec(step.sql);
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
  for (const step of [
    ...DEVICES_SCHEMA_STEPS,
    ...DEVICES_KIND_STEPS,
    ...ROSTER_SCHEMA_STEPS,
  ])
    db.exec(step.sql);
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
    terminal_input: true,
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
