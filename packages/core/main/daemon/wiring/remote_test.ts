import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { err, manualClock, ok, seededRandom } from "../../../../base/mod.ts";
import {
  devicesSetTerminalInput,
  generateKeyPair,
  REMOTE_ALLOWED_ROUTES,
  remoteKeyText,
} from "../../../../protocol/remote/mod.ts";
import type {
  AuthenticatedContext,
  Tx,
} from "../../../../protocol/server/mod.ts";
import {
  createDeviceCredentials,
  createRemoteCall,
  DEVICES_COMMANDS,
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  devicesListRead,
  devicesPushTargetsRead,
} from "../../../remote/mod.ts";
import { CredentialRegistry } from "../../../server/identity/mod.ts";
import { RouteRegistry } from "../../../server/mod.ts";
import { createSql } from "../../../storage/ledger/sqlite.ts";
import { createAdmission } from "../../../supervision/responsiveness/mod.ts";
import { readHostKeyMachine } from "../../../remote/host-key.ts";
import { remoteWiring } from "./remote.ts";

const PERSON: AuthenticatedContext = {
  principal: "user:local",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};

// 폰이 자기 터미널 입력을 켜면 허락이 뜻이 없다. 기기 자격의 scope(REMOTE_ALLOWED_ROUTES)가 이 route를 빼는 실제 call 길로 본다.
test("devices/set_terminal_input은 폰 기기 자격으로 부르면 forbidden이고 writer에 닿지 않는다", async () => {
  const random = seededRandom(5);
  const clock = manualClock(1_000_000);
  const registry = new CredentialRegistry({
    epoch: "test",
    random,
    clock,
    operations: [devicesSetTerminalInput, ...REMOTE_ALLOWED_ROUTES]
      .filter((route) => route.actors.includes("user"))
      .map((route) => ({
        name: route.name,
        actors: ["user"],
        kind: route.kind === "command" ? "command" : "read",
      })),
  });
  const credential = await createDeviceCredentials({
    registry,
    record: async () => ok(undefined),
  }).get("dev_01jd0000000000000000000001");
  assert.ok(credential.ok);
  let written = 0;
  const call = createRemoteCall({
    registry,
    routes: new RouteRegistry([devicesSetTerminalInput]),
    clock,
    writer: {
      command: async () => {
        written += 1;
        return err({ code: "internal", message: "reached" });
      },
    } as never,
    reads: new Map(),
    memory: new Map(),
    fileStreams: new Map(),
    uploads: new Map(),
    admission: createAdmission(),
  });
  const answer = await call(credential.value, {
    resource: "devices",
    method: "set_terminal_input",
    body: {
      input: { id: "dev_01jd0000000000000000000001", on: true },
      compare: {},
      key: "k",
    },
  });
  assert.ok(!answer.ok && answer.error.code === "forbidden");
  assert.equal(written, 0);
});

// 기기 표는 메모리 sqlite에 devices.ts command 그대로다. writer는 command를 바로 돌리고 commit 뒤 할 일을 싣는다.
test("터미널 입력을 받지 않고 등록한 기기는 꺼져 있고 켠 기기만 terminalInputGrant가 true이며, 끄거나 끊으면 그 command가 답할 때 이미 false다", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...DEVICES_SCHEMA_STEPS, ...DEVICES_KIND_STEPS])
      db.exec(step.sql);
    const sql = createSql(db, () => true);
    let n = 0;
    let pushed: { topic: string; data: unknown }[] = [];
    const tx = {
      sql,
      now: () => "2026-11-16T00:00:00.000Z",
      newId: () => `dev_0${String(++n).padStart(25, "0")}`,
      port: () => ({
        push: (topic: string, data: unknown) => pushed.push({ topic, data }),
      }),
    } as unknown as Tx;
    const run = (method: string, ctx: AuthenticatedContext, input: unknown) => {
      pushed = [];
      const command = DEVICES_COMMANDS.find(
        (each) => each.route.method === method,
      )!;
      return command.handle(tx, ctx, input as never, {} as never);
    };
    const random = seededRandom(9);
    const register = () => {
      const done = run(
        "register",
        { ...PERSON, actor: "machine" },
        {
          kind: "phone",
          name: "Pixel",
          os: "android",
          width: 412,
          height: 915,
          dpr: 2.625,
          public_key: remoteKeyText(generateKeyPair(random).publicKey),
        },
      );
      assert.ok(done.ok);
      return (done.value as { id: string }).id;
    };

    const list = () =>
      devicesListRead.handle(
        { sql, as_of_seq: "1" } as never,
        {} as never,
        PERSON as never,
      );

    // 기동 전에 켜 둔 기기는 build가 표를 읽어 허락한다.
    const before = register();
    assert.ok(run("set_terminal_input", PERSON, { id: before, on: true }).ok);

    const slots: Record<string, unknown> = {};
    const ctx = {
      clock: manualClock(0),
      random,
      provide: (name: string, value: unknown) => {
        slots[name] = value;
      },
      runtime: {
        reads: new Map([["devices/list", () => list()]]),
      },
      settings: { get: () => [] },
      settingsUpdate: () => ok({ changed: [], rejected: [] }),
      telemetry: { logger: { error() {} } },
      attention: { bindPush() {} },
    };
    const wiring = remoteWiring();
    const built = await wiring.build!(ctx as never);
    assert.ok(built.ok);
    const writer = built.value.writer!({
      command: async (
        who: AuthenticatedContext,
        envelope: { command: string; input: unknown },
      ) => {
        const method = envelope.command.replace("devices.", "");
        const done = run(method, who, envelope.input);
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
    const granted = slots.terminalInputGrant as (principal: string) => boolean;
    const set = (id: string, on: boolean) =>
      writer.command(PERSON, {
        command: devicesSetTerminalInput.name,
        input: { id, on },
        compare: {},
        idempotency_key: "k",
        prepared: [],
      });

    assert.equal(granted(`device:${before}`), true);

    const fresh = register();
    assert.equal(granted(`device:${fresh}`), false);
    const listed = list();
    assert.ok(listed.ok);
    assert.deepEqual(
      listed.value.devices.map((each) => [each.id, each.terminal_input]),
      [
        [before, true],
        [fresh, false],
      ],
    );

    assert.ok((await set(fresh, true)).ok);
    assert.equal(granted(`device:${fresh}`), true);
    // 기기 아닌 principal은 기기 id와 같은 글이어도 허락이 없다.
    assert.equal(granted(fresh), false);
    assert.equal(granted("user:local"), false);

    assert.ok((await set(fresh, false)).ok);
    assert.equal(granted(`device:${fresh}`), false);
    assert.equal(granted(`device:${before}`), true);

    assert.ok(
      (
        await writer.command(PERSON, {
          command: "devices.revoke",
          input: { id: before },
          compare: {},
          idempotency_key: "k2",
          prepared: [],
        })
      ).ok,
    );
    assert.equal(granted(`device:${before}`), false);

    const missing = await set(before, true);
    assert.ok(!missing.ok && missing.error.code === "not_found");
    assert.equal(granted(`device:${before}`), false);
  } finally {
    db.close();
  }
});

// 복사된 data root의 기기 등록은 다른 기계가 pairing한 것이다. 남기면 이 기계가 그 폰에 push를 보내고 그 폰의 연결을 받는다.
test("host key의 machine이 지금 id와 다르면 기동 뒤 기기 표가 비고(push token 포함) 새 key가 생기며, 같으면 기기와 key가 그대로다", async () => {
  const original = `mch_0${"1".repeat(25)}`;
  const clone = `mch_0${"2".repeat(25)}`;
  const random = seededRandom(13);

  async function boot(root: string, machine: string) {
    const db = new DatabaseSync(join(root, "devices.db"));
    try {
      const sql = createSql(db, () => true);
      let pushed: { topic: string; data: unknown }[] = [];
      let n = 0;
      const tx = {
        sql,
        now: () => "2026-11-16T00:00:00.000Z",
        newId: () => `dev_0${String(++n).padStart(25, "0")}`,
        port: () => ({
          push: (topic: string, data: unknown) => pushed.push({ topic, data }),
        }),
      } as unknown as Tx;
      const run = (
        method: string,
        who: AuthenticatedContext,
        input: unknown,
      ) => {
        pushed = [];
        return DEVICES_COMMANDS.find(
          (each) => each.route.method === method,
        )!.handle(tx, who, input as never, {} as never);
      };
      const read = (handle: typeof devicesListRead.handle) => () =>
        handle({ sql, as_of_seq: "1" } as never, {} as never, PERSON as never);
      let screens: unknown = [
        {
          name: "Pixel",
          os: "android",
          width: 412,
          height: 915,
          dpr: 2.625,
          device: "dev_0" + "1".padStart(25, "0"),
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
        attention: { bindPush() {} },
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
          const done = run(
            envelope.command.replace("devices.", ""),
            who,
            envelope.input,
          );
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
      return {
        rows: sql
          .all("select id, push_token from devices order by id", [])
          .map(Object.values),
        screens,
        key: readFileSync(join(root, "remote", "host-key.json"), "utf8"),
      };
    } finally {
      db.close();
    }
  }

  // 원래 기계에서 pairing한 폰 하나(push token이 있다)와 그 기계가 만든 key.
  const root = mkdtempSync(join(tmpdir(), "lophn-remote-clone-"));
  mkdirSync(join(root, "remote"));
  const db = new DatabaseSync(join(root, "devices.db"));
  for (const step of [...DEVICES_SCHEMA_STEPS, ...DEVICES_KIND_STEPS])
    db.exec(step.sql);
  db.prepare(
    `insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, is_primary, push_token)
       values (?, 'phone', 'Pixel', 'android', 412, 915, 2.625, ?, 'at', 1, 'ExponentPushToken[a]')`,
  ).run(
    `dev_0${"1".padStart(25, "0")}`,
    remoteKeyText(generateKeyPair(random).publicKey),
  );
  db.close();
  const pair = generateKeyPair(random);
  const key = `${JSON.stringify({
    public_key: remoteKeyText(pair.publicKey),
    secret_key: remoteKeyText(pair.secretKey),
    machine: original,
  })}\n`;
  writeFileSync(join(root, "remote", "host-key.json"), key, { mode: 0o600 });

  const same = await boot(root, original);
  assert.deepEqual(same.rows, [
    [`dev_0${"1".padStart(25, "0")}`, "ExponentPushToken[a]"],
  ]);
  assert.equal(same.key, key);
  assert.equal((same.screens as unknown[]).length, 1);

  const cloned = await boot(root, clone);
  assert.deepEqual(cloned.rows, []);
  assert.deepEqual(cloned.screens, []);
  assert.notEqual(cloned.key, key);
  assert.equal(await readHostKeyMachine(join(root, "remote")), clone);
  assert.notEqual(
    JSON.parse(cloned.key).public_key,
    remoteKeyText(pair.publicKey),
  );
});
