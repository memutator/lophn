import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { type Mail, mailSchema } from "../../protocol/lophn-agent/mail.ts";
import {
  type ManifestBody,
  machineSigningKey,
  mailAcksPath,
  mailAcksSchema,
  mailFilePath,
  manifestPath,
  signManifest,
} from "../../protocol/remote/carry.ts";
import { encodeRecord } from "../../protocol/folder/records.ts";
import { generateKeyPair, remoteKeyText } from "../../protocol/remote/noise.ts";
import {
  generateSigningKey,
  type RosterEntryBody,
  type RosterView,
  rosterView,
  signRoster,
} from "../../protocol/remote/roster.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { publishManifest } from "./export/manifest.ts";
import { writeMailFiles } from "./export/mail.ts";
import {
  applyArrivedMail,
  type MailCarryIn,
  readMailAcks,
  seenArrivedMail,
} from "./import/mail.ts";
import { createReplica } from "./replica.ts";
import {
  FOLDER_CARRY_MARKS_STEPS,
  FOLDER_CODE_COMMIT_STEPS,
  FOLDER_SCHEMA_STEPS,
} from "./schema.ts";

const DESK = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const LAPTOP = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const OUTSIDER = "mch_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"mch">;
const AT = "2026-11-21T00:00:00.000Z";

const keyRandom = seededRandom(31);
let serial = 0;
function computer(machine: Id<"mch">) {
  serial += 1;
  return {
    id: `dev_1${String(serial).padStart(25, "0")}`,
    machine,
    key: remoteKeyText(generateKeyPair(keyRandom).publicKey),
    signing: generateSigningKey(keyRandom),
  };
}
type Computer = ReturnType<typeof computer>;
const entry = (c: Computer): RosterEntryBody => ({
  type: "entry",
  id: c.id,
  kind: "computer",
  key: c.key,
  signing_key: remoteKeyText(c.signing.publicKey),
  machine: c.machine,
  name: "computer",
  os: "linux",
  rev: 1,
  invite: null,
});
// `by`가 서명한 명단: `by`와 `members`가 컴퓨터다.
function viewOf(by: Computer, members: Computer[]): RosterView {
  const self = remoteKeyText(by.signing.publicKey);
  return rosterView(
    [by, ...members].map((c) => {
      const body = entry(c);
      return {
        body,
        by: by.id,
        signature: signRoster(body, by.signing.secretKey),
      };
    }),
    [self],
    self,
  );
}

const desk = computer(DESK);
const laptop = computer(LAPTOP);
const stranger = computer(OUTSIDER);

const mal = (n: number) => `mal_01h${String(n).padStart(23, "0")}` as Id<"mal">;
function cancelMail(
  n: number,
  input: { from: Id<"mch">; to: Id<"mch">; seq: number },
): Mail {
  return {
    kind: "cancel",
    id: mal(n),
    call: `cal_01h${String(n).padStart(23, "0")}`,
    from: { machine: input.from, agent: "coder", session: null, name: "coder" },
    to_machine: input.to,
    seq: input.seq,
    sent_at: AT,
    expires_at: AT,
  };
}

type Side = Awaited<ReturnType<typeof sideOf>>;

// 한 컴퓨터: data root의 `computers` 폴더, 받는 자리, outbox와 Router의 "본 mail"(가짜).
async function sideOf(base: string, owner: Computer, view: RosterView) {
  const me = owner.machine;
  const dataRoot = join(base, me);
  const computers = join(dataRoot, "computers");
  mkdirSync(computers, { recursive: true });
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...FOLDER_SCHEMA_STEPS,
    ...FOLDER_CARRY_MARKS_STEPS,
    ...FOLDER_CODE_COMMIT_STEPS,
  ]) {
    db.exec(step.sql);
  }
  const sql: Sql = createSql(db, () => true);
  function transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T> {
    db.exec("BEGIN");
    try {
      const done = fn({ sql });
      db.exec(done.ok ? "COMMIT" : "ROLLBACK");
      return done;
    } catch (thrown) {
      db.exec("ROLLBACK");
      throw thrown;
    }
  }
  const clock = manualClock(Date.parse(AT));
  const random = seededRandom(serial + 100);
  // 명단이 바뀌는 줄이 고친다.
  const roster = { view };
  const replica = createReplica({
    dataRoot,
    machine: () => me,
    signingKey: (machine) => machineSigningKey(roster.view, machine),
    removed: () => false,
    sql,
    transaction,
    clock,
    random,
    manifestsChanged: () => undefined,
    filesChanged: () => undefined,
  });
  const outbox: Mail[] = [];
  const seenIds = new Set<string>();
  const applied: string[] = [];
  // 입구가 한 번 오류를 낼 mail.
  const failing = { id: null as string | null };
  const logs: string[] = [];
  const seen = (origin: Id<"mch">, id: Id<"mal">) =>
    seenIds.has(`${origin}/${id}`);
  const carryIn = (): MailCarryIn => ({
    me,
    root: computers,
    holds: (machine, path) => replica.holds(machine, path),
    log: (message) => logs.push(message),
  });
  return {
    me,
    owner,
    computers,
    roster,
    replica,
    outbox,
    seenIds,
    applied,
    failing,
    logs,
    db,
    /** 옮기기(carryOut)의 mail 부분과 manifest. `write`는 그 사이에 자기 폴더에 file을 둔다. manifest를 새로 썼으면 true. */
    async publish(write?: () => void): Promise<boolean> {
      const written = await writeMailFiles({
        me,
        root: computers,
        pending: outbox,
        acks: await seenArrivedMail({
          ...carryIn(),
          log: () => undefined,
          seen,
        }),
        random,
        log: (message) => logs.push(message),
      });
      assert.ok(written.ok, JSON.stringify(written));
      write?.();
      clock.advance(1000);
      const published = await publishManifest({
        me,
        root: computers,
        sql,
        transaction,
        clock,
        random,
        sign: (body) => signManifest(body, owner.signing.secretKey),
      });
      assert.ok(published.ok, JSON.stringify(published));
      return published.value;
    },
    /** 읽기 scan의 mail 부분: 받은 mail을 입구에 넘기고, 받았다고 알려 온 줄을 outbox에서 지운다. */
    async read() {
      await applyArrivedMail({
        ...carryIn(),
        seen,
        async apply({ mail, origin }) {
          if (failing.id === mail.id) {
            failing.id = null;
            return err({ code: "unavailable", message: "busy" });
          }
          seenIds.add(`${origin}/${mail.id}`);
          applied.push(mail.id);
          return ok({});
        },
      });
      await readMailAcks({
        ...carryIn(),
        pending: (peer) => outbox.filter((mail) => mail.to_machine === peer),
        async acked(id) {
          outbox.splice(
            outbox.findIndex((mail) => mail.id === id),
            1,
          );
          return ok(undefined);
        },
      });
    },
    manifest(): ManifestBody {
      return (
        JSON.parse(
          readFileSync(join(computers, ...manifestPath(me).split("/")), "utf8"),
        ) as { body: ManifestBody }
      ).body;
    },
    has: (path: string) => {
      try {
        readFileSync(join(computers, ...path.split("/")));
        return true;
      } catch {
        return false;
      }
    },
    /** 받는 자리를 거치지 않고 `computers` 폴더에 file을 둔다. */
    place(path: string, bytes: Uint8Array | string) {
      const target = join(computers, ...path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    },
  };
}

// 연결이 `from`의 manifest와 그것이 싣는 file을 `to`의 받는 자리에 넘긴다.
async function carry(from: Side, to: Side) {
  const text = readFileSync(
    join(from.computers, ...manifestPath(from.me).split("/")),
    "utf8",
  );
  await to.replica.offerManifest(text, "link");
  for (const want of await to.replica.wantedOf(from.me)) {
    const bytes = readFileSync(join(from.computers, ...want.path.split("/")));
    const done = await to.replica.receive({
      machine: from.me,
      path: want.path,
      size: want.size,
      sha256: want.sha256,
      via: "link",
      chunks: (async function* () {
        yield bytes;
      })(),
    });
    assert.ok(done.ok);
  }
}

async function withSides(
  run: (sides: { desk: Side; laptop: Side; stranger: Side }) => Promise<void>,
) {
  const base = await mkdtemp(join(tmpdir(), "lophn-mail-"));
  const sides = {
    desk: await sideOf(base, desk, viewOf(desk, [laptop])),
    laptop: await sideOf(base, laptop, viewOf(laptop, [desk])),
    stranger: await sideOf(base, stranger, viewOf(stranger, [desk])),
  };
  try {
    await run(sides);
  } finally {
    for (const side of Object.values(sides)) side.db.close();
    await rm(base, { recursive: true, force: true });
  }
}

// 폴더는 아무나 쓸 수 있다. 서명한 목록 밖의 file이나 다른 기계를 사칭한 mail이 이 기계의 agent에게 일을 시키면 안 된다.
test("폴더로 온 mail은 지금 명단의 컴퓨터 폴더에 있고 from.machine이 그 폴더의 기계이며 이 기계로 온 것만 적용되고, 같은 mail file을 두 번 읽어도 한 번만 넘긴다", async () => {
  await withSides(async ({ desk: d, laptop: l, stranger: s }) => {
    l.outbox.push(
      // seq 순이 id 순과 다르다.
      cancelMail(2, { from: LAPTOP, to: DESK, seq: 1 }),
      cancelMail(1, { from: LAPTOP, to: DESK, seq: 2 }),
      // 셋째 컴퓨터로 가는 것.
      cancelMail(3, { from: LAPTOP, to: OUTSIDER, seq: 1 }),
      // 다른 컴퓨터가 쓴 척한 것.
      cancelMail(4, { from: OUTSIDER, to: DESK, seq: 3 }),
      // 연결로 이미 받은 것.
      cancelMail(5, { from: LAPTOP, to: DESK, seq: 4 }),
    );
    d.seenIds.add(`${LAPTOP}/${mal(5)}`);
    // 서명한 목록이 싣지만 mail이 아닌 file. 나머지를 막지 않는다.
    await l.publish(() => l.place(mailFilePath(LAPTOP, mal(0)), "not json"));
    await carry(l, d);

    // 명단에 없는 컴퓨터가 낸 것과, 받는 자리를 거치지 않고 놓인 것.
    s.outbox.push(cancelMail(7, { from: OUTSIDER, to: DESK, seq: 1 }));
    await s.publish();
    await carry(s, d);
    d.place(
      manifestPath(OUTSIDER),
      readFileSync(join(s.computers, ...manifestPath(OUTSIDER).split("/"))),
    );
    d.place(
      mailFilePath(OUTSIDER, mal(7)),
      encodeRecord(mailSchema, s.outbox[0]!),
    );
    const stray = cancelMail(8, { from: LAPTOP, to: DESK, seq: 5 });
    d.place(mailFilePath(LAPTOP, stray.id as Id<"mal">), JSON.stringify(stray));
    // 이 컴퓨터가 자기에게 쓴 것.
    d.outbox.push(cancelMail(9, { from: DESK, to: DESK, seq: 1 }));
    await d.publish();

    // 입구가 오류를 내면 그 컴퓨터의 뒤 mail은 다음에 순서대로 넘긴다.
    d.failing.id = mal(2);
    await d.read();
    assert.deepEqual(d.applied, []);
    await d.read();
    assert.deepEqual(d.applied, [mal(2), mal(1)]);
    // 다시 읽어도, 같은 file이 다시 와도 한 번이다.
    await carry(l, d);
    await d.read();
    assert.deepEqual(d.applied, [mal(2), mal(1)]);

    // 명단에서 빠진 컴퓨터의 새 mail은 든 사본이 있어도 적용하지 않는다.
    l.outbox.push(cancelMail(10, { from: LAPTOP, to: DESK, seq: 6 }));
    await l.publish();
    await carry(l, d);
    assert.equal(d.has(mailFilePath(LAPTOP, mal(10))), true);
    d.roster.view = viewOf(desk, []);
    await d.read();
    assert.deepEqual(d.applied, [mal(2), mal(1)]);
  });
});

// 받았다고 잘못 알면 보낸 쪽이 닿지 않은 mail을 지운다. 알리지 못하면 file과 줄이 만료까지 남는다.
test("outbox의 mail은 file과 manifest의 mail 칸에 실리고, 줄이 지워지면 file과 칸에서 빠진다", async () => {
  await withSides(async ({ desk: d, laptop: l }) => {
    const paths = (side: Side) =>
      (side.manifest().mail ?? []).map((file) => file.path);
    l.outbox.push(
      cancelMail(1, { from: LAPTOP, to: DESK, seq: 1 }),
      cancelMail(2, { from: LAPTOP, to: DESK, seq: 2 }),
    );
    assert.equal(await l.publish(), true);
    assert.deepEqual(paths(l), [
      mailFilePath(LAPTOP, mal(1)),
      mailFilePath(LAPTOP, mal(2)),
    ]);
    // 목록이 같으면 다시 쓰지 않는다.
    assert.equal(await l.publish(), false);

    // 받았다는 알림은 받는 자리가 검증한 사본에서만 읽는다.
    l.place(
      mailAcksPath(DESK),
      encodeRecord(mailAcksSchema, {
        format: 1,
        machine: DESK,
        mails: [mal(1)],
      }),
    );
    await l.read();
    assert.equal(l.outbox.length, 2);

    // 책상이 폴더로 받아 알린다. 노트북은 알려 온 줄만 지우고 file과 칸에서 뺀다.
    await carry(l, d);
    await d.read();
    assert.deepEqual(d.applied, [mal(1), mal(2)]);
    await d.publish();
    assert.deepEqual(paths(d), [mailAcksPath(DESK)]);
    await carry(d, l);
    const later = cancelMail(3, { from: LAPTOP, to: DESK, seq: 3 });
    l.outbox.push(later);
    await l.read();
    assert.deepEqual(l.outbox, [later]);
    assert.equal(await l.publish(), true);
    assert.deepEqual(paths(l), [mailFilePath(LAPTOP, mal(3))]);
    assert.equal(l.has(mailFilePath(LAPTOP, mal(1))), false);

    // 책상의 사본에서도 빠지고, 아직 보지 않은 mail은 알리지 않는다.
    await carry(l, d);
    assert.equal(d.has(mailFilePath(LAPTOP, mal(1))), false);
    await d.publish();
    assert.equal(d.manifest().mail, undefined);
  });
});
