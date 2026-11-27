import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  type CarryFileEntry,
  MAIL_ACKS_MAX,
  MAIL_ACKS_MAX_BYTES,
  MAIL_FILE_MAX_BYTES,
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
import { mailSchemaSteps, pendingMails } from "../router/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { publishManifest } from "./export/manifest.ts";
import { MAIL_FILE_AFTER_MS, writeMailFiles } from "./export/mail.ts";
import {
  applyArrivedMail,
  MAIL_FOLDER_GIVE_UP,
  type MailCarryIn,
  type MailFailures,
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
// outbox에 10분 전에 들어간 mail(file로 쓸 때가 지났다).
const OLD = new Date(Date.parse(AT) - 10 * 60_000).toISOString();
const author = (machine: Id<"mch">) => ({
  machine,
  agent: "coder",
  session: null,
  name: "coder",
});
function cancelMail(
  n: number,
  input: { from: Id<"mch">; to: Id<"mch">; seq: number; sent_at?: string },
): Mail {
  return {
    kind: "cancel",
    id: mal(n),
    call: `cal_01h${String(n).padStart(23, "0")}`,
    from: author(input.from),
    to_machine: input.to,
    seq: input.seq,
    sent_at: input.sent_at ?? OLD,
    expires_at: AT,
  };
}
// 글이 64 KiB 안이어도 JSON escape로 file 한도를 넘는 답.
function bigReply(n: number, input: { to: Id<"mch">; seq: number }): Mail {
  return {
    kind: "reply",
    id: mal(n),
    call: `cal_01h${String(n).padStart(23, "0")}`,
    from: author(LAPTOP),
    to_machine: input.to,
    seq: input.seq,
    sent_at: OLD,
    expires_at: AT,
    body: [{ type: "text", text: '"'.repeat(64 * 1024) }],
    outcome: null,
    unattended: false,
  };
}
const text = (value: string) => new TextEncoder().encode(value);
const hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

type Side = Awaited<ReturnType<typeof sideOf>>;

// 한 컴퓨터: data root의 `computers` 폴더, 받는 자리, ledger의 outbox(router의 표와 `pendingMails`), 가짜 mail 입구.
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
    ...mailSchemaSteps,
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
  const seenIds = new Set<string>();
  const applied: string[] = [];
  const refused: string[] = [];
  // 입구가 오류로 답할 mail과 그 code.
  const failing = new Map<string, "internal" | "unavailable">();
  const failures: MailFailures = new Map();
  const logged = new Set<string>();
  const logs: string[] = [];
  // 지금 link가 붙어 있는 상대 기계.
  const connected = new Set<string>();
  const seen = (origin: Id<"mch">, id: Id<"mal">) =>
    seenIds.has(`${origin}/${id}`);
  const carryIn = (): MailCarryIn => ({
    me,
    root: computers,
    holds: (machine, path) => replica.holds(machine, path),
    wanted: (machine) => replica.wantedOf(machine),
    logged,
    log: (message) => logs.push(message),
  });
  const ownPath = (path: string) => join(computers, ...path.split("/"));
  const manifest = (): ManifestBody =>
    (
      JSON.parse(readFileSync(ownPath(manifestPath(me)), "utf8")) as {
        body: ManifestBody;
      }
    ).body;
  return {
    me,
    clock,
    computers,
    roster,
    replica,
    seenIds,
    applied,
    refused,
    failing,
    logs,
    connected,
    db,
    /** outbox에 줄을 넣는다(router의 outbox와 같은 행). */
    queue(...mails: Mail[]) {
      for (const mail of mails) {
        sql.run(
          `insert into mail_outbox (id, peer, seq, call, kind, mail, sent_at, expires_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            mail.id,
            mail.to_machine,
            mail.seq,
            mail.call,
            mail.kind,
            JSON.stringify(mail),
            mail.sent_at,
            mail.expires_at,
          ],
        );
      }
    },
    outbox: () => pendingMails(sql).map((mail) => mail.id),
    /** 옮기기(carryOut)의 mail 부분과 manifest. `write`는 그 사이에 자기 폴더에 file을 둔다. manifest를 새로 썼으면 true. */
    async publish(write?: () => void): Promise<boolean> {
      const written = await writeMailFiles({
        me,
        root: computers,
        pending: pendingMails(sql),
        acks: await seenArrivedMail({ ...carryIn(), seen }),
        connected: (peer) => connected.has(peer),
        nowMs: clock.nowMs(),
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
    /** 자기 폴더에 file을 두고 manifest의 mail 칸에 그대로 실어 다시 서명한다(내보내기가 싣지 않을 file). */
    resign(files: Record<string, Uint8Array>) {
      const body = manifest();
      const extra: CarryFileEntry[] = Object.entries(files).map(
        ([path, bytes]) => {
          mkdirSync(dirname(ownPath(path)), { recursive: true });
          writeFileSync(ownPath(path), bytes);
          return { path, size: bytes.byteLength, sha256: hex(bytes) };
        },
      );
      const mail = [
        ...(body.mail ?? []).filter(
          (file) => !extra.some((each) => each.path === file.path),
        ),
        ...extra,
      ].sort((a, b) => (a.path < b.path ? -1 : 1));
      writeFileSync(
        ownPath(manifestPath(me)),
        signManifest(
          { ...body, revision: body.revision + 1, mail },
          owner.signing.secretKey,
        ),
      );
    },
    /** 읽기 scan의 mail 부분: 받은 mail을 입구에 넘기고, 받았다고 알려 온 줄을 outbox에서 지운다. */
    async read(byTimer = false) {
      await applyArrivedMail({
        ...carryIn(),
        seen,
        async apply({ mail, origin }) {
          const code = failing.get(mail.id);
          if (code !== undefined) return err({ code, message: "busy" });
          seenIds.add(`${origin}/${mail.id}`);
          applied.push(mail.id);
          return ok({});
        },
        async refuse({ mail, origin }) {
          seenIds.add(`${origin}/${mail.id}`);
          refused.push(mail.id);
          return ok({});
        },
        failures,
        byTimer,
      });
      await readMailAcks({
        ...carryIn(),
        pending: (peer) => pendingMails(sql, peer),
        async acked(id) {
          sql.run("delete from mail_outbox where id = ?", [id]);
          return ok(undefined);
        },
      });
    },
    manifest,
    paths: () => (manifest().mail ?? []).map((file) => file.path),
    has: (path: string) => {
      try {
        readFileSync(ownPath(path));
        return true;
      } catch {
        return false;
      }
    },
    read_: (path: string) => readFileSync(ownPath(path), "utf8"),
    /** 받는 자리를 거치지 않고 `computers` 폴더에 file을 둔다. */
    place(path: string, bytes: Uint8Array | string) {
      mkdirSync(dirname(ownPath(path)), { recursive: true });
      writeFileSync(ownPath(path), bytes);
    },
  };
}

// 연결이 `from`의 manifest와 그것이 싣는 file(`skip`이 고른 것은 빼고)을 `to`의 받는 자리에 넘긴다.
async function carry(
  from: Side,
  to: Side,
  skip: (path: string) => boolean = () => false,
) {
  const manifest = readFileSync(
    join(from.computers, ...manifestPath(from.me).split("/")),
    "utf8",
  );
  await to.replica.offerManifest(manifest, "link");
  for (const want of await to.replica.wantedOf(from.me)) {
    if (skip(want.path)) continue;
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

const acksFile = (mails: string[], pad = 0) =>
  text(
    JSON.stringify({ format: 1, machine: DESK, mails }) +
      " ".repeat(pad) +
      "\n",
  );

// 폴더는 아무나 쓸 수 있다. 서명한 목록 밖의 file이나 다른 기계를 사칭한 mail이 이 기계의 agent에게 일을 시키면 안 된다.
test("폴더로 온 mail은 지금 명단의 컴퓨터 폴더에 있고 from.machine이 그 폴더의 기계이며 이 기계로 온 것만 적용되고, 같은 mail file을 두 번 읽어도 한 번만 넘긴다", async () => {
  await withSides(async ({ desk: d, laptop: l, stranger: s }) => {
    l.queue(
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
    const strange = cancelMail(7, { from: OUTSIDER, to: DESK, seq: 1 });
    s.queue(strange);
    await s.publish();
    await carry(s, d);
    d.place(
      manifestPath(OUTSIDER),
      readFileSync(join(s.computers, ...manifestPath(OUTSIDER).split("/"))),
    );
    d.place(mailFilePath(OUTSIDER, mal(7)), encodeRecord(mailSchema, strange));
    const stray = cancelMail(8, { from: LAPTOP, to: DESK, seq: 5 });
    d.place(mailFilePath(LAPTOP, stray.id as Id<"mal">), JSON.stringify(stray));
    // 이 컴퓨터가 자기에게 쓴 것.
    d.queue(cancelMail(9, { from: DESK, to: DESK, seq: 1 }));
    await d.publish();

    // 입구가 오류를 내면 그 컴퓨터의 뒤 mail은 다음에 순서대로 넘긴다.
    d.failing.set(mal(2), "unavailable");
    await d.read();
    assert.deepEqual(d.applied, []);
    d.failing.clear();
    await d.read();
    assert.deepEqual(d.applied, [mal(2), mal(1)]);
    // 다시 읽어도, 같은 file이 다시 와도 한 번이다. 틀린 file은 한 번만 적는다.
    await carry(l, d);
    await d.read();
    assert.deepEqual(d.applied, [mal(2), mal(1)]);
    assert.equal(
      d.logs.filter((line) => line.includes("is not a mail")).length,
      2,
      d.logs.join("\n"),
    );

    // 명단에서 빠진 컴퓨터의 새 mail은 든 사본이 있어도 적용하지 않는다.
    l.queue(cancelMail(10, { from: LAPTOP, to: DESK, seq: 6 }));
    await l.publish();
    await carry(l, d);
    assert.equal(d.has(mailFilePath(LAPTOP, mal(10))), true);
    d.roster.view = viewOf(desk, []);
    await d.read();
    assert.deepEqual(d.applied, [mal(2), mal(1)]);
  });
});

// 받았다고 잘못 알면 보낸 쪽이 닿지 않은 mail을 지운다. 알리지 못하면 연결이 닿을 때까지 줄과 file이 남는다.
test("outbox의 mail은 file과 manifest의 mail 칸에 실리고, 줄이 지워지면 file과 칸에서 빠진다", async () => {
  await withSides(async ({ desk: d, laptop: l }) => {
    // 연결이 붙은 상대에게 방금 넣은 mail은 곧 link로 닿을 수 있어 60초 동안 file로 쓰지 않는다.
    // 연결이 없는(오프라인) 상대에게 방금 넣은 mail은 기다리지 않고 바로 file로 쓴다.
    l.connected.add(DESK);
    const nowAt = new Date(l.clock.nowMs()).toISOString();
    l.queue(
      cancelMail(1, {
        from: LAPTOP,
        to: DESK,
        seq: 1,
        sent_at: nowAt,
      }),
      cancelMail(99, {
        from: LAPTOP,
        to: OUTSIDER,
        seq: 1,
        sent_at: nowAt,
      }),
    );
    await l.publish();
    assert.deepEqual(l.paths(), [mailFilePath(LAPTOP, mal(99))]);
    l.db.exec(`delete from mail_outbox where id = '${mal(99)}'`);
    l.clock.advance(MAIL_FILE_AFTER_MS);
    l.queue(cancelMail(2, { from: LAPTOP, to: DESK, seq: 2 }));
    assert.equal(await l.publish(), true);
    assert.deepEqual(l.paths(), [
      mailFilePath(LAPTOP, mal(1)),
      mailFilePath(LAPTOP, mal(2)),
    ]);
    // 목록이 같으면 다시 쓰지 않는다.
    assert.equal(await l.publish(), false);

    // 받았다는 알림은 받는 자리가 검증한 사본에서만 읽는다.
    l.place(mailAcksPath(DESK), acksFile([mal(1)]));
    await l.read();
    assert.deepEqual(l.outbox(), [mal(1), mal(2)]);

    // 책상이 폴더로 받아 알린다. 노트북은 알려 온 줄만 지우고 file과 칸에서 뺀다.
    await carry(l, d);
    await d.read();
    assert.deepEqual(d.applied, [mal(1), mal(2)]);
    await d.publish();
    assert.deepEqual(d.paths(), [mailAcksPath(DESK)]);
    await carry(d, l);
    l.queue(cancelMail(3, { from: LAPTOP, to: DESK, seq: 3 }));
    await l.read();
    assert.deepEqual(l.outbox(), [mal(3)]);
    assert.equal(await l.publish(), true);
    assert.deepEqual(l.paths(), [mailFilePath(LAPTOP, mal(3))]);
    assert.equal(l.has(mailFilePath(LAPTOP, mal(1))), false);

    // 책상의 사본에서도 빠지고, 아직 보지 않은 mail은 알리지 않는다.
    await carry(l, d);
    assert.equal(d.has(mailFilePath(LAPTOP, mal(1))), false);
    await d.publish();
    assert.equal(d.manifest().mail, undefined);
  });
});

// 앞 mail보다 뒤 mail이 먼저 돌면 call을 끝낸 답 뒤에 온 말이나 call보다 먼저 온 답이 사라진다.
test("폴더 길의 mail은 seq 순으로만 돈다: 목록의 mail이 다 오기 전과 file이 되지 못한 mail 뒤는 넘기지 않고, 늘 실패하는 맨 앞 mail은 timer scan 다섯 번 뒤 거절하고 넘어간다", async () => {
  await withSides(async ({ desk: d, laptop: l }) => {
    // 한도를 넘는 mail은 file이 되지 않고, 그 상대의 뒤 mail도 연결을 기다린다. 다른 상대의 것은 간다.
    l.queue(
      bigReply(1, { to: DESK, seq: 1 }),
      cancelMail(2, { from: LAPTOP, to: DESK, seq: 2 }),
      cancelMail(3, { from: LAPTOP, to: OUTSIDER, seq: 1 }),
    );
    await l.publish();
    assert.deepEqual(l.paths(), [mailFilePath(LAPTOP, mal(3))]);
    l.db.exec(`delete from mail_outbox where id = '${mal(1)}'`);

    // 목록의 mail file이 하나라도 아직 오지 않았으면 그 컴퓨터의 mail은 돌지 않는다.
    l.queue(cancelMail(4, { from: LAPTOP, to: DESK, seq: 3 }));
    await l.publish();
    assert.deepEqual(l.paths(), [
      mailFilePath(LAPTOP, mal(2)),
      mailFilePath(LAPTOP, mal(3)),
      mailFilePath(LAPTOP, mal(4)),
    ]);
    await carry(l, d, (path) => path === mailFilePath(LAPTOP, mal(2)));
    await d.read(true);
    assert.deepEqual(d.applied, []);
    await carry(l, d);

    // 맨 앞 mail이 늘 실패한다. 파일마다 도는 scan은 세지 않는다.
    d.failing.set(mal(2), "internal");
    for (let i = 0; i < 2 * MAIL_FOLDER_GIVE_UP; i++) await d.read();
    for (let i = 1; i < MAIL_FOLDER_GIVE_UP; i++) await d.read(true);
    assert.deepEqual([d.refused, d.applied], [[], []]);
    await d.read(true);
    assert.deepEqual([d.refused, d.applied], [[mal(2)], [mal(4)]]);
    assert.ok(d.logs.some((line) => line.includes(`${mal(2)} (cancel)`)));
  });
});

// 한도가 없으면 다른 컴퓨터의 file 하나가 메모리를 채우고, 다시 쓰면 받는 쪽이 같은 path의 다른 bytes를 받는다.
test("mail file과 받은 id 목록은 한도 안에서만 쓰고 읽으며, 쓴 mail file은 다시 쓰지 않고, 받았다는 알림은 그 컴퓨터로 간 mail에만 닿는다", async () => {
  await withSides(async ({ desk: d, laptop: l }) => {
    // 쓴 file은 다시 쓰지 않는다.
    l.queue(
      cancelMail(1, { from: LAPTOP, to: DESK, seq: 1 }),
      cancelMail(3, { from: LAPTOP, to: OUTSIDER, seq: 1 }),
    );
    await l.publish();
    l.place(mailFilePath(LAPTOP, mal(1)), "kept");
    await l.publish();
    assert.equal(l.read_(mailFilePath(LAPTOP, mal(1))), "kept");

    // 한도를 넘는 mail file은 서명한 목록에 있어도 읽지 않는다.
    const big = cancelMail(20, { from: LAPTOP, to: DESK, seq: 2 });
    l.resign({
      [mailFilePath(LAPTOP, mal(1))]: encodeRecord(
        mailSchema,
        cancelMail(1, { from: LAPTOP, to: DESK, seq: 1 }),
      ),
      [mailFilePath(LAPTOP, mal(20))]: text(
        JSON.stringify(big) + " ".repeat(MAIL_FILE_MAX_BYTES),
      ),
    });
    await carry(l, d);
    await d.read();
    assert.deepEqual(d.applied, [mal(1)]);

    // 받은 id 목록은 한도까지만 쓴다.
    const many = Array.from({ length: MAIL_ACKS_MAX + 1 }, (_, i) =>
      mal(100 + i),
    );
    const wrote = await writeMailFiles({
      me: DESK,
      root: d.computers,
      pending: [],
      acks: many,
      nowMs: d.clock.nowMs(),
      random: seededRandom(5),
      log: () => undefined,
    });
    assert.ok(wrote.ok);
    assert.equal(
      mailAcksSchema.parse(JSON.parse(d.read_(mailAcksPath(DESK)))).mails
        .length,
      MAIL_ACKS_MAX,
    );

    // 노트북은 한도를 넘는 목록, 다른 컴퓨터로 간 mail의 id를 받았다고 치지 않는다.
    const sendAcks = async (bytes: Uint8Array) => {
      await d.publish();
      d.resign({ [mailAcksPath(DESK)]: bytes });
      await carry(d, l);
      await l.read();
    };
    await sendAcks(acksFile([...many, mal(1)].slice(-MAIL_ACKS_MAX - 1)));
    await sendAcks(acksFile([mal(1)], MAIL_ACKS_MAX_BYTES));
    await sendAcks(acksFile([mal(3)]));
    assert.deepEqual(l.outbox(), [mal(3), mal(1)]);
    await sendAcks(acksFile([mal(1)]));
    assert.deepEqual(l.outbox(), [mal(3)]);
  });
});
