import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock, seededRandom } from "../../base/mod.ts";
import { generateKeyPair, remoteKeyText } from "../../protocol/remote/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import {
  createTerminalInputGrants,
  DEVICES_COMMANDS,
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  type DevicesChange,
  devicesListRead,
} from "./devices.ts";
import { createPairingCodes } from "./pairing.ts";

const deviceId = (n: number) => `dev_0${String(n).padStart(25, "0")}`;
const random = seededRandom(11);
const keyText = () => remoteKeyText(generateKeyPair(random).publicKey);

function list(db: DatabaseSync) {
  const read = devicesListRead.handle(
    { sql: createSql(db, () => true), as_of_seq: "1" } as never,
    {} as never,
    {} as never,
  );
  assert.ok(read.ok);
  return read.value.devices;
}

// 사람의 data root가 이 step을 돈다. 표를 다시 만들어도 기기 등록, push, 터미널 허락, 기준, 사람이 붙인 이름을 잃으면 안 된다.
test("remote.devices.kind 뒤 옛 기기 행이 kind phone으로 남고 id, public_key, push_token, push_prefs, terminal_input, is_primary가 그대로이며, 옛 이름은 devices/list에 같은 글로 보이고 별명으로 남는다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of DEVICES_SCHEMA_STEPS) db.exec(step.sql);
    const insert = db.prepare(
      `insert into devices (id, name, os, width, height, dpr, public_key, created_at, last_connected_at, is_primary,
         push_token, push_prefs, terminal_input) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const rows = [
      [
        deviceId(1),
        "Pixel 9",
        "android",
        412,
        915,
        2.625,
        keyText(),
        "2026-10-01T00:00:00.000Z",
        null,
        0,
        null,
        "{}",
        0,
      ],
      [
        deviceId(2),
        "Work phone",
        "ios",
        390,
        844,
        3,
        keyText(),
        "2026-10-02T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
        1,
        "ExponentPushToken[a]",
        '{"needs_you":false}',
        1,
      ],
    ] as const;
    for (const row of rows) insert.run(...row);
    const schemaOf = () =>
      db
        .prepare(
          "select type, name, sql from sqlite_master where tbl_name = 'devices' and type in ('index', 'trigger') and name not like 'sqlite_autoindex_%' order by name",
        )
        .all();
    const before = schemaOf();

    for (const step of DEVICES_KIND_STEPS) db.exec(step.sql);

    assert.deepStrictEqual(
      db
        .prepare(
          `select id, name, os, width, height, dpr, public_key, created_at, last_connected_at, is_primary,
             push_token, push_prefs, terminal_input, kind, alias, name_announced_at from devices order by id`,
        )
        .all()
        .map((row) => Object.values(row)),
      rows.map((row) => [...row, "phone", row[1], null]),
    );
    assert.deepStrictEqual(schemaOf(), before);
    assert.deepStrictEqual(
      list(db).map((each) => [
        each.id,
        each.kind,
        each.name,
        each.announced_name,
        each.alias,
        each.primary,
        each.terminal_input,
      ]),
      [
        [deviceId(1), "phone", "Pixel 9", "Pixel 9", "Pixel 9", false, false],
        [
          deviceId(2),
          "phone",
          "Work phone",
          "Work phone",
          "Work phone",
          true,
          true,
        ],
      ],
    );
    // 같은 key의 두 등록을 막는 unique는 다시 만든 표에도 있다.
    assert.throws(() =>
      db
        .prepare(
          "insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, is_primary) values (?, 'phone', 'x', 'ios', 390, 844, 3, ?, 'at', 0)",
        )
        .run(deviceId(3), rows[0][6]),
    );
    assert.deepStrictEqual(
      db.prepare("pragma integrity_check").all().map(Object.values),
      [["ok"]],
    );
  } finally {
    db.close();
  }
});

test("devices/rename은 별명만 바꾸고 null이면 알린 이름이 다시 보이며, desktop 등록은 기준을 바꾸지 않고 desktop 행에 push token이나 기준을 넣는 쓰기는 거절된다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...DEVICES_SCHEMA_STEPS, ...DEVICES_KIND_STEPS])
      db.exec(step.sql);
    const sql = createSql(db, () => true);
    let changes: DevicesChange[] = [];
    let n = 0;
    const tx = {
      sql,
      now: () => "2026-11-16T00:00:00.000Z",
      newId: () => deviceId(++n),
      port: () => ({
        push: (_topic: string, change: DevicesChange) => changes.push(change),
      }),
    } as unknown as Tx;
    const run = (method: string, principal: string, input: unknown) => {
      changes = [];
      return DEVICES_COMMANDS.find(
        (each) => each.route.method === method,
      )!.handle(
        tx,
        {
          principal,
          actor: principal.startsWith("machine:") ? "machine" : "user",
        } as never,
        input as never,
        {} as never,
      );
    };
    const code = (result: { ok: boolean; error?: { code: string } }) =>
      result.ok ? "ok" : result.error!.code;
    const [phone, desktop] = [deviceId(1), deviceId(2)];
    const shown = (id: string) => {
      const found = list(db).find((each) => each.id === id)!;
      return [found.name, found.announced_name, found.alias];
    };

    assert.equal(
      code(
        run("register", "machine:remote", {
          kind: "phone",
          name: "Pixel",
          os: "android",
          width: 412,
          height: 915,
          dpr: 2.625,
          public_key: keyText(),
        }),
      ),
      "ok",
    );
    assert.equal(
      code(
        run("register", "machine:remote", {
          kind: "desktop",
          name: "studio",
          os: "linux",
          public_key: keyText(),
        }),
      ),
      "ok",
    );
    assert.deepEqual(changes, [
      { type: "registered", id: desktop, kind: "desktop" },
    ]);
    assert.deepEqual(
      list(db).map((each) => [
        each.id,
        each.kind,
        each.primary,
        each.width,
        each.height,
        each.dpr,
      ]),
      [
        [phone, "phone", true, 412, 915, 2.625],
        [desktop, "desktop", false, null, null, null],
      ],
    );

    // 별명만 바뀐다. 기기가 알린 이름은 그대로라 별명을 지우면 다시 보인다.
    assert.equal(
      code(run("rename", "user:local", { id: phone, name: "Work phone" })),
      "ok",
    );
    assert.deepEqual(shown(phone), ["Work phone", "Pixel", "Work phone"]);
    assert.deepEqual(changes, [
      { type: "renamed", id: phone, name: "Work phone" },
    ]);
    assert.equal(
      code(run("rename", "user:local", { id: phone, name: null })),
      "ok",
    );
    assert.deepEqual(shown(phone), ["Pixel", "Pixel", null]);
    assert.deepEqual(changes, [{ type: "renamed", id: phone, name: "Pixel" }]);

    // desktop은 기준이 되지 못하고 push token을 두지 못한다. 표 CHECK도 같은 규칙이다.
    assert.equal(
      code(run("set_primary", "user:local", { id: desktop })),
      "invalid_input",
    );
    const prefs = {
      needs_you: true,
      long_finish: true,
      app_update: true,
      job_missed: true,
      app_notify: true,
      quiet_when_present: true,
      show_names: true,
    };
    assert.equal(
      code(
        run("set_push", `device:${desktop}`, {
          token: "ExponentPushToken[d]",
          prefs,
        }),
      ),
      "forbidden",
    );
    assert.throws(() =>
      db.exec(`update devices set is_primary = 1 where id = '${desktop}'`),
    );
    assert.throws(() =>
      db.exec(
        `update devices set push_token = 'ExponentPushToken[d]' where id = '${desktop}'`,
      ),
    );
    assert.throws(() =>
      db.exec(`update devices set width = 412 where id = '${desktop}'`),
    );
    assert.throws(() =>
      db.exec(`update devices set os = 'linux' where id = '${phone}'`),
    );
    assert.deepEqual(
      db
        .prepare("select id, is_primary, push_token from devices order by id")
        .all()
        .map(Object.values),
      [
        [phone, 1, null],
        [desktop, 0, null],
      ],
    );
  } finally {
    db.close();
  }
});

// 기기가 알린 이름이 사람이 붙인 별명을 덮으면 안 된다. migration이 옛 이름을 별명으로 지켜 둔 것만 처음 알린 이름과 같을 때 거둔다.
test("붙을 때 알린 이름은 늘 고쳐 적히고 사람이 붙인 별명은 그대로이며, migration이 지킨 옛 이름은 처음 알린 이름과 같을 때만 별명에서 거둬진다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of DEVICES_SCHEMA_STEPS) db.exec(step.sql);
    const insert = db.prepare(
      `insert into devices (id, name, os, width, height, dpr, public_key, created_at, is_primary)
         values (?, ?, 'android', 412, 915, 2.625, ?, ?, 0)`,
    );
    // 옛 이름이 pairing 때 온 이름인 행과 사람이 바꾼 이름인 행. migration 뒤에는 둘 다 별명이다.
    insert.run(deviceId(1), "Pixel 9", keyText(), "2026-10-01T00:00:00.000Z");
    insert.run(
      deviceId(2),
      "Work phone",
      keyText(),
      "2026-10-02T00:00:00.000Z",
    );
    for (const step of DEVICES_KIND_STEPS) db.exec(step.sql);
    const sql = createSql(db, () => true);
    let changes: DevicesChange[] = [];
    let n = 2;
    let at = 0;
    const tx = {
      sql,
      now: () => `2026-11-16T00:00:0${at}.000Z`,
      newId: () => deviceId(++n),
      port: () => ({
        push: (_topic: string, change: DevicesChange) => changes.push(change),
      }),
    } as unknown as Tx;
    const run = (method: string, input: unknown) => {
      changes = [];
      at += 1;
      const done = DEVICES_COMMANDS.find(
        (each) => each.route.method === method,
      )!.handle(
        tx,
        { principal: "machine:remote", actor: "machine" } as never,
        input as never,
        {} as never,
      );
      assert.ok(done.ok);
    };
    const row = (id: string) => {
      const found = list(db).find((each) => each.id === id)!;
      return [found.name, found.announced_name, found.alias];
    };
    const [migrated, renamedByPerson, paired] = [
      deviceId(1),
      deviceId(2),
      deviceId(3),
    ];

    // 처음 알린 이름이 옛 이름과 같으면 별명을 거둔다. 보이는 글은 그대로다.
    run("connected", { id: migrated, name: "Pixel 9" });
    assert.deepEqual(row(migrated), ["Pixel 9", "Pixel 9", null]);
    assert.deepEqual(changes, []);
    // 다르면 사람이 바꾼 이름으로 보고 별명으로 둔다. 알린 이름만 적힌다.
    run("connected", { id: renamedByPerson, name: "Galaxy S24" });
    assert.deepEqual(row(renamedByPerson), [
      "Work phone",
      "Galaxy S24",
      "Work phone",
    ]);
    assert.deepEqual(changes, []);
    // 그 뒤로는 같은 글을 알려도 별명을 거두지 않는다.
    run("connected", { id: renamedByPerson, name: "Work phone" });
    assert.deepEqual(row(renamedByPerson), [
      "Work phone",
      "Work phone",
      "Work phone",
    ]);
    // 별명이 없으면 알린 이름이 바뀔 때마다 보이는 이름이 따라간다.
    run("connected", { id: migrated, name: "Pixel 9 Pro" });
    assert.deepEqual(row(migrated), ["Pixel 9 Pro", "Pixel 9 Pro", null]);
    assert.deepEqual(changes, [
      { type: "renamed", id: migrated, name: "Pixel 9 Pro" },
    ]);

    // pairing은 hello로 알린 이름이라 알린 때를 적는다. 사람이 붙인 별명은 같은 글을 알려도 남는다.
    run("register", {
      kind: "phone",
      name: "Pixel 8",
      os: "android",
      width: 412,
      height: 915,
      dpr: 2.625,
      public_key: keyText(),
    });
    run("rename", { id: paired, name: "Mine" });
    run("connected", { id: paired, name: "Mine" });
    assert.deepEqual(row(paired), ["Mine", "Mine", "Mine"]);
    assert.deepEqual(changes, []);
    assert.deepEqual(
      db
        .prepare(
          "select id, last_connected_at, name_announced_at from devices order by id",
        )
        .all()
        .map(Object.values),
      [
        [migrated, "2026-11-16T00:00:04.000Z", "2026-11-16T00:00:04.000Z"],
        [
          renamedByPerson,
          "2026-11-16T00:00:03.000Z",
          "2026-11-16T00:00:03.000Z",
        ],
        [paired, "2026-11-16T00:00:07.000Z", "2026-11-16T00:00:07.000Z"],
      ],
    );
  } finally {
    db.close();
  }
});

// 권한 경계: 터미널 입력 허락은 pairing 화면에서 code와 같이 정한 값으로 시작한다. 끄고 만든 code로 붙은 기기는 칠 수 없다.
test("pairing으로 등록한 기기는 터미널 입력이 켜져 있고, pairing 때 끄면 꺼져 있다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...DEVICES_SCHEMA_STEPS, ...DEVICES_KIND_STEPS])
      db.exec(step.sql);
    const sql = createSql(db, () => true);
    const grants = createTerminalInputGrants();
    let n = 0;
    const tx = {
      sql,
      now: () => "2026-11-17T00:00:00.000Z",
      newId: () => deviceId(++n),
      port: () => ({
        push: (_topic: string, change: DevicesChange) => grants.apply(change),
      }),
    } as unknown as Tx;
    const codes = createPairingCodes({
      clock: manualClock(1_000_000),
      random: seededRandom(5),
    });
    const register = DEVICES_COMMANDS.find(
      (each) => each.route.method === "register",
    )!;
    const pair = (terminal_input: boolean) => {
      const { code } = codes.start({ terminal_input });
      const grant = codes.take(code);
      assert.ok(grant);
      const done = register.handle(
        tx,
        { principal: "machine:remote", actor: "machine" } as never,
        {
          kind: "phone",
          name: "Pixel",
          os: "android",
          width: 412,
          height: 915,
          dpr: 2.625,
          public_key: keyText(),
          ...grant,
        } as never,
        {} as never,
      );
      assert.ok(done.ok);
      return (done.value as { id: string }).id;
    };

    const on = pair(true);
    const off = pair(false);
    assert.deepEqual(
      list(db).map((each) => [each.id, each.terminal_input]),
      [
        [on, true],
        [off, false],
      ],
    );
    assert.equal(grants.granted(`device:${on}`), true);
    assert.equal(grants.granted(`device:${off}`), false);
    // 기동 때 표에서 다시 채워도 같다.
    grants.load(list(db));
    assert.equal(grants.granted(`device:${on}`), true);
    assert.equal(grants.granted(`device:${off}`), false);
  } finally {
    db.close();
  }
});
