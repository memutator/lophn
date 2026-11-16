import assert from "node:assert/strict";
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
} from "../../../remote/mod.ts";
import { CredentialRegistry } from "../../../server/identity/mod.ts";
import { RouteRegistry } from "../../../server/mod.ts";
import { createSql } from "../../../storage/ledger/sqlite.ts";
import { createAdmission } from "../../../supervision/responsiveness/mod.ts";
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
test("터미널 입력은 기본 꺼짐이고 켠 기기만 terminalInputGrant가 true이며, 끄거나 끊으면 그 command가 답할 때 이미 false다", async () => {
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
