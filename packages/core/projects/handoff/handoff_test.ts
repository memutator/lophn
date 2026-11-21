import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock, type Result, seededRandom } from "../../../base/mod.ts";
import { createProductRedactor } from "../../../base/redaction/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { CallPolicy } from "../../../protocol/lophn-agent/call-policy.ts";
import {
  HANDOFF_MAX_AGE_MS,
  type HandoffFile,
  handoffFileSchema,
  handoffList,
  type HandoffNote,
  handoffWrite,
} from "../../../protocol/lophn-agent/handoff.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";
import { encodeRecord } from "../../../protocol/folder/records.ts";
import { REMOTE_ALLOWED_ROUTES } from "../../../protocol/remote/allowlist.ts";
import {
  machineSigningKey,
  manifestPath,
  noteFilePath,
  signManifest,
} from "../../../protocol/remote/carry.ts";
import {
  generateKeyPair,
  remoteKeyText,
} from "../../../protocol/remote/noise.ts";
import {
  generateSigningKey,
  type RosterEntryBody,
  type RosterView,
  rosterView,
  signRoster,
} from "../../../protocol/remote/roster.ts";
import type {
  AuthenticatedContext,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import { publishManifest } from "../../folder/export/manifest.ts";
import { createReplica } from "../../folder/replica.ts";
import {
  FOLDER_CARRY_MARKS_STEPS,
  FOLDER_CODE_COMMIT_STEPS,
  FOLDER_SCHEMA_STEPS,
} from "../../folder/schema.ts";
import { createSql } from "../../storage/ledger/sqlite.ts";
import {
  PROJECTS_FORMER_IDENTITY_STEPS,
  PROJECTS_IDENTITY_STEPS,
  projectsSchemaSteps,
} from "../registry/schema.ts";
import { handoffListHandler } from "./list.ts";
import { handoffWriteHandler, pruneHandoffNotes } from "./write.ts";

const DESK = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const LAPTOP = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const OUTSIDER = "mch_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"mch">;
const AT = Date.parse("2026-11-21T00:00:00.000Z");
// 두 컴퓨터에 같이 있는 project 둘의 기계를 건너는 id.
const SHARED = "pri_01haaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "pri_01hbbbbbbbbbbbbbbbbbbbbbbb";
const LONE = "pri_01hccccccccccccccccccccccc";
const prj = (n: number) => `prj_01h${String(n).padStart(23, "0")}` as Id<"prj">;
const ses = (n: number) => `ses_01h${String(n).padStart(23, "0")}` as Id<"ses">;

const keyRandom = seededRandom(41);
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
  name: c.machine === DESK ? "desk" : "other",
  os: "linux",
  rev: 1,
  invite: null,
});
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

const agentOf = (session: Id<"ses">): AuthenticatedContext => ({
  principal: `agent:${session}`,
  actor: `agent:${session}`,
  scope: { operations: [handoffWrite.name], targets: {} },
  conditions: { session, turn: "trn_01h00000000000000000000000" },
  credential_ref: "agent",
});
const person: AuthenticatedContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [handoffList.name], targets: {} },
  conditions: {},
  credential_ref: "user",
};

type Side = Awaited<ReturnType<typeof sideOf>>;

// 한 컴퓨터: data root의 `computers` 폴더와 받는 자리, project 표, 가짜 session 표와 git, 바꿀 수 있는 call 정책과 명단.
async function sideOf(
  base: string,
  owner: Computer,
  view: RosterView,
  projects: { id: Id<"prj">; identity: string | null }[],
) {
  const me = owner.machine;
  const dataRoot = join(base, me);
  const computers = join(dataRoot, "computers");
  mkdirSync(computers, { recursive: true });
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...FOLDER_SCHEMA_STEPS,
    ...FOLDER_CARRY_MARKS_STEPS,
    ...FOLDER_CODE_COMMIT_STEPS,
    ...projectsSchemaSteps,
    ...PROJECTS_IDENTITY_STEPS,
    ...PROJECTS_FORMER_IDENTITY_STEPS,
  ]) {
    db.exec(step.sql);
  }
  const sql: Sql = createSql(db, () => true);
  for (const [n, project] of projects.entries()) {
    sql.run(
      `insert into projects (id, name, title, purpose, revision, status, identity)
       values (?, ?, 'Project', '', '1', 'active', ?)`,
      [project.id, `project-${n}`, project.identity],
    );
    sql.run(
      "insert into project_folders (project, position, path, description) values (?, 0, ?, '')",
      [project.id, join(dataRoot, `repo-${n}`)],
    );
  }
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
  const clock = manualClock(AT);
  const random = seededRandom(serial + 200);
  const roster = { view };
  const policy: CallPolicy = { private: [], workspaces: [], agents: [] };
  const sessions = new Map<Id<"ses">, Workspace | null>();
  const head = {
    branch: "main" as string | null,
    commit: "a".repeat(40) as string | null,
  };
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
  let kicks = 0;
  const write = handoffWriteHandler({
    me: () => me,
    root: computers,
    sql,
    session(id) {
      if (!sessions.has(id)) return null;
      return { workspace: sessions.get(id)!, agent: "coder", name: "Coder" };
    },
    policy: () => policy,
    redact: (text) =>
      createProductRedactor()(
        { concern: "handoff", revision: "1", scope: "note" },
        "text/plain",
        text,
      ),
    head: () => Promise.resolve({ ...head }),
    clock,
    random,
    written: () => {
      kicks += 1;
    },
  });
  const logs: string[] = [];
  const list = handoffListHandler({
    me: () => me,
    root: computers,
    sql,
    holds: (machine, path) => replica.holds(machine, path),
    computerName: (machine) =>
      roster.view.devices.find(
        (each) =>
          each.body.kind === "computer" && each.body.machine === machine,
      )?.body.name ?? null,
    policy: () => policy,
    clock,
    logged: new Set(),
    log: (message) => logs.push(message),
  });
  const ownPath = (path: string) => join(computers, ...path.split("/"));
  return {
    me,
    owner,
    clock,
    computers,
    roster,
    replica,
    policy,
    sessions,
    head,
    logs,
    db,
    kicks: () => kicks,
    write: (session: Id<"ses"> | undefined, text: string) =>
      write(session === undefined ? person : agentOf(session), {
        text,
      }) as Promise<Result<{ written_at: string; identity: string }>>,
    async list(project?: Id<"prj">): Promise<HandoffNote[]> {
      const read = (await list(
        person,
        project === undefined ? {} : { project },
      )) as Result<{
        notes: HandoffNote[];
      }>;
      assert.ok(read.ok, JSON.stringify(read));
      return read.value.notes;
    },
    /** 옮기기의 note 부분과 manifest. */
    async publish() {
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
    },
    prune: () =>
      pruneHandoffNotes({
        me,
        root: computers,
        sql,
        policy,
        nowMs: clock.nowMs(),
        random,
      }),
    has: (path: string) => existsSync(ownPath(path)),
    read: (path: string) =>
      JSON.parse(readFileSync(ownPath(path), "utf8")) as HandoffFile,
    /** 받는 자리를 거치지 않고 `computers` 폴더에 file을 둔다. */
    place(path: string, bytes: Uint8Array | string) {
      mkdirSync(dirname(ownPath(path)), { recursive: true });
      writeFileSync(ownPath(path), bytes);
    },
  };
}

// 연결이 `from`의 manifest와 그것이 싣는 file을 `to`의 받는 자리에 넘긴다.
async function carry(from: Side, to: Side) {
  const manifest = readFileSync(
    join(from.computers, ...manifestPath(from.me).split("/")),
    "utf8",
  );
  await to.replica.offerManifest(manifest, "link");
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
  const base = await mkdtemp(join(tmpdir(), "lophn-handoff-"));
  const sides = {
    // desk: 같이 있는 project 둘, desk에서만 private인 project, id 없는 project.
    desk: await sideOf(base, desk, viewOf(desk, [laptop]), [
      { id: prj(1), identity: SHARED },
      { id: prj(2), identity: OTHER },
      { id: prj(3), identity: LONE },
      { id: prj(4), identity: null },
    ]),
    // laptop: 같은 project 둘이 다른 이 기계 id로 있다.
    laptop: await sideOf(base, laptop, viewOf(laptop, [desk]), [
      { id: prj(11), identity: SHARED },
      { id: prj(12), identity: OTHER },
    ]),
    stranger: await sideOf(base, stranger, viewOf(stranger, [laptop]), [
      { id: prj(21), identity: SHARED },
    ]),
  };
  try {
    await run(sides);
  } finally {
    for (const side of Object.values(sides)) side.db.close();
    await rm(base, { recursive: true, force: true });
  }
}

const project = (id: Id<"prj">): Workspace => ({ kind: "project", id });
const code = (done: Result<unknown>) => (done.ok ? "ok" : done.error.code);

// private은 기계 사이에도 선다: 쓰는 기계에서 private인 workspace는 note를 남기지 않고, 받는 기계에서 private인 project의 note는 보이지 않는다.
test("private workspace의 session은 handoff note를 남기지 못하고 file이 생기지 않으며, 받는 기계에서 private인 project의 note는 목록에 보이지 않는다", async () => {
  // note는 그 session의 agent 자격만 쓰고, 목록은 이 기계의 사람만 읽는다(기기 allowlist에 없다).
  assert.deepEqual(handoffWrite.actors, ["agent"]);
  assert.deepEqual(handoffList.actors, ["user"]);
  assert.equal(
    (REMOTE_ALLOWED_ROUTES as readonly { name: string }[]).some(
      (route) =>
        route.name === handoffList.name || route.name === handoffWrite.name,
    ),
    false,
  );
  await withSides(async ({ desk: d, laptop: l }) => {
    d.sessions.set(ses(1), project(prj(1)));
    d.sessions.set(ses(2), project(prj(2)));
    d.sessions.set(ses(3), project(prj(3)));
    d.sessions.set(ses(4), project(prj(4)));
    d.sessions.set(ses(5), null);
    d.policy.private.push({ kind: "project", id: prj(3) });

    // session 자격이 없으면 쓰지 못한다. private, home, id 없는 project도.
    assert.equal(code(await d.write(undefined, "x")), "forbidden");
    assert.equal(code(await d.write(ses(3), "secret plan")), "forbidden");
    assert.equal(code(await d.write(ses(5), "x")), "invalid_input");
    assert.equal(code(await d.write(ses(4), "x")), "invalid_input");
    for (const n of [3, 4, 5])
      assert.equal(d.has(noteFilePath(DESK, ses(n))), false);
    assert.equal(d.kicks(), 0);

    // 부른 session의 file 하나에만 쓰고, 다시 쓰면 바꾼다. secret 모양의 글은 file에 가지 않는다.
    assert.equal(code(await d.write(ses(1), "first")), "ok");
    const token = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    assert.equal(code(await d.write(ses(1), `next: review ${token}`)), "ok");
    assert.equal(code(await d.write(ses(2), "other work")), "ok");
    const one = d.read(noteFilePath(DESK, ses(1)));
    assert.equal(one.session, ses(1));
    assert.equal(one.identity, SHARED);
    assert.equal(one.text.includes(token), false);
    assert.equal(one.text.startsWith("next: review "), true);
    assert.equal(d.kicks(), 3);

    await d.publish();
    await carry(d, l);
    // laptop에서 OTHER project가 private이다.
    l.policy.private.push({ kind: "project", id: prj(12) });
    assert.deepEqual(
      (await l.list()).map((note) => [note.session, note.project]),
      [[ses(1), prj(11)]],
    );
    assert.deepEqual(await l.list(prj(12)), []);
    l.policy.private.length = 0;
    assert.deepEqual((await l.list()).map((note) => note.session).sort(), [
      ses(1),
      ses(2),
    ]);
    assert.deepEqual(
      (await l.list(prj(12))).map((note) => note.session),
      [ses(2)],
    );

    // 쓴 뒤 desk에서 private이 된 project의 note는 나르기가 지워 다른 기계로 가지 않는다.
    d.policy.private.push({ kind: "project", id: prj(1) });
    assert.ok((await d.prune()).ok);
    assert.equal(d.has(noteFilePath(DESK, ses(1))), false);
    assert.equal(d.has(noteFilePath(DESK, ses(2))), true);
    await d.publish();
    await carry(d, l);
    assert.deepEqual(
      (await l.list()).map((note) => note.session),
      [ses(2)],
    );
  });
});

const noteBytes = (
  file: Partial<HandoffFile> & { session: Id<"ses">; written_at: string },
) =>
  encodeRecord(handoffFileSchema, {
    format: 1,
    machine: DESK,
    identity: SHARED,
    agent: "coder",
    name: "Coder",
    text: "placed",
    branch: null,
    commit: null,
    ...file,
  });

// 폴더는 아무나 쓸 수 있다. 서명한 목록 밖의 file, 다른 기계를 사칭한 note, 옛 note가 사람과 agent에게 닿으면 안 된다.
test("지금 명단의 컴퓨터 폴더에 있고 그 기계가 쓴 7일 안의 note만 목록에 보인다", async () => {
  await withSides(async ({ desk: d, laptop: l, stranger: s }) => {
    d.sessions.set(ses(1), project(prj(1)));
    d.sessions.set(ses(2), project(prj(1)));
    // 7일을 넘길 note를 먼저 쓴다.
    assert.equal(code(await d.write(ses(2), "old work")), "ok");
    d.clock.advance(HANDOFF_MAX_AGE_MS + 60_000);
    l.clock.set(d.clock.nowMs());
    s.clock.set(d.clock.nowMs());
    const now = d.clock.now();
    d.head.branch = "feat/x\u001b[31m\nnext";
    const secret = "the body of a note that must never reach a log";
    assert.equal(
      code(await d.write(ses(1), `continue\u0007 here\n${secret}`)),
      "ok",
    );
    // desk가 서명해 싣지만 틀린 file: JSON이 아님, 다른 기계를 사칭, 다른 session을 사칭, 글이 한도를 넘음.
    d.place(noteFilePath(DESK, ses(3)), `not json ${secret}`);
    d.place(
      noteFilePath(DESK, ses(4)),
      noteBytes({
        session: ses(4),
        machine: OUTSIDER,
        text: secret,
        written_at: now,
      }),
    );
    d.place(
      noteFilePath(DESK, ses(5)),
      noteBytes({ session: ses(6), text: secret, written_at: now }),
    );
    d.place(
      noteFilePath(DESK, ses(7)),
      noteBytes({
        session: ses(7),
        text: "é".repeat(20 * 1024),
        written_at: now,
      }),
    );
    await d.publish();
    await carry(d, l);

    // 받는 자리를 거치지 않고 놓인 desk의 note, laptop이 쓰고 자기 manifest에 실은 자기 note.
    l.place(
      noteFilePath(DESK, ses(8)),
      noteBytes({ session: ses(8), written_at: now }),
    );
    l.sessions.set(ses(9), project(prj(11)));
    assert.equal(code(await l.write(ses(9), "my own")), "ok");
    await l.publish();
    // 명단에 없는 컴퓨터의 서명한 manifest와 note.
    s.sessions.set(ses(10), project(prj(21)));
    assert.equal(code(await s.write(ses(10), "from outside")), "ok");
    await s.publish();
    await carry(s, l);
    l.place(
      manifestPath(OUTSIDER),
      readFileSync(join(s.computers, ...manifestPath(OUTSIDER).split("/"))),
    );
    l.place(
      noteFilePath(OUTSIDER, ses(10)),
      readFileSync(
        join(s.computers, ...noteFilePath(OUTSIDER, ses(10)).split("/")),
      ),
    );

    const notes = await l.list();
    assert.deepEqual(
      notes.map(({ machine, computer, session, project, agent_name }) => ({
        machine,
        computer,
        session,
        project,
        agent_name,
      })),
      [
        {
          machine: DESK,
          computer: "desk",
          session: ses(1),
          project: prj(11),
          agent_name: "Coder",
        },
      ],
    );
    // 제어 문자는 빠지고(글의 줄바꿈은 남는다), 한 줄 칸은 한 줄이다.
    assert.equal(notes[0]!.text, `continue here\n${secret}`);
    assert.equal(notes[0]!.branch, "feat/x[31m next");
    // 틀린 file은 file마다 한 번 적고 본문은 적지 않는다. 틀린 file이 나머지를 막지 않았다.
    await l.list();
    assert.equal(l.logs.length, 4, l.logs.join("\n"));
    assert.equal(
      l.logs.some((line) => line.includes(secret)),
      false,
    );

    // 7일 안이어도 지금 명단에서 빠진 컴퓨터의 note는 든 사본이 있어도 보이지 않는다.
    l.roster.view = viewOf(laptop, []);
    assert.deepEqual(await l.list(), []);
  });
});

// 컴퓨터끼리 처음 보면 project의 id가 하나로 맞춰져 바뀐다. 그 전에 쓴 note를 잃거나 숨기면 안 된다.
test("project의 기계를 건너는 id가 바뀌기 전에 쓴 note는 쓴 기계에서 지워지지 않고 받는 기계에서 보인다", async () => {
  await withSides(async ({ desk: d, laptop: l }) => {
    d.sessions.set(ses(1), project(prj(1)));
    assert.equal(code(await d.write(ses(1), "before the ids matched")), "ok");
    // 두 기계 모두 SHARED가 옛 id가 되고 새 id를 쓴다.
    const NEW = "pri_01hddddddddddddddddddddddd";
    for (const [side, id] of [
      [d, prj(1)],
      [l, prj(11)],
    ] as const) {
      side.db
        .prepare(
          "update projects set identity = ?, former_identities = ? where id = ?",
        )
        .run(NEW, JSON.stringify([SHARED]), id);
    }
    assert.ok((await d.prune()).ok);
    assert.equal(d.has(noteFilePath(DESK, ses(1))), true);
    await d.publish();
    await carry(d, l);
    assert.deepEqual(
      (await l.list(prj(11))).map((note) => [note.session, note.project]),
      [[ses(1), prj(11)]],
    );
  });
});
